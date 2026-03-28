/**
 * VisibleSubtitleOverlay — renders visible, tappable subtitle text for STT-sourced videos.
 *
 * For videos without burned-in subtitles, this component renders the subtitle text
 * at the bottom of the video as individually tappable words. Uses the same SubtitleData
 * format and O(1) lookup table as SubtitleTapOverlay, but renders visible text instead
 * of invisible tap targets.
 */

import { useMemo, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { HighlightRange, SubtitleData } from "../subtitleOverlay";

interface Props {
  subtitleData: SubtitleData | null;
  currentTimeMs: number;
  containerWidth: number;
  containerHeight: number;
  highlightRange?: HighlightRange | null;
  onWordTap?: (
    word: string,
    fullText: string,
    screenX: number,
    screenY: number,
    detectionIndex: number,
    charIndex: number,
  ) => void;
}

/**
 * Pre-compute a time-bucketed lookup table for O(1) segment retrieval.
 */
function buildLookupTable(
  segments: SubtitleData["segments"],
  durationMs: number,
  bucketSizeMs: number = 50,
) {
  const bucketCount = Math.ceil(durationMs / bucketSizeMs) + 1;
  const buckets = new Array(bucketCount).fill(null);
  for (const segment of segments) {
    const startBucket = Math.floor(segment.start_ms / bucketSizeMs);
    const endBucket = Math.ceil(segment.end_ms / bucketSizeMs);
    for (let i = startBucket; i < endBucket && i < bucketCount; i++) {
      buckets[i] = segment;
    }
  }
  return buckets;
}

/**
 * Split detection text into words. For Chinese, each character is a "word"
 * (jieba segmentation already happened in the pipeline). For Latin scripts,
 * split on spaces.
 */
function splitIntoWords(text: string): { word: string; startIdx: number }[] {
  const words: { word: string; startIdx: number }[] = [];
  // Check if text is primarily CJK
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (cjkCount > text.length * 0.3) {
    // CJK: each character is a tappable unit (pipeline already segmented via jieba)
    for (let i = 0; i < text.length; i++) {
      if (text[i].trim()) {
        words.push({ word: text[i], startIdx: i });
      }
    }
  } else {
    // Latin: split on spaces
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

export default function VisibleSubtitleOverlay({
  subtitleData,
  currentTimeMs,
  containerWidth,
  containerHeight,
  highlightRange,
  onWordTap,
}: Props) {
  const lookupTable = useMemo(() => {
    if (!subtitleData || subtitleData.segments.length === 0) return null;
    return buildLookupTable(subtitleData.segments, subtitleData.duration_ms);
  }, [subtitleData]);

  const activeSegment = useMemo(() => {
    if (!lookupTable) return null;
    const bucketIndex = Math.floor(currentTimeMs / 50);
    if (bucketIndex < 0 || bucketIndex >= lookupTable.length) return null;
    return lookupTable[bucketIndex];
  }, [lookupTable, currentTimeMs]);

  const handleWordTap = useCallback(
    (word: string, fullText: string, x: number, y: number, di: number, ci: number) => {
      if (onWordTap) {
        onWordTap(word, fullText, x, y, di, ci);
      }
    },
    [onWordTap],
  );

  if (!subtitleData || !activeSegment) return null;

  return (
    <View style={[styles.container, { bottom: containerHeight * 0.22 }]} pointerEvents="box-none">
      {activeSegment.detections.map((det, di) => {
        const words = splitIntoWords(det.text);

        return (
          <View key={di} style={styles.subtitleLine}>
            <View style={styles.textRow}>
              {words.map((w, wi) => {
                const isHighlighted =
                  highlightRange &&
                  highlightRange.detectionIndex === di &&
                  w.startIdx >= highlightRange.startCharIndex &&
                  w.startIdx < highlightRange.endCharIndex;

                return (
                  <Pressable
                    key={`${di}-${wi}`}
                    onPress={(e) => {
                      const { pageX, pageY } = e.nativeEvent;
                      handleWordTap(w.word, det.text, pageX, pageY, di, w.startIdx);
                    }}
                    style={[
                      styles.wordPressable,
                      isHighlighted && styles.wordHighlighted,
                    ]}
                  >
                    <Text style={[styles.wordText, isHighlighted && styles.wordTextHighlighted]}>
                      {w.word}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 31,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  subtitleLine: {
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 4,
    maxWidth: "90%",
  },
  textRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  wordPressable: {
    paddingHorizontal: 1,
    paddingVertical: 2,
    borderRadius: 4,
  },
  wordHighlighted: {
    backgroundColor: "rgba(255, 213, 79, 0.4)",
  },
  wordText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  wordTextHighlighted: {
    color: "#FFD54F",
  },
});
