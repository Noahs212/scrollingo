/**
 * WordPopup — floating card popup near the tapped word.
 *
 * Appears as a card overlay near the subtitle, NOT a bottom sheet drawer.
 * "See More" expands to a full bottom sheet drawer for extended info.
 * Inspired by Chinese reading app word-tap pattern.
 */

import { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

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
  onClose: () => void;
  onSave?: (word: string) => void;
  language?: string;
}

export default function WordPopup({
  data,
  visible,
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

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable
          style={styles.popupCard}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Source sentence + translation */}
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
                size={22}
                color={isSpeaking ? "#fe2c55" : "rgba(255,255,255,0.6)"}
              />
            </TouchableOpacity>
          </View>

          {/* Pinyin */}
          {data.pinyin && (
            <Text style={styles.pinyin}>{data.pinyin}</Text>
          )}

          {/* Translation */}
          <Text style={styles.translation}>- {data.translation}</Text>

          {/* Part of speech */}
          {data.part_of_speech && (
            <Text style={styles.pos}>{data.part_of_speech}</Text>
          )}

          {/* Contextual definition card */}
          {data.contextual_definition ? (
            <View style={styles.defCard}>
              <Ionicons name="sparkles" size={14} color="rgba(255,255,255,0.4)" style={styles.defIcon} />
              <Text style={styles.defText} numberOfLines={showMore ? undefined : 3}>
                {data.contextual_definition}
              </Text>
            </View>
          ) : null}

          {/* See More */}
          {data.contextual_definition && data.contextual_definition.length > 60 && !showMore && (
            <TouchableOpacity onPress={() => setShowMore(true)} style={styles.seeMoreBtn}>
              <Text style={styles.seeMoreText}>See More</Text>
              <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          )}

          {/* Expanded: source sentence with translation */}
          {showMore && data.source_sentence && (
            <View style={styles.expandedSection}>
              <Text style={styles.expandedLabel}>Context</Text>
              <Text style={styles.expandedText}>"{data.source_sentence}"</Text>
            </View>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Add to Vocab button */}
          <TouchableOpacity onPress={handleSave} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>Add to Vocab</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  popupCard: {
    width: SCREEN_WIDTH * 0.85,
    maxHeight: SCREEN_HEIGHT * 0.6,
    backgroundColor: "rgba(30, 30, 30, 0.95)",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },

  // Context sentence
  contextSentence: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },

  // Word row
  wordRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  word: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "bold",
    letterSpacing: 2,
  },
  speakerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Pinyin
  pinyin: {
    color: "rgba(255, 255, 255, 0.45)",
    fontSize: 15,
    marginTop: 2,
    marginBottom: 8,
  },

  // Translation
  translation: {
    color: "#ffffff",
    fontSize: 18,
    marginBottom: 4,
  },

  // Part of speech
  pos: {
    color: "rgba(255, 255, 255, 0.35)",
    fontSize: 13,
    fontStyle: "italic",
    marginBottom: 12,
  },

  // Definition card
  defCard: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  defIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  defText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
    fontStyle: "italic",
  },

  // See More
  seeMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 4,
  },
  seeMoreText: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 13,
  },

  // Expanded section
  expandedSection: {
    marginTop: 8,
    paddingTop: 8,
  },
  expandedLabel: {
    color: "rgba(255, 255, 255, 0.3)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  expandedText: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginVertical: 12,
  },

  // Save button
  saveBtn: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "500",
  },
});
