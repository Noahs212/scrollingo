import { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "react-redux";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";

import { RootState } from "../../redux/store";
import { fetchAllFlashcards, deleteFlashcard, toggleStarred } from "../../services/flashcards";
import { keys } from "../../hooks/queryKeys";
import { Flashcard } from "../../../types";

const LOCALE_MAP: Record<string, string> = {
  zh: "zh-CN", en: "en-US", ja: "ja-JP", fr: "fr-FR",
  es: "es-ES", ko: "ko-KR", de: "de-DE",
};

interface Props {
  onBack: () => void;
}

export default function VocabList({ onBack }: Props) {
  const activeLearningLanguage = useSelector(
    (state: RootState) => state.language.activeLearningLanguage,
  );
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "starred">("all");

  const { data: allCards = [], isLoading } = useQuery({
    queryKey: keys.allFlashcards(activeLearningLanguage),
    queryFn: () => fetchAllFlashcards(activeLearningLanguage!),
    enabled: !!activeLearningLanguage,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFlashcard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.allFlashcards(activeLearningLanguage) });
      queryClient.invalidateQueries({ queryKey: keys.flashcardCount(activeLearningLanguage) });
      queryClient.invalidateQueries({ queryKey: keys.flashcards(activeLearningLanguage) });
    },
  });

  const starMutation = useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) =>
      toggleStarred(id, starred),
    onMutate: async ({ id, starred }) => {
      // Optimistic update — toggle star immediately in cache
      await queryClient.cancelQueries({ queryKey: keys.allFlashcards(activeLearningLanguage) });
      queryClient.setQueryData<Flashcard[]>(
        keys.allFlashcards(activeLearningLanguage),
        (old) => old?.map((c) => (c.id === id ? { ...c, starred } : c)),
      );
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: keys.allFlashcards(activeLearningLanguage) });
    },
  });

  const handleDelete = useCallback((card: Flashcard) => {
    Alert.alert(
      "Remove Word",
      `Remove "${card.word}" from your vocab?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            deleteMutation.mutate(card.id);
          },
        },
      ],
    );
  }, [deleteMutation]);

  const handleToggleStar = useCallback((card: Flashcard) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    starMutation.mutate({ id: card.id, starred: !card.starred });
  }, [starMutation]);

  const handleSpeak = useCallback((card: Flashcard) => {
    Speech.speak(card.word, {
      language: LOCALE_MAP[card.language] ?? card.language,
      rate: 0.8,
    });
  }, []);

  const filteredCards = filter === "starred"
    ? allCards.filter((c) => c.starred)
    : allCards;

  const getStateLabel = (state: number): string => {
    switch (state) {
      case 0: return "New";
      case 1: return "Learning";
      case 2: return "Review";
      case 3: return "Relearning";
      default: return "";
    }
  };

  const getStateColor = (state: number): string => {
    switch (state) {
      case 0: return "#3b82f6";
      case 1: return "#f97316";
      case 2: return "#22c55e";
      case 3: return "#ef4444";
      default: return "#888";
    }
  };

  const renderCard = useCallback(({ item }: { item: Flashcard }) => (
    <View style={styles.cardRow}>
      {/* Star button */}
      <TouchableOpacity
        style={styles.starButton}
        onPress={() => handleToggleStar(item)}
      >
        <Ionicons
          name={item.starred ? "star" : "star-outline"}
          size={20}
          color={item.starred ? "#eab308" : "#555"}
        />
      </TouchableOpacity>

      {/* Word info */}
      <View style={styles.cardContent}>
        <View style={styles.wordRow}>
          <Text style={styles.wordText}>{item.word}</Text>
          {item.pinyin ? (
            <Text style={styles.pinyinText}>{item.pinyin}</Text>
          ) : null}
          <TouchableOpacity onPress={() => handleSpeak(item)} style={styles.speakBtn}>
            <Ionicons name="volume-medium-outline" size={16} color="#60a5fa" />
          </TouchableOpacity>
        </View>
        <Text style={styles.translationText} numberOfLines={1}>
          {item.translation}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.stateBadge, { backgroundColor: `${getStateColor(item.state)}20` }]}>
            <Text style={[styles.stateText, { color: getStateColor(item.state) }]}>
              {getStateLabel(item.state)}
            </Text>
          </View>
          {item.reps > 0 ? (
            <Text style={styles.metaText}>{item.reps} reviews</Text>
          ) : null}
        </View>
      </View>

      {/* Delete button */}
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDelete(item)}
      >
        <Ionicons name="trash-outline" size={18} color="#ef4444" />
      </TouchableOpacity>
    </View>
  ), [handleToggleStar, handleSpeak, handleDelete]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved Words</Text>
        <Text style={styles.headerCount}>{allCards.length}</Text>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterTab, filter === "all" && styles.filterTabActive]}
          onPress={() => setFilter("all")}
        >
          <Text style={[styles.filterText, filter === "all" && styles.filterTextActive]}>
            All ({allCards.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterTab, filter === "starred" && styles.filterTabActive]}
          onPress={() => setFilter("starred")}
        >
          <Ionicons
            name="star"
            size={14}
            color={filter === "starred" ? "#eab308" : "#888"}
            style={{ marginRight: 4 }}
          />
          <Text style={[styles.filterText, filter === "starred" && styles.filterTextActive]}>
            Starred ({allCards.filter((c) => c.starred).length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : filteredCards.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name={filter === "starred" ? "star-outline" : "book-outline"}
            size={48}
            color="#555"
          />
          <Text style={styles.emptyTitle}>
            {filter === "starred" ? "No starred words" : "No saved words"}
          </Text>
          <Text style={styles.emptyText}>
            {filter === "starred"
              ? "Star words to find them quickly"
              : "Tap words in video subtitles to save them"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredCards}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
    flex: 1,
  },
  headerCount: {
    color: "#888",
    fontSize: 15,
  },
  // Filters
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  filterTab: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  filterTabActive: {
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  filterText: {
    color: "#888",
    fontSize: 13,
    fontWeight: "500",
  },
  filterTextActive: {
    color: "#60a5fa",
  },
  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    marginBottom: 8,
  },
  starButton: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  cardContent: {
    flex: 1,
  },
  wordRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  wordText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  pinyinText: {
    color: "#888",
    fontSize: 13,
  },
  speakBtn: {
    marginLeft: 4,
    padding: 2,
  },
  translationText: {
    color: "#aaa",
    fontSize: 14,
    marginTop: 3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  stateText: {
    fontSize: 11,
    fontWeight: "600",
  },
  metaText: {
    color: "#666",
    fontSize: 11,
  },
  deleteButton: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  // Empty
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
  },
  emptyText: {
    color: "#888",
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
  },
});
