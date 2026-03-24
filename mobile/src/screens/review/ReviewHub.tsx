import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/store";
import { useFlashcards } from "../../hooks/useFlashcards";
import { useFlashcardCount } from "../../hooks/useFlashcardCount";
import SettingsPanel from "./components/SettingsPanel";

interface Props {
  onStartReview: () => void;
  onViewVocab: () => void;
}

function getMotivation(count: number): string {
  if (count <= 0) return "";
  if (count <= 5) return "Quick session ahead";
  if (count <= 15) return "Strengthen your memory";
  return "Big session today!";
}

function estimateMinutes(count: number): number {
  return Math.max(1, Math.round(count * 0.5));
}

export default function ReviewHub({ onStartReview, onViewVocab }: Props) {
  const activeLearningLanguage = useSelector(
    (state: RootState) => state.language.activeLearningLanguage,
  );
  const maxReviews = useSelector(
    (state: RootState) => state.auth.currentUser?.maxReviewsPerDay ?? 20,
  );
  const streakDays = useSelector(
    (state: RootState) => state.auth.currentUser?.streakDays ?? 0,
  );

  const { data: dueCards, isLoading } = useFlashcards(activeLearningLanguage, maxReviews);
  const { data: totalCount } = useFlashcardCount(activeLearningLanguage);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const dueCount = dueCards?.length ?? 0;
  const savedCount = totalCount ?? 0;

  // --- Empty: no saved words ---
  if (!isLoading && savedCount === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.appBar}>
          <Text style={styles.appBarTitle}>Review</Text>
        </View>
        <View style={styles.emptyContent}>
          <Ionicons name="book-outline" size={64} color="#555" />
          <Text style={styles.emptyTitle}>No saved words yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap words in video subtitles to save them for review
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // --- No cards due ---
  if (!isLoading && dueCount === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.appBar}>
          <Text style={styles.appBarTitle}>Review</Text>
          <TouchableOpacity onPress={() => setSettingsOpen((o) => !o)}>
            <Ionicons name="settings-outline" size={22} color="#888" />
          </TouchableOpacity>
        </View>
        {settingsOpen && (
          <SettingsPanel
            currentMax={maxReviews}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        <View style={styles.emptyContent}>
          <View style={styles.caughtUpCircle}>
            <Ionicons name="checkmark" size={48} color="#22c55e" />
          </View>
          <Text style={styles.caughtUpTitle}>All Caught Up!</Text>
          <Text style={styles.emptySubtitle}>
            No cards due right now. Check back later.
          </Text>
          <View style={styles.caughtUpStats}>
            <View style={styles.caughtUpStat}>
              <Ionicons name="flame" size={18} color="#f97316" />
              <Text style={styles.caughtUpStatText}>{streakDays} day streak</Text>
            </View>
            <View style={styles.caughtUpStat}>
              <Ionicons name="bookmark" size={18} color="#3b82f6" />
              <Text style={styles.caughtUpStatText}>{savedCount} words saved</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onViewVocab} style={styles.viewVocabLink}>
            <Ionicons name="list-outline" size={14} color="#60a5fa" />
            <Text style={styles.viewVocabText}>View saved words</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- Hub with due cards ---
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appBar}>
        <Text style={styles.appBarTitle}>Review</Text>
        <TouchableOpacity onPress={() => setSettingsOpen((o) => !o)}>
          <Ionicons name="settings-outline" size={22} color="#888" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {settingsOpen && (
          <SettingsPanel
            currentMax={maxReviews}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        {/* Hero Card */}
        <View style={styles.heroCard}>
          <Text style={styles.heroCount}>{dueCount}</Text>
          <Text style={styles.heroLabel}>cards ready</Text>
          <Text style={styles.heroMotivation}>{getMotivation(dueCount)}</Text>
          <TouchableOpacity onPress={onViewVocab} style={styles.viewVocabLink}>
            <Ionicons name="list-outline" size={14} color="#60a5fa" />
            <Text style={styles.viewVocabText}>View saved words</Text>
          </TouchableOpacity>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, streakDays > 0 && styles.statCardActive]}>
            <Ionicons name="flame" size={20} color="#f97316" />
            <Text style={styles.statValue}>{streakDays}</Text>
            <Text style={styles.statLabel}>Streak</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
            <Text style={styles.statValue}>{savedCount}</Text>
            <Text style={styles.statLabel}>Saved</Text>
          </View>
          <View style={[styles.statCard, dueCount === 0 && styles.statCardDone]}>
            <Ionicons name="flag" size={20} color="#3b82f6" />
            <Text style={styles.statValue}>
              {dueCount === 0 ? "Done!" : dueCount}
            </Text>
            <Text style={styles.statLabel}>Due</Text>
          </View>
        </View>

        {/* Start Review Button */}
        <TouchableOpacity
          style={styles.startButton}
          activeOpacity={0.8}
          onPress={onStartReview}
        >
          <View style={styles.startButtonIcon}>
            <Ionicons name="play" size={20} color="white" />
          </View>
          <View style={styles.startButtonTextContainer}>
            <Text style={styles.startButtonTitle}>Start Review</Text>
            <Text style={styles.startButtonSubtitle}>
              {dueCount} cards, ~{estimateMinutes(dueCount)} min
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  appBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  appBarTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  // Empty states
  emptyContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 16,
  },
  emptySubtitle: {
    color: "#888",
    fontSize: 15,
    marginTop: 8,
    textAlign: "center",
  },
  // Caught up
  caughtUpCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    borderWidth: 2,
    borderColor: "rgba(34, 197, 94, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  caughtUpTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 20,
  },
  caughtUpStats: {
    flexDirection: "row",
    gap: 24,
    marginTop: 24,
  },
  caughtUpStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  caughtUpStatText: {
    color: "#aaa",
    fontSize: 14,
  },
  // Hero card
  heroCard: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.2)",
    borderRadius: 20,
    paddingVertical: 32,
    alignItems: "center",
  },
  heroCount: {
    color: "white",
    fontSize: 56,
    fontWeight: "800",
  },
  heroLabel: {
    color: "#888",
    fontSize: 15,
    marginTop: 4,
  },
  heroMotivation: {
    color: "#60a5fa",
    fontSize: 14,
    fontWeight: "500",
    marginTop: 8,
  },
  viewVocabLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 14,
  },
  viewVocabText: {
    color: "#60a5fa",
    fontSize: 13,
  },
  // Stats row
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 14,
    alignItems: "center",
    gap: 4,
  },
  statCardActive: {
    backgroundColor: "rgba(249, 115, 22, 0.08)",
    borderColor: "rgba(249, 115, 22, 0.2)",
  },
  statCardDone: {
    backgroundColor: "rgba(34, 197, 94, 0.08)",
    borderColor: "rgba(34, 197, 94, 0.2)",
  },
  statValue: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
  },
  statLabel: {
    color: "#888",
    fontSize: 11,
  },
  // Start button
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 24,
    backgroundColor: "#3b82f6",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: "#3b82f6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  startButtonIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  startButtonTextContainer: {
    flex: 1,
    marginLeft: 14,
  },
  startButtonTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
  },
  startButtonSubtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    marginTop: 2,
  },
});
