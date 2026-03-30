/**
 * SubtitleDrawer — 3-line subtitle bar + expandable transcript overlay.
 *
 * Collapsed (~100px, below video):
 *   Line 1: Pinyin (cyan, Chinese only)
 *   Line 2: Hanzi/text (white, bold, tappable characters)
 *   Line 3: Translation placeholder (grey)
 *
 * Expanded (60% screen, overlays video):
 *   Semi-transparent overlay with scrollable transcript.
 *   Tap line to seek. Auto-scrolls to active line.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SubtitleData } from "./subtitleOverlay";
import { HighlightRange } from "./subtitleOverlay";
import { WordDefinition } from "../../../../types";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const COLLAPSED_HEIGHT = 100;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const EXPANDED_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45);

interface Props {
  subtitleData: SubtitleData | null;
  currentTimeMs: number;
  highlightRange?: HighlightRange | null;
  wordDefs?: WordDefinition[];
  language?: string;
  onWordTap: (
    word: string,
    fullText: string,
    screenX: number,
    screenY: number,
    detectionIndex: number,
    charIndex: number,
  ) => void;
  onSeek: (timeMs: number) => void;
}

/** Split text into tappable units — CJK chars or Latin words. */
function splitIntoWords(text: string): { word: string; startIdx: number }[] {
  const words: { word: string; startIdx: number }[] = [];
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (cjkCount > text.length * 0.3) {
    for (let i = 0; i < text.length; i++) {
      if (text[i].trim()) {
        words.push({ word: text[i], startIdx: i });
      }
    }
  } else {
    let idx = 0;
    for (const part of text.split(/(\s+)/)) {
      if (part.trim()) {
        words.push({ word: part, startIdx: idx });
      }
      idx += part.length;
    }
  }
  return words;
}

/** Build pinyin string for a segment by matching words to wordDefs. */
function buildPinyin(segmentText: string, wordDefs?: WordDefinition[]): string {
  if (!wordDefs || wordDefs.length === 0) return "";

  const chars = segmentText.split("");
  const pinyinParts: string[] = [];
  let i = 0;

  while (i < chars.length) {
    // Try to find the longest matching wordDef starting at position i
    let matched = false;
    for (let len = Math.min(4, chars.length - i); len >= 1; len--) {
      const substr = chars.slice(i, i + len).join("");
      const wd = wordDefs.find((w) => w.display_text === substr && w.pinyin);
      if (wd && wd.pinyin) {
        pinyinParts.push(wd.pinyin);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Skip non-matching characters (punctuation, spaces)
      i++;
    }
  }

  return pinyinParts.join(" ");
}

/** Build a map of charIndex → pinyin syllable for ruby-text rendering. */
function buildPinyinMap(segmentText: string, wordDefs?: WordDefinition[]): Map<number, string> {
  const map = new Map<number, string>();
  if (!wordDefs || wordDefs.length === 0) return map;

  let i = 0;
  while (i < segmentText.length) {
    let matched = false;
    for (let len = Math.min(4, segmentText.length - i); len >= 1; len--) {
      const substr = segmentText.substring(i, i + len);
      const wd = wordDefs.find((w) => w.display_text === substr && w.pinyin);
      if (wd?.pinyin) {
        const syllables = wd.pinyin.split(" ");
        for (let j = 0; j < len && j < syllables.length; j++) {
          map.set(i + j, syllables[j]);
        }
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return map;
}

/** Format timestamp as "0:05". */
function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** Check if language has CJK pinyin. */
function hasPinyin(language?: string): boolean {
  return language === "zh" || language === "ja";
}

export { COLLAPSED_HEIGHT, EXPANDED_HEIGHT };

export default function SubtitleDrawer({
  subtitleData,
  currentTimeMs,
  highlightRange,
  wordDefs,
  language,
  onWordTap,
  onSeek,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const activeIndexRef = useRef(-1);
  const insets = useSafeAreaInsets();

  const showPinyin = hasPinyin(language);

  // Filter segments to target language only — avoid clutter from multi-lang subtitles
  const segments = useMemo(() => {
    const all = subtitleData?.segments ?? [];
    if (!language) return all;

    const isCJKLang = language === "zh" || language === "ja" || language === "ko";

    return all.filter((seg) => {
      if (!seg.detections) return false;
      const text = seg.detections.map((d) => d.text).join("");
      if (!text.trim()) return false;
      const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
      const cjkRatio = cjkCount / Math.max(text.length, 1);
      // For CJK target: keep segments with >30% CJK chars
      // For Latin target: keep segments with <30% CJK chars
      return isCJKLang ? cjkRatio > 0.3 : cjkRatio <= 0.3;
    });
  }, [subtitleData, language]);

  // Find active segment index — holds last subtitle during gaps
  const activeSegmentIndex = useMemo(() => {
    // First: check for a segment that's currently active
    for (let i = 0; i < segments.length; i++) {
      if (currentTimeMs >= segments[i].start_ms && currentTimeMs < segments[i].end_ms) {
        return i;
      }
    }
    // Gap: no segment active — hold the most recent one that already ended
    let lastEnded = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].end_ms <= currentTimeMs) {
        lastEnded = i;
      }
    }
    return lastEnded;
  }, [segments, currentTimeMs]);

  const activeSegment = activeSegmentIndex >= 0 ? segments[activeSegmentIndex] : null;
  const activeText = activeSegment?.detections?.map((d) => d.text).join("") ?? "";
  const activePinyin = showPinyin ? buildPinyin(activeText, wordDefs) : "";
  const activePinyinMap = useMemo(
    () => showPinyin ? buildPinyinMap(activeText, wordDefs) : new Map<number, string>(),
    [showPinyin, activeText, wordDefs],
  );

  // Auto-scroll in expanded mode
  useEffect(() => {
    if (expanded && activeSegmentIndex >= 0 && activeSegmentIndex !== activeIndexRef.current) {
      activeIndexRef.current = activeSegmentIndex;
      scrollRef.current?.scrollTo({ y: Math.max(0, activeSegmentIndex * 80 - 60), animated: true });
    }
  }, [expanded, activeSegmentIndex]);

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((e) => !e);
  }, []);

  const handleLineTap = useCallback(
    (segIndex: number) => {
      const seg = segments[segIndex];
      if (seg) onSeek(seg.start_ms);
    },
    [segments, onSeek],
  );

  if (!subtitleData || segments.length === 0) return null;

  // Build sentence translation from word definitions
  const activeTranslation = useMemo(() => {
    if (!activeText || !wordDefs || wordDefs.length === 0) return "";
    const wordsInOrder = wordDefs
      .filter((wd) => currentTimeMs >= wd.start_ms - 2000 && currentTimeMs < wd.end_ms + 2000)
      .sort((a, b) => a.word_index - b.word_index);
    return wordsInOrder.map((wd) => wd.translation).join(" ");
  }, [activeText, wordDefs, currentTimeMs]);

  // --- Collapsed: transcript | translation side by side ---
  const collapsedContent = (
    <Pressable style={[styles.collapsed, { height: COLLAPSED_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]} onPress={toggleExpanded}>
      <View style={styles.collapsedRow}>
        {/* Left: Transcript with ruby pinyin */}
        <View style={styles.collapsedLeft}>
          <View style={styles.rubyRow}>
            {activeText ? (
              activeSegment?.detections?.map((det, di) =>
                splitIntoWords(det.text).map((w, wi) => {
                  const isHighlighted =
                    highlightRange &&
                    highlightRange.detectionIndex === di &&
                    w.startIdx >= highlightRange.startCharIndex &&
                    w.startIdx < highlightRange.endCharIndex;

                  const py = activePinyinMap.get(w.startIdx) ?? "";

                  return (
                    <Pressable
                      key={`c-${di}-${wi}`}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        onWordTap(w.word, det.text, e.nativeEvent.pageX, e.nativeEvent.pageY, di, w.startIdx);
                      }}
                      style={[styles.rubyUnit, isHighlighted && styles.charHighlighted]}
                    >
                      {showPinyin && py ? (
                        <Text style={styles.rubyPinyin}>{py}</Text>
                      ) : null}
                      <Text style={[styles.hanziText, isHighlighted && styles.hanziTextHighlighted]}>
                        {w.word}
                      </Text>
                    </Pressable>
                  );
                }),
              )
            ) : (
              <Text style={styles.hanziText}>...</Text>
            )}
          </View>
        </View>

        {/* Divider */}
        <View style={styles.collapsedDivider} />

        {/* Right: Translation (light grey) */}
        <View style={styles.collapsedRight}>
          <Text style={styles.translationText} numberOfLines={3}>
            {activeTranslation || "Tap words for translation"}
          </Text>
        </View>
      </View>

      {/* Expand arrow */}
      <View style={styles.expandArrow}>
        <Ionicons name="chevron-up" size={16} color="rgba(255,255,255,0.4)" />
      </View>
    </Pressable>
  );

  // --- Expanded: overlay on video ---
  const expandedContent = (
    <View style={[styles.expandedOverlay, { height: EXPANDED_HEIGHT }]}>
      {/* Handle bar + header */}
      <View style={styles.expandedHeader}>
        <View style={styles.handleBar} />
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Transcript</Text>
          <TouchableOpacity onPress={toggleExpanded} style={styles.dismissButton}>
            <Ionicons name="chevron-down" size={20} color="#888" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable transcript */}
      <ScrollView
        ref={scrollRef}
        style={styles.transcriptScroll}
        contentContainerStyle={styles.transcriptContent}
        showsVerticalScrollIndicator={false}
      >
        {segments.map((seg, si) => {
          const isActive = si === activeSegmentIndex;
          if (!seg.detections) return null;
          const text = seg.detections.map((d) => d.text).join("");

          return (
            <Pressable
              key={si}
              style={[styles.transcriptItem, isActive && styles.transcriptItemActive]}
              onPress={() => handleLineTap(si)}
            >
              <Text style={styles.timestamp}>{formatTime(seg.start_ms)}</Text>

              {/* Left: transcript text with ruby pinyin */}
              <View style={styles.transcriptLeft}>
                <View style={styles.rubyRow}>
                  {seg.detections.map((det, di) => {
                    const segPinyinMap = showPinyin ? buildPinyinMap(det.text, wordDefs) : new Map();
                    return splitIntoWords(det.text).map((w, wi) => {
                      const isHighlighted =
                        isActive &&
                        highlightRange &&
                        highlightRange.detectionIndex === di &&
                        w.startIdx >= highlightRange.startCharIndex &&
                        w.startIdx < highlightRange.endCharIndex;

                      const py = segPinyinMap.get(w.startIdx) ?? "";

                      return (
                        <Pressable
                          key={`t-${si}-${di}-${wi}`}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            onWordTap(w.word, det.text, e.nativeEvent.pageX, e.nativeEvent.pageY, di, w.startIdx);
                          }}
                          style={[styles.rubyUnit, isHighlighted && styles.charHighlighted]}
                        >
                          {showPinyin && py ? (
                            <Text style={[styles.rubyPinyinSmall, isActive && styles.transcriptPinyinActive]}>{py}</Text>
                          ) : null}
                          <Text
                            style={[
                              styles.transcriptHanzi,
                              isActive && styles.transcriptHanziActive,
                              isHighlighted && styles.hanziTextHighlighted,
                            ]}
                          >
                            {w.word}
                          </Text>
                        </Pressable>
                      );
                    });
                  })}
                </View>
              </View>

              {/* Divider */}
              <View style={styles.transcriptDivider} />

              {/* Right: translation */}
              <View style={styles.transcriptRight}>
                <Text style={[styles.transcriptTranslation, isActive && styles.transcriptTranslationActive]} numberOfLines={2}>
                  {(() => {
                    if (!wordDefs) return "";
                    const segWords = wordDefs
                      .filter((wd) => seg.start_ms <= wd.start_ms + 2000 && wd.end_ms - 2000 <= seg.end_ms)
                      .sort((a, b) => a.word_index - b.word_index);
                    return segWords.map((wd) => wd.translation).join(" ") || "";
                  })()}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <>
      {/* Collapsed bar — ALWAYS rendered to hold layout space */}
      {collapsedContent}

      {/* Expanded overlay — absolute positioned ON TOP of video, doesn't affect layout */}
      {expanded && expandedContent}
    </>
  );
}

const styles = StyleSheet.create({
  // ─── Collapsed Bar ───
  collapsed: {
    backgroundColor: "#1A1A2E",
    borderTopWidth: 1,
    borderTopColor: "#00E5FF",
    paddingHorizontal: 12,
    paddingTop: 8,
    height: COLLAPSED_HEIGHT,
    justifyContent: "center",
    overflow: "hidden",
  },
  collapsedRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  collapsedLeft: {
    flex: 3,
    paddingRight: 8,
  },
  collapsedDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    alignSelf: "stretch",
    marginVertical: 4,
  },
  collapsedRight: {
    flex: 2,
    paddingLeft: 10,
  },
  pinyinLine: {
    color: "#00E5FF",
    fontSize: 11,
    fontWeight: "500",
    marginBottom: 2,
  },
  rubyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  rubyUnit: {
    alignItems: "center",
    paddingHorizontal: 1,
    paddingVertical: 1,
    borderRadius: 3,
  },
  rubyPinyin: {
    color: "#00E5FF",
    fontSize: 9,
    fontWeight: "500",
    textAlign: "center",
  },
  rubyPinyinSmall: {
    color: "rgba(0, 229, 255, 0.5)",
    fontSize: 8,
    fontWeight: "500",
    textAlign: "center",
  },
  hanziRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  charPressable: {
    paddingHorizontal: 1,
    paddingVertical: 1,
    borderRadius: 3,
  },
  charHighlighted: {
    backgroundColor: "rgba(0, 229, 255, 0.25)",
  },
  hanziText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  hanziTextHighlighted: {
    color: "#00E5FF",
  },
  translationText: {
    color: "#B0B0B0",
    fontSize: 13,
    lineHeight: 18,
  },
  expandArrow: {
    position: "absolute",
    right: 10,
    top: 8,
  },

  // ─── Expanded Overlay ───
  expandedOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#1A1A2E",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    zIndex: 50,
  },
  expandedHeader: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 20,
  },
  headerTitle: {
    color: "#00E5FF",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  dismissButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },

  // ─── Transcript List ───
  transcriptScroll: {
    flex: 1,
  },
  transcriptContent: {
    paddingHorizontal: 12,
    paddingBottom: 40,
  },
  transcriptItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    marginBottom: 4,
  },
  transcriptItemActive: {
    backgroundColor: "rgba(0, 229, 255, 0.08)",
  },
  timestamp: {
    color: "#555",
    fontSize: 10,
    width: 32,
    marginTop: 4,
    marginRight: 6,
  },
  transcriptLeft: {
    flex: 3,
    paddingRight: 6,
  },
  transcriptDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    alignSelf: "stretch",
    marginHorizontal: 4,
  },
  transcriptRight: {
    flex: 2,
    justifyContent: "center",
    paddingLeft: 6,
  },
  transcriptPinyin: {
    color: "rgba(0, 229, 255, 0.5)",
    fontSize: 10,
    fontWeight: "500",
    marginBottom: 1,
  },
  transcriptPinyinActive: {
    color: "#00E5FF",
  },
  transcriptHanzi: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  transcriptHanziActive: {
    color: "#FFFFFF",
  },
  transcriptTranslation: {
    color: "#666",
    fontSize: 12,
  },
  transcriptTranslationActive: {
    color: "#B0B0B0",
  },
});
