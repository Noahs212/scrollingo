import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSelector } from "react-redux";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { fsrs, Rating, State } from "ts-fsrs";

import { RootState } from "../../redux/store";
import { useFlashcards } from "../../hooks/useFlashcards";
import { updateFlashcardAfterReview, logReview } from "../../services/flashcards";
import { keys } from "../../hooks/queryKeys";
import { Flashcard } from "../../../types";
import FlashcardView from "./components/FlashcardView";
import ProgressBar from "./components/ProgressBar";
import RatingButtons from "./components/RatingButtons";

const scheduler = fsrs();
const RE_QUEUE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

interface SessionResult {
  reviewedCount: number;
  correctCount: number;
  bestStreak: number;
}

interface Props {
  onComplete: (result: SessionResult) => void;
}

export default function CardViewer({ onComplete }: Props) {
  const activeLearningLanguage = useSelector(
    (state: RootState) => state.language.activeLearningLanguage,
  );
  const maxReviews = useSelector(
    (state: RootState) => state.auth.currentUser?.maxReviewsPerDay ?? 20,
  );

  const { data: dueCards } = useFlashcards(activeLearningLanguage, maxReviews);
  const queryClient = useQueryClient();

  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [uniqueCompleted, setUniqueCompleted] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const cardStartTime = useRef<number>(Date.now());
  const initialized = useRef(false);
  // Track which cards have been re-queued and how many times
  const requeuedSet = useRef<Set<string>>(new Set());

  // Initialize queue once
  useEffect(() => {
    if (dueCards && dueCards.length > 0 && !initialized.current) {
      initialized.current = true;
      setQueue([...dueCards]);
      setTotalCards(dueCards.length);
      cardStartTime.current = Date.now();
    }
  }, [dueCards]);

  const currentCard = queue[0] ?? null;
  const isRequeue = currentCard ? requeuedSet.current.has(currentCard.id) : false;

  const handleFlip = useCallback(() => {
    setFlipped((f) => !f);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleRate = useCallback(async (rating: Rating) => {
    if (!currentCard || isSaving) return;
    setIsSaving(true);

    const durationMs = Date.now() - cardStartTime.current;
    const isCorrect = rating === Rating.Good || rating === Rating.Easy;
    const wasRequeue = requeuedSet.current.has(currentCard.id);

    // Build ts-fsrs Card from our stored FSRS state
    const fsrsCard = {
      due: new Date(currentCard.due),
      stability: currentCard.stability,
      difficulty: currentCard.difficulty,
      elapsed_days: currentCard.elapsed_days,
      scheduled_days: currentCard.scheduled_days,
      reps: currentCard.reps,
      lapses: currentCard.lapses,
      learning_steps: currentCard.learning_steps,
      state: currentCard.state as State,
      last_review: currentCard.last_review_at
        ? new Date(currentCard.last_review_at)
        : undefined,
    };

    const now = new Date();
    const result = scheduler.repeat(fsrsCard, now);
    const scheduled = result[rating];
    const updatedCard = scheduled.card;
    const reviewLog = scheduled.log;

    // Map ts-fsrs Card → DB fields
    const cardFields = {
      state: updatedCard.state as number,
      stability: updatedCard.stability,
      difficulty: updatedCard.difficulty,
      due: updatedCard.due.toISOString(),
      last_review_at: now.toISOString(),
      elapsed_days: updatedCard.elapsed_days,
      scheduled_days: updatedCard.scheduled_days,
      reps: updatedCard.reps,
      lapses: updatedCard.lapses,
      learning_steps: updatedCard.learning_steps,
    };

    // Map ts-fsrs ReviewLog → DB fields
    const logFields = {
      rating: reviewLog.rating as number,
      state: reviewLog.state as number,
      stability: reviewLog.stability,
      difficulty: reviewLog.difficulty,
      elapsed_days: reviewLog.elapsed_days,
      last_elapsed_days: reviewLog.last_elapsed_days,
      scheduled_days: reviewLog.scheduled_days,
      learning_steps: reviewLog.learning_steps,
    };

    try {
      await Promise.all([
        updateFlashcardAfterReview(currentCard.id, cardFields),
        logReview(currentCard.id, logFields, durationMs),
      ]);
    } catch (e) {
      console.warn("Failed to save review:", e);
    }

    // Only count unique cards toward progress (not re-queued views)
    if (!wasRequeue) {
      setUniqueCompleted((c) => c + 1);
    }

    // Update accuracy/streak stats for all reviews (including re-queues)
    if (isCorrect) setCorrectCount((c) => c + 1);
    const newStreak = isCorrect ? currentStreak + 1 : 0;
    const newBestStreak = Math.max(bestStreak, newStreak);
    setCurrentStreak(newStreak);
    setBestStreak(newBestStreak);

    // Re-queue: if FSRS says due within 10 minutes AND this card hasn't
    // already been re-queued, push it to the back for one more try
    const timeToDue = updatedCard.due.getTime() - now.getTime();
    const shouldRequeue = timeToDue < RE_QUEUE_THRESHOLD_MS && !wasRequeue;

    const newQueue = queue.slice(1);
    if (shouldRequeue) {
      requeuedSet.current.add(currentCard.id);
      newQueue.push({
        ...currentCard,
        ...cardFields,
      });
    }

    if (newQueue.length === 0) {
      const finalUniqueCompleted = uniqueCompleted + (wasRequeue ? 0 : 1);
      queryClient.invalidateQueries({ queryKey: keys.flashcards(activeLearningLanguage) });
      queryClient.invalidateQueries({ queryKey: keys.flashcardCount(activeLearningLanguage) });
      onComplete({
        reviewedCount: finalUniqueCompleted,
        correctCount: correctCount + (isCorrect ? 1 : 0),
        bestStreak: newBestStreak,
      });
      return;
    }

    setQueue(newQueue);
    setFlipped(false);
    setIsSaving(false);
    cardStartTime.current = Date.now();
  }, [
    currentCard, isSaving, queue, uniqueCompleted, correctCount,
    currentStreak, bestStreak, activeLearningLanguage, queryClient, onComplete,
  ]);

  if (!currentCard) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Review Session</Text>
        <Text style={styles.remaining}>
          {isRequeue ? "Again" : `${totalCards - uniqueCompleted} left`}
        </Text>
      </View>

      {/* Progress — tracks unique cards only */}
      <ProgressBar current={uniqueCompleted} total={totalCards} />

      {/* Flashcard */}
      <FlashcardView
        card={currentCard}
        flipped={flipped}
        onFlip={handleFlip}
      />

      {/* Rating buttons — only show when flipped */}
      {flipped ? (
        <RatingButtons onRate={handleRate} disabled={isSaving} />
      ) : (
        <View style={styles.flipPrompt}>
          <Text style={styles.flipPromptText}>Tap the card to reveal the answer</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#888",
    fontSize: 15,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  remaining: {
    color: "#888",
    fontSize: 13,
  },
  flipPrompt: {
    paddingVertical: 24,
    alignItems: "center",
  },
  flipPromptText: {
    color: "#555",
    fontSize: 14,
  },
});
