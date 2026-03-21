/**
 * WordPopup — frosted glass card floating ABOVE the tapped word with a
 * downward-pointing arrow anchored at (tapX, tapY).
 *
 * Renders as an absolutely positioned View (NOT a Modal) so it stays in the
 * same coordinate space as the video and subtitle overlays.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const POPUP_WIDTH = SCREEN_WIDTH * 0.82;
const ARROW_SIZE = 10;
const SCREEN_EDGE_PADDING = 8;
const TOP_SAFE_AREA = 60;

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
  tapX: number; // screen X of tapped character center
  tapY: number; // screen Y of tapped character top edge
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
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const speakerScale = useRef(new Animated.Value(1)).current;
  const speakerLoop = useRef<Animated.CompositeAnimation | null>(null);

  // ---------- visibility fade ----------
  useEffect(() => {
    if (visible) {
      setExpanded(false);
      setSaved(false);
      setIsSpeaking(false);
      fadeAnim.setValue(0);

      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, fadeAnim]);

  // ---------- speaker pulse while speaking ----------
  useEffect(() => {
    if (isSpeaking) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(speakerScale, {
            toValue: 1.25,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(speakerScale, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
      );
      speakerLoop.current = loop;
      loop.start();
    } else {
      speakerLoop.current?.stop();
      speakerScale.setValue(1);
    }
  }, [isSpeaking, speakerScale]);

  // ---------- handlers ----------
  const handleClose = useCallback(() => {
    Speech.stop();
    onClose();
  }, [onClose]);

  const handleSpeak = useCallback(() => {
    if (!data?.word) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const localeMap: Record<string, string> = {
      zh: "zh-CN",
      en: "en-US",
      ja: "ja-JP",
      fr: "fr-FR",
      es: "es-ES",
      ko: "ko-KR",
      de: "de-DE",
    };

    setIsSpeaking(true);
    Speech.speak(data.word, {
      language: localeMap[language] ?? language,
      rate: 0.8,
      onDone: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  }, [data?.word, language]);

  const handleSave = useCallback(() => {
    if (!data?.word || saved) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave?.(data.word);
    setSaved(true);
  }, [data?.word, onSave, saved]);

  const handleSeeMore = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(true);
  }, []);

  // ---------- early return ----------
  if (!visible || !data) return null;

  // ---------- positioning ----------
  // Horizontally center on tapX, clamped to screen edges
  let popupLeft = tapX - POPUP_WIDTH / 2;
  popupLeft = Math.max(
    SCREEN_EDGE_PADDING,
    Math.min(popupLeft, SCREEN_WIDTH - POPUP_WIDTH - SCREEN_EDGE_PADDING),
  );

  // The popup sits ABOVE tapY. The arrow tip touches tapY.
  // Using `bottom` positioning: distance from the bottom of the screen to
  // the bottom of the arrow tip.
  const popupBottom = SCREEN_HEIGHT - tapY;

  // Max card height: from the arrow to TOP_SAFE_AREA
  const maxCardHeight = tapY - TOP_SAFE_AREA - ARROW_SIZE;

  // Arrow horizontal position relative to the popup's left edge
  const arrowLeft = Math.max(
    14,
    Math.min(tapX - popupLeft - ARROW_SIZE, POPUP_WIDTH - 14 - ARROW_SIZE * 2),
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: fadeAnim, zIndex: 30 }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      {/* Transparent backdrop to capture outside taps */}
      <Pressable style={styles.backdrop} onPress={handleClose} />

      {/* Card + Arrow positioned above the tapped word */}
      <View
        style={[
          styles.popupContainer,
          {
            left: popupLeft,
            bottom: popupBottom,
            width: POPUP_WIDTH,
          },
        ]}
      >
        {/* Scrollable card */}
        <ScrollView
          style={[
            styles.card,
            { maxHeight: maxCardHeight > 120 ? maxCardHeight : 120 },
          ]}
          contentContainerStyle={styles.cardContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          {/* 1. Word + Speaker icon */}
          <View style={styles.wordRow}>
            <Text style={styles.word}>{data.word}</Text>
            <TouchableOpacity
              onPress={handleSpeak}
              style={styles.speakerBtn}
              activeOpacity={0.7}
            >
              <Animated.View
                style={{ transform: [{ scale: speakerScale }] }}
              >
                <Ionicons
                  name={isSpeaking ? "volume-high" : "volume-medium-outline"}
                  size={20}
                  color={isSpeaking ? "#60a5fa" : "rgba(255,255,255,0.5)"}
                />
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* 2. Pinyin */}
          {data.pinyin ? (
            <Text style={styles.pinyin}>{data.pinyin}</Text>
          ) : null}

          {/* 3. Translation */}
          {data.translation ? (
            <Text style={styles.translation}>- {data.translation}</Text>
          ) : null}

          {/* 4. Part of speech */}
          {data.part_of_speech ? (
            <Text style={styles.pos}>{data.part_of_speech}</Text>
          ) : null}

          {/* 5. Contextual definition card */}
          {data.contextual_definition ? (
            <View style={styles.defCard}>
              <Text style={styles.sparkle}>✨</Text>
              <Text style={styles.defText}>
                {data.contextual_definition}
              </Text>
            </View>
          ) : null}

          {/* 6. See More / Expanded source sentence */}
          {!expanded ? (
            <TouchableOpacity
              onPress={handleSeeMore}
              style={styles.seeMoreBtn}
              activeOpacity={0.6}
            >
              <Text style={styles.seeMoreText}>See More</Text>
              <Ionicons
                name="chevron-down"
                size={13}
                color="rgba(255,255,255,0.4)"
                style={{ marginLeft: 3 }}
              />
            </TouchableOpacity>
          ) : (
            <View style={styles.expandedSection}>
              {data.source_sentence ? (
                <>
                  <Text style={styles.expandedLabel}>Source sentence</Text>
                  <Text style={styles.expandedText}>
                    &ldquo;{data.source_sentence}&rdquo;
                  </Text>
                </>
              ) : null}
            </View>
          )}

          {/* 7. Dashed divider */}
          <View style={styles.divider} />

          {/* 8. Add to Vocab / Saved button */}
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.saveBtn, saved && styles.saveBtnSaved]}
            activeOpacity={0.7}
          >
            {saved ? (
              <View style={styles.savedRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={15}
                  color="#22c55e"
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.saveBtnTextSaved}>Saved</Text>
              </View>
            ) : (
              <Text style={styles.saveBtnText}>Add to Vocab</Text>
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* Arrow pointing down at the tapped word */}
        <View style={[styles.arrow, { marginLeft: arrowLeft }]} />
      </View>
    </Animated.View>
  );
}

const CARD_BG = "rgba(35,35,35,0.94)";

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },

  popupContainer: {
    position: "absolute",
    // The container's bottom edge = arrow tip = tapY
    // Card stacks above the arrow via normal flow
  },

  card: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 24,
  },
  cardContent: {
    padding: 16,
  },

  // Arrow
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_SIZE,
    borderRightWidth: ARROW_SIZE,
    borderTopWidth: ARROW_SIZE,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: CARD_BG,
  },

  // 1. Word row
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
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },

  // 2. Pinyin
  pinyin: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    marginTop: 2,
    marginBottom: 6,
  },

  // 3. Translation
  translation: {
    color: "#ffffff",
    fontSize: 16,
    marginBottom: 4,
  },

  // 4. Part of speech
  pos: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
    fontStyle: "italic",
    marginBottom: 10,
  },

  // 5. Contextual definition card
  defCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  sparkle: {
    fontSize: 13,
    marginRight: 6,
    marginTop: 1,
  },
  defText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontStyle: "italic",
  },

  // 6. See More
  seeMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  seeMoreText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
  },

  // Expanded section
  expandedSection: {
    marginTop: 6,
    marginBottom: 2,
  },
  expandedLabel: {
    color: "rgba(255,255,255,0.25)",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  expandedText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 17,
  },

  // 7. Divider
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
    borderStyle: "dashed",
    marginVertical: 10,
  },

  // 8. Add to Vocab button
  saveBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveBtnSaved: {
    borderColor: "rgba(34,197,94,0.3)",
    backgroundColor: "rgba(34,197,94,0.2)",
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "500",
  },
  saveBtnTextSaved: {
    color: "#22c55e",
    fontSize: 13,
    fontWeight: "500",
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
  },
});
