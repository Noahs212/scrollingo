/**
 * WordPopup — floating card positioned above the tapped word with arrow pointing down.
 *
 * Layout (matching the Chinese reading app reference):
 * - Source sentence translation
 * - Word (large bold) + speaker icon
 * - Pinyin
 * - "- Translation"
 * - Part of speech (italic)
 * - Contextual definition card with sparkle icon
 * - "See More ∨" link
 * - Dashed divider
 * - "Add to Vocab" button
 * - Arrow pointing down to the highlighted word
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const POPUP_WIDTH = SCREEN_WIDTH * 0.82;
const ARROW_SIZE = 10;

export interface WordPopupData {
  word: string;
  pinyin: string | null;
  translation: string;
  contextual_definition: string;
  part_of_speech: string | null;
  source_sentence?: string;
}

interface Props {
  data: WordPopupData | null;
  visible: boolean;
  tapX: number;
  tapY: number;
  onClose: () => void;
  onSave?: (word: string) => void;
  language?: string;
}

export default function WordPopup({
  data,
  visible,
  tapX,
  tapY,
  onClose,
  onSave,
  language = "zh",
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleClose = useCallback(() => {
    setShowMore(false);
    onClose();
  }, [onClose]);

  const handleSpeak = useCallback(() => {
    if (!data?.word) return;
    const localeMap: Record<string, string> = {
      zh: "zh-CN", en: "en-US", ja: "ja-JP", fr: "fr-FR", es: "es-ES",
    };
    setIsSpeaking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Speech.speak(data.word, {
      language: localeMap[language] ?? language,
      rate: 0.8,
      onDone: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  }, [data?.word, language]);

  const handleSave = useCallback(() => {
    if (!data?.word) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave?.(data.word);
  }, [data?.word, onSave]);

  if (!visible || !data) return null;

  // Position popup above the tapped word
  // Center horizontally on tap point, clamped to screen edges
  let popupLeft = tapX - POPUP_WIDTH / 2;
  popupLeft = Math.max(8, Math.min(popupLeft, SCREEN_WIDTH - POPUP_WIDTH - 8));

  // Position above the tap point (popup bottom edge at tapY - gap)
  // If that would go off screen top, position below instead
  const popupBottom = SCREEN_HEIGHT - tapY + ARROW_SIZE + 4;

  // Arrow horizontal position relative to popup
  const arrowLeft = tapX - popupLeft - ARROW_SIZE;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={handleClose} />

      {/* Popup card positioned above the tapped word */}
      <View
        style={[
          styles.popupCard,
          {
            left: popupLeft,
            bottom: popupBottom,
            width: POPUP_WIDTH,
          },
        ]}
      >
        {/* Source sentence */}
        {data.source_sentence && (
          <Text style={styles.contextSentence} numberOfLines={2}>
            {data.source_sentence}
          </Text>
        )}

        {/* Word + Speaker */}
        <View style={styles.wordRow}>
          <Text style={styles.word}>{data.word}</Text>
          <TouchableOpacity onPress={handleSpeak} style={styles.speakerBtn}>
            <Ionicons
              name={isSpeaking ? "volume-high" : "volume-medium-outline"}
              size={20}
              color={isSpeaking ? "#fe2c55" : "rgba(255,255,255,0.5)"}
            />
          </TouchableOpacity>
        </View>

        {/* Pinyin */}
        {data.pinyin && (
          <Text style={styles.pinyin}>{data.pinyin}</Text>
        )}

        {/* Translation */}
        {data.translation ? (
          <Text style={styles.translation}>- {data.translation}</Text>
        ) : null}

        {/* Part of speech */}
        {data.part_of_speech && (
          <Text style={styles.pos}>{data.part_of_speech}</Text>
        )}

        {/* Contextual definition card */}
        {data.contextual_definition ? (
          <View style={styles.defCard}>
            <Ionicons name="sparkles" size={13} color="rgba(255,255,255,0.35)" style={styles.defIcon} />
            <Text style={styles.defText} numberOfLines={showMore ? undefined : 3}>
              {data.contextual_definition}
            </Text>
          </View>
        ) : null}

        {/* See More */}
        {!showMore && (
          <TouchableOpacity onPress={() => setShowMore(true)} style={styles.seeMoreBtn}>
            <Text style={styles.seeMoreText}>See More</Text>
            <Ionicons name="chevron-down" size={13} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        )}

        {/* Expanded context */}
        {showMore && data.source_sentence && (
          <View style={styles.expandedSection}>
            <Text style={styles.expandedLabel}>Context</Text>
            <Text style={styles.expandedText}>"{data.source_sentence}"</Text>
          </View>
        )}

        {/* Divider */}
        <View style={styles.divider} />

        {/* Add to Vocab */}
        <TouchableOpacity onPress={handleSave} style={styles.saveBtn}>
          <Text style={styles.saveBtnText}>Add to Vocab</Text>
        </TouchableOpacity>

        {/* Arrow pointing down */}
        <View
          style={[
            styles.arrow,
            { left: Math.max(12, Math.min(arrowLeft, POPUP_WIDTH - 32)) },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  popupCard: {
    position: "absolute",
    backgroundColor: "rgba(40, 40, 40, 0.95)",
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 20,
    zIndex: 30,
  },

  // Arrow
  arrow: {
    position: "absolute",
    bottom: -ARROW_SIZE,
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_SIZE,
    borderRightWidth: ARROW_SIZE,
    borderTopWidth: ARROW_SIZE,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(40, 40, 40, 0.95)",
  },

  // Context sentence
  contextSentence: {
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 16,
  },

  // Word row
  wordRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  word: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "bold",
    letterSpacing: 2,
  },
  speakerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Pinyin
  pinyin: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 14,
    marginTop: 2,
    marginBottom: 6,
  },

  // Translation
  translation: {
    color: "#ffffff",
    fontSize: 16,
    marginBottom: 3,
  },

  // POS
  pos: {
    color: "rgba(255, 255, 255, 0.3)",
    fontSize: 12,
    fontStyle: "italic",
    marginBottom: 10,
  },

  // Def card
  defCard: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 2,
  },
  defIcon: {
    marginRight: 6,
    marginTop: 2,
  },
  defText: {
    color: "rgba(255, 255, 255, 0.55)",
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontStyle: "italic",
  },

  // See More
  seeMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 4,
  },
  seeMoreText: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 12,
  },

  // Expanded
  expandedSection: {
    marginTop: 6,
  },
  expandedLabel: {
    color: "rgba(255, 255, 255, 0.25)",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 3,
  },
  expandedText: {
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 16,
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    marginVertical: 10,
  },

  // Save
  saveBtn: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "500",
  },
});
