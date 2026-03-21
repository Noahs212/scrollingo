/**
 * WordPopup — glassmorphism bottom sheet showing word translation + definition.
 *
 * Design: TikTok-native dark glass style. Frosted translucent background,
 * spring animations, haptic feedback. No visible borders — uses spacing
 * and opacity for hierarchy.
 *
 * Snap points: 40% (compact) → 70% (expanded via "more ▸")
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";

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
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [expanded, setExpanded] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const snapPoints = useMemo(() => ["40%", "70%"], []);

  const handleClose = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  const handleSpeak = useCallback(() => {
    if (!data?.word) return;

    // Map language codes to Speech locale codes
    const localeMap: Record<string, string> = {
      zh: "zh-CN",
      en: "en-US",
      ja: "ja-JP",
      fr: "fr-FR",
      es: "es-ES",
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

  const handleExpand = useCallback(() => {
    setExpanded(true);
    bottomSheetRef.current?.snapToIndex(1);
  }, []);

  if (!visible || !data) return null;

  const needsExpand =
    data.contextual_definition && data.contextual_definition.length > 80;

  return (
    <View style={styles.fullScreenContainer}>
      {/* Backdrop — covers action buttons, tappable to dismiss */}
      <Pressable style={styles.backdrop} onPress={handleClose} />

      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        onClose={handleClose}
        enablePanDownToClose
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handle}
        animateOnMount
      >
      <BottomSheetView style={styles.content}>
        {/* Word + Pinyin + Speaker */}
        <View style={styles.wordRow}>
          <View style={styles.wordLeft}>
            <Text style={styles.word}>{data.word}</Text>
            {data.pinyin && (
              <Text style={styles.pinyin}>{data.pinyin}</Text>
            )}
          </View>
          <TouchableOpacity
            onPress={handleSpeak}
            style={styles.speakerButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isSpeaking ? "volume-high" : "volume-medium-outline"}
              size={24}
              color={isSpeaking ? "#fe2c55" : "rgba(255,255,255,0.5)"}
            />
          </TouchableOpacity>
        </View>

        {/* Translation + POS */}
        <View style={styles.translationRow}>
          <Text style={styles.translation}>{data.translation}</Text>
          {data.part_of_speech && (
            <View style={styles.posPill}>
              <Text style={styles.posText}>{data.part_of_speech}</Text>
            </View>
          )}
        </View>

        {/* Contextual Definition */}
        {data.contextual_definition ? (
          <View style={styles.definitionRow}>
            <Text
              style={styles.definition}
              numberOfLines={expanded ? undefined : 2}
            >
              {data.contextual_definition}
            </Text>
            {needsExpand && !expanded && (
              <TouchableOpacity onPress={handleExpand}>
                <Text style={styles.moreLink}>more ▸</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {/* Source sentence (expanded only) */}
        {expanded && data.source_sentence && (
          <View style={styles.sourceRow}>
            <Text style={styles.sourceLabel}>Context</Text>
            <Text style={styles.sourceText}>"{data.source_sentence}"</Text>
          </View>
        )}

        {/* Save button */}
        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSave}
          activeOpacity={0.7}
        >
          <Ionicons name="heart-outline" size={18} color="white" />
          <Text style={styles.saveText}>Save for later</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreenContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheetBackground: {
    backgroundColor: "rgba(20, 20, 20, 0.92)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },

  // Word row
  wordRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  wordLeft: {
    flex: 1,
  },
  word: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  pinyin: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 16,
    marginTop: 4,
  },
  speakerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 12,
  },

  // Translation row
  translationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  translation: {
    color: "#fe2c55",
    fontSize: 20,
    fontWeight: "600",
    flex: 1,
  },
  posPill: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  posText: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 12,
  },

  // Definition
  definitionRow: {
    marginBottom: 16,
  },
  definition: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 14,
    lineHeight: 20,
  },
  moreLink: {
    color: "#fe2c55",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },

  // Source sentence (expanded)
  sourceRow: {
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  sourceLabel: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 12,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sourceText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 20,
  },

  // Save button
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingVertical: 14,
    borderRadius: 24,
    gap: 8,
    marginTop: 8,
  },
  saveText: {
    color: "white",
    fontSize: 15,
    fontWeight: "500",
  },
});
