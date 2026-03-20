/**
 * Developer OCR Comparison Screen
 *
 * Compares subtitle extraction results from different OCR models side-by-side.
 * Hidden under Settings > Developer Menu.
 *
 * How to add a new model for comparison:
 * 1. Run your OCR extraction script, output JSON in the same format as
 *    assets/subtitles/video_N.json but in a model-specific subfolder:
 *    assets/subtitles/modelName/video_N.json
 * 2. Add the model to the MODELS array below with a name, color, and loader.
 * 3. The screen will automatically show it in the comparison view.
 *
 * JSON format expected per model:
 * {
 *   "video": "video_2",
 *   "resolution": { "width": 720, "height": 1280 },
 *   "duration_ms": 11633,
 *   "segments": [{
 *     "start_ms": 0, "end_ms": 1000,
 *     "detections": [{
 *       "text": "你好",
 *       "confidence": 0.99,
 *       "bbox": { "x": 100, "y": 800, "width": 200, "height": 80 },
 *       "chars": [
 *         { "char": "你", "x": 100, "y": 800, "width": 100, "height": 80 },
 *         { "char": "好", "x": 200, "y": 800, "width": 100, "height": 80 }
 *       ]
 *     }]
 *   }]
 * }
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import NavBarGeneral from "../../components/general/navbar";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ─── Types ───

interface CharBox {
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Detection {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  chars: CharBox[];
}

interface SubtitleSegment {
  start_ms: number;
  end_ms: number;
  detections: Detection[];
}

interface SubtitleData {
  video: string;
  resolution: { width: number; height: number };
  duration_ms: number;
  frame_interval_ms?: number;
  segments: SubtitleSegment[];
}

interface ModelConfig {
  name: string;
  color: string;
  data: SubtitleData | null;
}

// ─── Test Videos ───

const TEST_VIDEOS: { id: string; label: string; source: any }[] = [
  { id: "video_2", label: "Video 2 (12s)", source: require("../../../assets/videos/video_2.mp4") },
  { id: "video_3", label: "Video 3 (11s)", source: require("../../../assets/videos/video_3.mp4") },
  { id: "video_4", label: "Video 4 (19s)", source: require("../../../assets/videos/video_4.mp4") },
];

// ─── Models ───
// Add new OCR models here. Each needs a name, display color, and data loader.
// Data files go in assets/subtitles/<modelName>/video_N.json
// The "paddleocr" model uses the default assets/subtitles/video_N.json

function safeLoad(loader: () => any): SubtitleData | null {
  try {
    return loader();
  } catch {
    return null;
  }
}

// Loaders for each video × model combination.
// require() needs static strings — can't be dynamic in React Native.
const VIDEO_LOADERS: Record<string, Record<string, () => any>> = {
  video_2: {
    baseline: () => require("../../../assets/subtitles/video_2.json"),
    videocr: () => require("../../../assets/subtitles/video_2_videocr.json"),
    videocr2: () => require("../../../assets/subtitles/video_2_videocr2.json"),
    rapid: () => require("../../../assets/subtitles/video_2_rapid.json"),
  },
  video_3: {
    baseline: () => require("../../../assets/subtitles/video_3.json"),
    videocr: () => require("../../../assets/subtitles/video_3_videocr.json"),
    videocr2: () => require("../../../assets/subtitles/video_3_videocr2.json"),
    rapid: () => require("../../../assets/subtitles/video_3_rapid.json"),
  },
  video_4: {
    baseline: () => require("../../../assets/subtitles/video_4.json"),
    videocr: () => require("../../../assets/subtitles/video_4_videocr.json"),
    videocr2: () => require("../../../assets/subtitles/video_4_videocr2.json"),
    rapid: () => require("../../../assets/subtitles/video_4_rapid.json"),
  },
};

const MODEL_CONFIGS: { key: string; name: string; color: string }[] = [
  { key: "baseline", name: "PaddleOCR v5 (baseline)", color: "#ff4040" },
  { key: "videocr", name: "videocr (pixel-diff dedup)", color: "#4285f4" },
  { key: "videocr2", name: "VideOCR (SSIM dedup)", color: "#34a853" },
  { key: "rapid", name: "RapidOCR (ONNX)", color: "#ff9800" },
];

function getModelsForVideo(videoId: string): ModelConfig[] {
  const loaders = VIDEO_LOADERS[videoId];
  if (!loaders) return [];

  return MODEL_CONFIGS.map((cfg) => ({
    name: cfg.name,
    color: cfg.color,
    data: safeLoad(loaders[cfg.key] ?? (() => null)),
  })).filter((m) => m.data !== null && m.data.segments.length > 0);
}

// ─── Coordinate Transform (same as SubtitleTapOverlay) ───

function getVideoTransform(
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number,
) {
  const videoAspect = videoW / videoH;
  const containerAspect = containerW / containerH;
  let scale: number, offsetX: number, offsetY: number;

  if (videoAspect > containerAspect) {
    scale = containerW / videoW;
    offsetX = 0;
    offsetY = (containerH - videoH * scale) / 2;
  } else {
    scale = containerH / videoH;
    offsetX = (containerW - videoW * scale) / 2;
    offsetY = 0;
  }
  return { scale, offsetX, offsetY };
}

// ─── Components ───

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metricRow}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

function ModelCard({ model, segment, videoRes, containerW, containerH }: {
  model: ModelConfig;
  segment: SubtitleSegment | null;
  videoRes: { width: number; height: number };
  containerW: number;
  containerH: number;
}) {
  const { scale, offsetX, offsetY } = getVideoTransform(
    videoRes.width, videoRes.height, containerW, containerH,
  );

  return (
    <View style={[s.modelCard, { borderColor: model.color }]}>
      <View style={[s.modelHeader, { backgroundColor: model.color }]}>
        <Text style={s.modelName}>{model.name}</Text>
      </View>

      {segment ? (
        <>
          <MetricRow label="Timing" value={`${segment.start_ms}ms – ${segment.end_ms}ms`} />
          <MetricRow label="Duration" value={`${segment.end_ms - segment.start_ms}ms`} />
          <MetricRow label="Detections" value={String(segment.detections.length)} />

          {segment.detections.map((det, di) => (
            <View key={di} style={s.detectionBlock}>
              <Text style={s.detectionText}>"{det.text}"</Text>
              <MetricRow label="Confidence" value={`${(det.confidence * 100).toFixed(1)}%`} />
              <MetricRow label="Position" value={`x=${det.bbox.x} y=${det.bbox.y}`} />
              <MetricRow label="Size" value={`${det.bbox.width} × ${det.bbox.height}`} />
              <MetricRow label="Screen pos" value={
                `x=${Math.round(det.bbox.x * scale + offsetX)} y=${Math.round(det.bbox.y * scale + offsetY)}`
              } />
              <MetricRow label="Chars" value={det.chars.map((c) => c.char).join("")} />
            </View>
          ))}
        </>
      ) : (
        <Text style={s.noData}>No subtitle at this timestamp</Text>
      )}
    </View>
  );
}

// ─── Main Screen ───

export default function DevOcrCompareScreen() {
  const [selectedVideo, setSelectedVideo] = useState(TEST_VIDEOS[0]);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: SCREEN_WIDTH, height: 300 });
  const [isPaused, setIsPaused] = useState(false);
  const timeRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const player = useVideoPlayer(selectedVideo.source, (p) => {
    p.loop = true;
  });

  const models = useMemo(() => getModelsForVideo(selectedVideo.id), [selectedVideo.id]);

  // Track playback time
  useEffect(() => {
    timeRef.current = setInterval(() => {
      try {
        setCurrentTimeMs(player.currentTime * 1000);
      } catch {}
    }, 100); // 100ms polling for more precise timing display
    return () => {
      if (timeRef.current) clearInterval(timeRef.current);
    };
  }, [player]);

  // Find active segment per model at current time
  const activeSegments = useMemo(() => {
    return models.map((model) => {
      if (!model.data) return null;
      return model.data.segments.find(
        (s) => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms,
      ) ?? null;
    });
  }, [models, currentTimeMs]);

  const handlePlayPause = useCallback(() => {
    try {
      if (isPaused) {
        player.play();
      } else {
        player.pause();
      }
      setIsPaused(!isPaused);
    } catch {}
  }, [isPaused, player]);

  const handleSeek = useCallback((ms: number) => {
    try {
      player.currentTime = ms / 1000;
      setCurrentTimeMs(ms);
    } catch {}
  }, [player]);

  const videoRes = models[0]?.data?.resolution ?? { width: 720, height: 1280 };
  const durationMs = models[0]?.data?.duration_ms ?? 10000;
  const frameInterval = models[0]?.data?.frame_interval_ms ?? 1000;

  // Generate all frame timestamps (every frameInterval ms)
  const allFrames = useMemo(() => {
    const frames: number[] = [];
    for (let t = 0; t < durationMs; t += frameInterval) {
      frames.push(t);
    }
    return frames;
  }, [durationMs, frameInterval]);

  // Current frame index
  const currentFrameIndex = useMemo(() => {
    const idx = Math.round(currentTimeMs / frameInterval);
    return Math.min(idx, allFrames.length - 1);
  }, [currentTimeMs, frameInterval, allFrames.length]);

  const stepFrame = useCallback((delta: number) => {
    const newIdx = Math.max(0, Math.min(allFrames.length - 1, currentFrameIndex + delta));
    const ms = allFrames[newIdx];
    handleSeek(ms);
    if (!isPaused) {
      try { player.pause(); } catch {}
      setIsPaused(true);
    }
  }, [currentFrameIndex, allFrames, handleSeek, isPaused, player]);

  return (
    <SafeAreaView style={s.container}>
      <NavBarGeneral title="OCR Comparison" />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>

        {/* Video selector */}
        <View style={s.videoSelector}>
          {TEST_VIDEOS.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={[s.videoPill, selectedVideo.id === v.id && s.videoPillActive]}
              onPress={() => setSelectedVideo(v)}
            >
              <Text style={[s.videoPillText, selectedVideo.id === v.id && s.videoPillTextActive]}>
                {v.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Video player */}
        <View
          style={s.videoContainer}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setContainerSize({ width, height });
          }}
        >
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
          />

          {/* Overlay boxes from all models */}
          {models.map((model, mi) => {
            const seg = activeSegments[mi];
            if (!seg) return null;
            const { scale, offsetX, offsetY } = getVideoTransform(
              videoRes.width, videoRes.height,
              containerSize.width, containerSize.height,
            );
            return seg.detections.map((det, di) =>
              det.chars.map((ch, ci) => (
                <View
                  key={`${mi}-${di}-${ci}`}
                  style={[s.charBox, {
                    left: ch.x * scale + offsetX,
                    top: ch.y * scale + offsetY,
                    width: ch.width * scale,
                    height: ch.height * scale,
                    borderColor: model.color,
                  }]}
                />
              )),
            );
          })}
        </View>

        {/* Playback controls */}
        <View style={s.controls}>
          <TouchableOpacity onPress={handlePlayPause} style={s.playBtn}>
            <Feather name={isPaused ? "play" : "pause"} size={20} color="white" />
          </TouchableOpacity>
          <Text style={s.timeText}>
            {(currentTimeMs / 1000).toFixed(1)}s / {(durationMs / 1000).toFixed(1)}s
          </Text>
        </View>

        {/* Frame stepper */}
        <View style={s.frameStepper}>
          <TouchableOpacity onPress={() => stepFrame(-1)} style={s.stepBtn}>
            <Feather name="chevron-left" size={20} color="white" />
          </TouchableOpacity>
          <Text style={s.frameText}>
            Frame {currentFrameIndex + 1} / {allFrames.length}
          </Text>
          <TouchableOpacity onPress={() => stepFrame(1)} style={s.stepBtn}>
            <Feather name="chevron-right" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {/* Frame timeline — every frame, scrollable */}
        <Text style={s.sectionLabel}>All Frames</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.segmentBar}>
          {allFrames.map((ms, idx) => {
            const isCurrent = idx === currentFrameIndex;
            const hasSubtitle = models.some((m) =>
              m.data?.segments.some((seg) => ms >= seg.start_ms && ms < seg.end_ms),
            );
            return (
              <TouchableOpacity
                key={ms}
                style={[
                  s.framePill,
                  isCurrent && s.framePillCurrent,
                  hasSubtitle && !isCurrent && s.framePillHasData,
                ]}
                onPress={() => {
                  handleSeek(ms);
                  if (!isPaused) {
                    try { player.pause(); } catch {}
                    setIsPaused(true);
                  }
                }}
              >
                <Text style={[
                  s.framePillText,
                  isCurrent && s.framePillTextCurrent,
                ]}>
                  {(ms / 1000).toFixed(0)}s
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Model comparison cards */}
        <Text style={s.sectionLabel}>Model Results</Text>
        {models.map((model, mi) => (
          <ModelCard
            key={model.name}
            model={model}
            segment={activeSegments[mi]}
            videoRes={videoRes}
            containerW={containerSize.width}
            containerH={containerSize.height}
          />
        ))}

        {models.length === 0 && (
          <View style={s.emptyState}>
            <Feather name="alert-circle" size={32} color="#666" />
            <Text style={s.emptyText}>No OCR data found for {selectedVideo.id}</Text>
            <Text style={s.emptyHint}>
              Run the extraction script and add model configs in{"\n"}
              src/screens/devOcrCompare/index.tsx
            </Text>
          </View>
        )}

        {/* Summary stats */}
        {models.length > 0 && (
          <>
            <Text style={s.sectionLabel}>Summary</Text>
            {models.map((model) => {
              const data = model.data!;
              const totalSegs = data.segments.length;
              const totalDets = data.segments.reduce((a, s) => a + s.detections.length, 0);
              const avgConf = data.segments.reduce((a, s) =>
                a + s.detections.reduce((b, d) => b + d.confidence, 0), 0) / Math.max(totalDets, 1);
              const avgDuration = data.segments.reduce((a, s) =>
                a + (s.end_ms - s.start_ms), 0) / Math.max(totalSegs, 1);
              const coverage = data.segments.reduce((a, s) =>
                a + (s.end_ms - s.start_ms), 0) / data.duration_ms * 100;

              return (
                <View key={model.name} style={[s.modelCard, { borderColor: model.color }]}>
                  <View style={[s.modelHeader, { backgroundColor: model.color }]}>
                    <Text style={s.modelName}>{model.name}</Text>
                  </View>
                  <MetricRow label="Total segments" value={String(totalSegs)} />
                  <MetricRow label="Total detections" value={String(totalDets)} />
                  <MetricRow label="Avg confidence" value={`${(avgConf * 100).toFixed(1)}%`} />
                  <MetricRow label="Avg segment duration" value={`${avgDuration.toFixed(0)}ms`} />
                  <MetricRow label="Time coverage" value={`${coverage.toFixed(1)}%`} />
                </View>
              );
            })}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 60 },

  videoSelector: { flexDirection: "row", gap: 8, padding: 12, flexWrap: "wrap" },
  videoPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#333" },
  videoPillActive: { backgroundColor: "#fe2c55" },
  videoPillText: { color: "#aaa", fontSize: 13 },
  videoPillTextActive: { color: "white", fontWeight: "600" },

  videoContainer: { width: SCREEN_WIDTH, height: SCREEN_WIDTH * (16 / 9), backgroundColor: "black" },
  charBox: { position: "absolute", borderWidth: 1.5, backgroundColor: "rgba(255,255,255,0.1)" },

  controls: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  playBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#333", justifyContent: "center", alignItems: "center" },
  timeText: { color: "white", fontSize: 14, fontFamily: "monospace", flex: 1 },

  frameStepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 8 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#333", justifyContent: "center", alignItems: "center" },
  frameText: { color: "white", fontSize: 14, fontFamily: "monospace", minWidth: 120, textAlign: "center" },

  sectionLabel: { color: "white", fontSize: 16, fontWeight: "600", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8 },

  segmentBar: { paddingHorizontal: 12, maxHeight: 40 },
  framePill: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: "#222", marginRight: 4, minWidth: 36, alignItems: "center" as const },
  framePillCurrent: { backgroundColor: "#fe2c55" },
  framePillHasData: { backgroundColor: "#333", borderWidth: 1, borderColor: "#555" },
  framePillText: { color: "#666", fontSize: 11 },
  framePillTextCurrent: { color: "white", fontWeight: "600" as const },

  modelCard: { margin: 12, borderRadius: 12, borderWidth: 2, backgroundColor: "#1a1a1a", overflow: "hidden" },
  modelHeader: { paddingHorizontal: 12, paddingVertical: 8 },
  modelName: { color: "white", fontSize: 14, fontWeight: "bold" },

  metricRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#222" },
  metricLabel: { color: "#888", fontSize: 13 },
  metricValue: { color: "white", fontSize: 13, fontFamily: "monospace" },

  detectionBlock: { borderTopWidth: 1, borderTopColor: "#333", marginTop: 4 },
  detectionText: { color: "#fe2c55", fontSize: 15, fontWeight: "600", paddingHorizontal: 12, paddingTop: 8 },

  noData: { color: "#666", fontSize: 13, padding: 12, fontStyle: "italic" },

  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText: { color: "#888", fontSize: 15 },
  emptyHint: { color: "#555", fontSize: 12, textAlign: "center" },
});
