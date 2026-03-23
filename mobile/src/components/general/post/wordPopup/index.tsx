/**
 * WordPopup — frosted glass floating card above the tapped word.
 *
 * One unified shape: rounded card with integrated triangular arrow
 * pointing down at the highlighted word. Arrow is part of the card
 * background — same color, no seam, no gap.
 *
 * Layout (top to bottom):
 * 1. Word (bold) + pinyin (gray, same line) + speaker icon (far right)
 * 2. "- Translation"
 * 3. Part of speech (italic gray)
 * 4. Definition card (rounded box, sparkle icon + italic text, 3-line cap)
 * 5. "See More ∨" — ONLY if definition overflows or source sentence exists
 * 6. Dashed divider
 * 7. "Add to Vocab" button (turns green "Saved ✓" after tap)
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

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const POPUP_WIDTH = SCREEN_WIDTH * 0.82;
const ARROW_SIZE = 10;
const TOP_SAFE = 60;

export interface WordPopupData {
  word: string;
  pinyin: string | null;
  translation: string;
  contextual_definition: string;
  part_of_speech: string | null;
  source_sentence?: string;
  vocab_word_id: string;
  definition_id: string;
}

interface Props {
  data: WordPopupData | null;
  visible: boolean;
  tapX: number;
  tapY: number;
  onClose: () => void;
  onSave?: (data: WordPopupData) => void;
  language?: string;
}

export default function WordPopup({
  data, visible, tapX, tapY, onClose, onSave, language = "zh",
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // Fade in/out
  useEffect(() => {
    if (visible) {
      setExpanded(false);
      setSaved(false);
      setIsSpeaking(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start();
    }
  }, [visible]);

  // Speaker pulse
  useEffect(() => {
    if (isSpeaking) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 300, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]));
      pulseLoop.current = loop;
      loop.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [isSpeaking]);

  const handleClose = useCallback(() => { Speech.stop(); onClose(); }, [onClose]);

  const handleSpeak = useCallback(() => {
    if (!data?.word) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSpeaking(true);
    const locales: Record<string, string> = { zh: "zh-CN", en: "en-US", ja: "ja-JP", fr: "fr-FR", es: "es-ES", ko: "ko-KR", de: "de-DE" };
    Speech.speak(data.word, {
      language: locales[language] ?? language, rate: 0.8,
      onDone: () => setIsSpeaking(false), onError: () => setIsSpeaking(false),
    });
  }, [data?.word, language]);

  const handleSave = useCallback(() => {
    if (!data?.word || saved) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave?.(data);
    setSaved(true);
  }, [data, onSave, saved]);

  const handleSeeMore = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(true);
  }, []);

  if (!visible || !data) return null;

  // Position: centered on tapX, clamped to edges
  let left = tapX - POPUP_WIDTH / 2;
  left = Math.max(8, Math.min(left, SCREEN_WIDTH - POPUP_WIDTH - 8));
  const bottom = SCREEN_HEIGHT - tapY;
  const maxH = tapY - TOP_SAFE - ARROW_SIZE;
  const arrowLeft = Math.max(14, Math.min(tapX - left - ARROW_SIZE, POPUP_WIDTH - 14 - ARROW_SIZE * 2));

  const hasLongDef = data.contextual_definition && data.contextual_definition.length > 100;
  const hasSeeMore = hasLongDef || !!data.source_sentence;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim, zIndex: 30 }]} pointerEvents={visible ? "auto" : "none"}>
      <Pressable style={s.backdrop} onPress={handleClose} />

      <View style={[s.container, { left, bottom, width: POPUP_WIDTH }]}>
        {/* Card */}
        <ScrollView
          style={[s.card, { maxHeight: Math.max(maxH, 140) }]}
          contentContainerStyle={s.cardInner}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >
          {/* Row 1: Word + Pinyin + Speaker */}
          <View style={s.row1}>
            <View style={s.wordPinyinGroup}>
              <Text style={s.word}>{data.word}</Text>
              {data.pinyin ? <Text style={s.pinyin}>{data.pinyin}</Text> : null}
            </View>
            <TouchableOpacity onPress={handleSpeak} style={s.speaker} activeOpacity={0.7}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Ionicons
                  name={isSpeaking ? "volume-high" : "volume-medium-outline"}
                  size={20}
                  color={isSpeaking ? "#3b82f6" : "rgba(0,0,0,0.4)"}
                />
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* Row 2: Translation */}
          {data.translation ? <Text style={s.translation}>- {data.translation}</Text> : null}

          {/* Row 3: POS */}
          {data.part_of_speech ? <Text style={s.pos}>{data.part_of_speech}</Text> : null}

          {/* Row 4: Definition card */}
          {data.contextual_definition ? (
            <View style={s.defBox}>
              <Text style={s.sparkle}>✨</Text>
              <Text style={s.defText} numberOfLines={expanded ? undefined : 3}>
                {data.contextual_definition}
              </Text>
            </View>
          ) : null}

          {/* Row 5: See More (conditional) */}
          {hasSeeMore && !expanded ? (
            <TouchableOpacity onPress={handleSeeMore} style={s.seeMore} activeOpacity={0.6}>
              <Text style={s.seeMoreText}>See More</Text>
              <Ionicons name="chevron-down" size={13} color="rgba(255,255,255,0.4)" style={{ marginLeft: 3 }} />
            </TouchableOpacity>
          ) : null}

          {/* Expanded: source sentence */}
          {expanded && data.source_sentence ? (
            <View style={s.expandedBox}>
              <Text style={s.expandedLabel}>Context</Text>
              <Text style={s.expandedText}>"{data.source_sentence}"</Text>
            </View>
          ) : null}

          {/* Row 6: Divider */}
          <View style={s.divider} />

          {/* Row 7: Save button */}
          <TouchableOpacity onPress={handleSave} style={[s.saveBtn, saved && s.saveBtnDone]} activeOpacity={0.7}>
            {saved ? (
              <View style={s.savedRow}>
                <Ionicons name="checkmark-circle" size={15} color="#22c55e" style={{ marginRight: 5 }} />
                <Text style={s.saveBtnTextDone}>Saved</Text>
              </View>
            ) : (
              <Text style={s.saveBtnText}>Add to Vocab</Text>
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* Integrated arrow — same bg color, seamless with card */}
        <View style={[s.arrow, { marginLeft: arrowLeft }]} />
      </View>
    </Animated.View>
  );
}

const BG = "rgba(245,245,245,0.92)";

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  container: { position: "absolute" },

  card: {
    backgroundColor: BG,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 24,
  },
  cardInner: { padding: 16 },

  // Integrated arrow — same color as card, no gap
  arrow: {
    width: 0, height: 0,
    borderLeftWidth: ARROW_SIZE,
    borderRightWidth: ARROW_SIZE,
    borderTopWidth: ARROW_SIZE,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: BG,
  },

  // Row 1: word + pinyin (same line) + speaker
  row1: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  wordPinyinGroup: {
    flexDirection: "row",
    alignItems: "baseline",
    flex: 1,
    gap: 8,
  },
  word: { color: "#1a1a1a", fontSize: 28, fontWeight: "bold", letterSpacing: 1 },
  pinyin: { color: "rgba(0,0,0,0.4)", fontSize: 14 },
  speaker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.06)",
    justifyContent: "center", alignItems: "center",
    marginLeft: 8,
  },

  // Row 2: translation
  translation: { color: "#1a1a1a", fontSize: 16, marginBottom: 3 },

  // Row 3: POS
  pos: { color: "rgba(0,0,0,0.35)", fontSize: 12, fontStyle: "italic", marginBottom: 10 },

  // Row 4: definition
  defBox: {
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 10, padding: 12,
    flexDirection: "row", alignItems: "flex-start",
    marginBottom: 4,
  },
  sparkle: { fontSize: 13, marginRight: 6, marginTop: 1 },
  defText: { color: "rgba(0,0,0,0.5)", fontSize: 13, lineHeight: 18, flex: 1, fontStyle: "italic" },

  // Row 5: see more
  seeMore: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  seeMoreText: { color: "rgba(0,0,0,0.4)", fontSize: 12 },

  // Expanded
  expandedBox: { marginTop: 6, marginBottom: 2 },
  expandedLabel: { color: "rgba(0,0,0,0.3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  expandedText: { color: "rgba(0,0,0,0.5)", fontSize: 12, fontStyle: "italic", lineHeight: 17 },

  // Row 6: divider
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.1)", borderStyle: "dashed", marginVertical: 10 },

  // Row 7: save
  saveBtn: { borderWidth: 1, borderColor: "rgba(0,0,0,0.15)", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  saveBtnDone: { borderColor: "rgba(34,197,94,0.3)", backgroundColor: "rgba(34,197,94,0.15)" },
  saveBtnText: { color: "#1a1a1a", fontSize: 13, fontWeight: "500" },
  saveBtnTextDone: { color: "#22c55e", fontSize: 13, fontWeight: "500" },
  savedRow: { flexDirection: "row", alignItems: "center" },
});
