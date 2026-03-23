import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { Flashcard } from "../../../../types";

interface Props {
  card: Flashcard;
  flipped: boolean;
  onFlip: () => void;
}

const FLIP_DURATION = 400;

const LOCALE_MAP: Record<string, string> = {
  zh: "zh-CN", en: "en-US", ja: "ja-JP", fr: "fr-FR",
  es: "es-ES", ko: "ko-KR", de: "de-DE",
};

export default function FlashcardView({ card, flipped, onFlip }: Props) {
  const flipAnim = useRef(new Animated.Value(0)).current;
  const entranceAnim = useRef(new Animated.Value(0)).current;
  const [showPinyin, setShowPinyin] = useState(false);
  const [cardKey, setCardKey] = useState(card.id);

  // Entrance animation for new cards
  useEffect(() => {
    if (card.id !== cardKey) {
      setCardKey(card.id);
      setShowPinyin(false);
      entranceAnim.setValue(0);
      flipAnim.setValue(0);
      Animated.timing(entranceAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [card.id, cardKey, entranceAnim, flipAnim]);

  // Initial entrance
  useEffect(() => {
    entranceAnim.setValue(0);
    Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Flip animation
  useEffect(() => {
    Animated.timing(flipAnim, {
      toValue: flipped ? 1 : 0,
      duration: FLIP_DURATION,
      useNativeDriver: true,
    }).start();
  }, [flipped, flipAnim]);

  const handleSpeak = useCallback(() => {
    Speech.speak(card.word, {
      language: LOCALE_MAP[card.language] ?? card.language,
      rate: 0.8,
    });
  }, [card.word, card.language]);

  // Front rotates 0 → 90deg, back rotates -90 → 0deg
  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["0deg", "90deg", "90deg"],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["-90deg", "-90deg", "0deg"],
  });
  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.49, 0.51, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.49, 0.51, 1],
    outputRange: [0, 0, 1, 1],
  });

  const entranceTranslateY = entranceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [50, 0],
  });
  const entranceScale = entranceAnim.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.8, 1.03, 1],
  });

  const hasPinyin = card.language === "zh" || card.language === "ja";

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          opacity: entranceAnim,
          transform: [
            { translateY: entranceTranslateY },
            { scale: entranceScale },
          ],
        },
      ]}
    >
      <TouchableOpacity activeOpacity={0.95} onPress={onFlip}>
        {/* Front */}
        <Animated.View
          style={[
            styles.card,
            styles.cardFront,
            {
              opacity: frontOpacity,
              transform: [{ perspective: 1000 }, { rotateY: frontRotate }],
            },
          ]}
        >
          <View style={styles.badgeRow}>
            <View style={[styles.badge, styles.badgeBlue]}>
              <Text style={styles.badgeText}>WORD</Text>
            </View>
          </View>

          <Text style={styles.wordText}>{card.word}</Text>

          {hasPinyin && card.pinyin ? (
            <TouchableOpacity
              style={[styles.pinyinToggle, showPinyin && styles.pinyinToggleActive]}
              onPress={() => setShowPinyin((p) => !p)}
            >
              <Text style={[styles.pinyinText, showPinyin && styles.pinyinTextActive]}>
                {showPinyin ? card.pinyin : "Show Pinyin"}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={styles.speakerButton} onPress={handleSpeak}>
            <Ionicons name="volume-medium-outline" size={24} color="#60a5fa" />
          </TouchableOpacity>
        </Animated.View>

        {/* Back */}
        <Animated.View
          style={[
            styles.card,
            styles.cardBack,
            {
              opacity: backOpacity,
              transform: [{ perspective: 1000 }, { rotateY: backRotate }],
            },
          ]}
        >
          <View style={styles.badgeRow}>
            <View style={[styles.badge, styles.badgeGreen]}>
              <Text style={[styles.badgeText, { color: "#22c55e" }]}>MEANING</Text>
            </View>
            <View style={styles.flipHint}>
              <Ionicons name="hand-left-outline" size={12} color="#555" />
              <Text style={styles.flipHintText}>Tap to flip</Text>
            </View>
          </View>

          <Text style={styles.translationText}>{card.translation}</Text>

          {card.part_of_speech ? (
            <Text style={styles.posText}>{card.part_of_speech}</Text>
          ) : null}

          {card.contextual_definition ? (
            <Text style={styles.definitionText}>{card.contextual_definition}</Text>
          ) : null}
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: "center",
    marginHorizontal: 16,
  },
  card: {
    borderRadius: 24,
    padding: 24,
    minHeight: 280,
    justifyContent: "center",
    alignItems: "center",
  },
  cardFront: {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.25)",
  },
  cardBack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(34, 197, 94, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.25)",
    minHeight: 280,
    borderRadius: 24,
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeRow: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeBlue: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
  },
  badgeGreen: {
    backgroundColor: "rgba(34, 197, 94, 0.15)",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#3b82f6",
    letterSpacing: 1,
  },
  flipHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  flipHintText: {
    color: "#555",
    fontSize: 11,
  },
  wordText: {
    color: "white",
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
  },
  pinyinToggle: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  pinyinToggleActive: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
  },
  pinyinText: {
    color: "#888",
    fontSize: 15,
  },
  pinyinTextActive: {
    color: "#60a5fa",
  },
  speakerButton: {
    marginTop: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  translationText: {
    color: "white",
    fontSize: 22,
    fontWeight: "600",
    textAlign: "center",
  },
  posText: {
    color: "#666",
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 6,
  },
  definitionText: {
    color: "#aaa",
    fontSize: 15,
    marginTop: 16,
    textAlign: "center",
    lineHeight: 22,
  },
});
