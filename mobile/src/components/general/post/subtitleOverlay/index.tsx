/**
 * SubtitleTapOverlay — renders invisible tap targets over burned-in subtitle characters.
 *
 * Uses pre-extracted OCR bounding box data (from scripts/extract_subtitles.py) to place
 * invisible Pressable components over each character in the video. When tapped, shows
 * the character in an alert (will be replaced with translation popup in M5).
 *
 * The video is displayed with contentFit="contain" which scales to fit and centers.
 * This component transforms OCR pixel coordinates → screen coordinates accounting
 * for the scaling and centering offset.
 */

import { useMemo, useCallback } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";

/** Shape of per-character bounding box from OCR JSON */
interface CharBox {
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shape of a subtitle detection from OCR JSON */
interface Detection {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  chars: CharBox[];
}

/** Shape of a subtitle segment (deduplicated across frames) */
interface SubtitleSegment {
  start_ms: number;
  end_ms: number;
  detections: Detection[];
}

/** Full OCR data for a video */
export interface SubtitleData {
  video: string;
  resolution: { width: number; height: number };
  duration_ms: number;
  frame_interval_ms?: number;
  segments: SubtitleSegment[];
}

interface Props {
  subtitleData: SubtitleData | null;
  currentTimeMs: number;
  containerWidth: number;
  containerHeight: number;
  onCharTap?: (char: string, fullText: string) => void;
}

/**
 * Transform OCR coordinates to screen coordinates.
 *
 * Video is rendered with contentFit="contain" which maps to
 * AVLayerVideoGravity.resizeAspect on iOS — this centers the video
 * both horizontally and vertically within the container.
 */
function getVideoTransform(
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number,
) {
  const videoAspect = videoW / videoH;
  const containerAspect = containerW / containerH;

  let scale: number;
  let offsetX: number;
  let offsetY: number;

  if (videoAspect > containerAspect) {
    // Video is wider — fit to container width, center vertically
    scale = containerW / videoW;
    offsetX = 0;
    offsetY = (containerH - videoH * scale) / 2;
  } else {
    // Video is taller — fit to container height, center horizontally
    scale = containerH / videoH;
    offsetX = (containerW - videoW * scale) / 2;
    offsetY = 0;
  }

  return { scale, offsetX, offsetY };
}

/**
 * Pre-compute a time-bucketed lookup table for O(1) segment retrieval.
 * Each bucket maps a time range to the active subtitle segment (or null).
 * Built once when subtitle data loads — no searching at runtime.
 */
function buildLookupTable(
  segments: SubtitleSegment[],
  durationMs: number,
  bucketSizeMs: number = 50,
): (SubtitleSegment | null)[] {
  const bucketCount = Math.ceil(durationMs / bucketSizeMs) + 1;
  const buckets = new Array<SubtitleSegment | null>(bucketCount).fill(null);

  for (const segment of segments) {
    const startBucket = Math.floor(segment.start_ms / bucketSizeMs);
    const endBucket = Math.ceil(segment.end_ms / bucketSizeMs);
    for (let i = startBucket; i < endBucket && i < bucketCount; i++) {
      buckets[i] = segment;
    }
  }
  return buckets;
}

export default function SubtitleTapOverlay({
  subtitleData,
  currentTimeMs,
  containerWidth,
  containerHeight,
  onCharTap,
}: Props) {
  // Build lookup table once — O(1) access at runtime instead of O(n) search
  const lookupTable = useMemo(() => {
    if (!subtitleData || subtitleData.segments.length === 0) return null;
    return buildLookupTable(subtitleData.segments, subtitleData.duration_ms);
  }, [subtitleData]);

  // O(1) lookup — just index into the pre-computed array
  const activeSegment = useMemo(() => {
    if (!lookupTable) return null;
    const bucketIndex = Math.floor(currentTimeMs / 50);
    if (bucketIndex < 0 || bucketIndex >= lookupTable.length) return null;
    return lookupTable[bucketIndex];
  }, [lookupTable, currentTimeMs]);

  const handleCharTap = useCallback(
    (char: string, fullText: string) => {
      if (onCharTap) {
        onCharTap(char, fullText);
      } else {
        Alert.alert(char, `From: "${fullText}"`);
      }
    },
    [onCharTap],
  );

  if (!subtitleData || !activeSegment) return null;

  const { scale, offsetX, offsetY } = getVideoTransform(
    subtitleData.resolution.width,
    subtitleData.resolution.height,
    containerWidth,
    containerHeight,
  );

  return (
    <View style={styles.container} pointerEvents="box-none">
      {activeSegment.detections.map((det, di) =>
        det.chars.map((ch, ci) => {
          // Transform OCR pixel coords to screen coords
          const screenX = ch.x * scale + offsetX;
          const screenY = ch.y * scale + offsetY;
          const screenW = ch.width * scale;
          const screenH = ch.height * scale;

          return (
            <Pressable
              key={`${di}-${ci}`}
              onPress={() => handleCharTap(ch.char, det.text)}
              style={[
                styles.charTarget,
                {
                  left: screenX,
                  top: screenY,
                  width: screenW,
                  height: screenH,
                },
              ]}
            >
              {/* DEBUG: uncomment to see tap target boundaries */}
              {/* <Text style={styles.debugText}>{ch.char}</Text> */}
            </Pressable>
          );
        }),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  charTarget: {
    position: "absolute",
    // DEBUG MODE: red boxes show tap target boundaries
    // Remove these 2 lines once alignment is verified
    backgroundColor: "rgba(255,0,0,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.5)",
  },
  debugText: {
    color: "yellow",
    fontSize: 10,
    textAlign: "center",
  },
});
