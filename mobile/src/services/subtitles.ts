/**
 * Subtitle data loader for dev/testing.
 *
 * Loads pre-extracted OCR bounding box data from assets/subtitles/*.json.
 * In production, this will be replaced by a Supabase query (M4+).
 *
 * The video IDs in the feed are "local-video-1" through "local-video-10"
 * which map to video_2.mp4 through video_13.mp4 (matching LOCAL_VIDEOS order in posts.ts).
 */

import { SubtitleData } from "../components/general/post/subtitleOverlay";

/**
 * Cache-busting version for transcript.json and bboxes.json CDN URLs.
 * Bump this whenever the pipeline re-merges transcripts so iOS doesn't
 * serve immutable-cached stale content. `Cache-Control: immutable` means
 * the iOS URLSession never revalidates even with cache: "no-store" on fetch.
 * Changing the URL is the only reliable way to bypass the system cache.
 *
 * History:
 *   v1 — original STT-driven pipeline (Traditional Chinese, Whisper hallucinations)
 *   v2 — OCR-first rewrite + Traditional→Simplified normalization (2026-04-14)
 */
const TRANSCRIPT_VERSION = "v2";

/**
 * Map from local video index to the subtitle JSON.
 * Using dense — best available OCR extraction.
 * These are the same videos in the same order as LOCAL_VIDEOS in posts.ts.
 */
const SUBTITLE_FILES: Record<string, SubtitleData> = {
  "local-video-1": require("../../assets/subtitles/video_2_dense.json"),
  "local-video-2": require("../../assets/subtitles/video_3_dense.json"),
  "local-video-3": require("../../assets/subtitles/video_4_dense.json"),
  "local-video-4": require("../../assets/subtitles/video_6_dense.json"),
  "local-video-5": require("../../assets/subtitles/video_8_dense.json"),
  "local-video-6": require("../../assets/subtitles/video_9_dense.json"),
  "local-video-7": require("../../assets/subtitles/video_10_dense.json"),
  "local-video-8": require("../../assets/subtitles/video_11_dense.json"),
  "local-video-9": require("../../assets/subtitles/video_12_dense.json"),
  "local-video-10": require("../../assets/subtitles/video_13_dense.json"),
};

/**
 * Get subtitle data from local bundled assets (dev/testing only).
 */
export function getLocalSubtitleData(postId: string): SubtitleData | null {
  return SUBTITLE_FILES[postId] ?? null;
}

/** @deprecated Use getLocalSubtitleData — kept for backward compatibility */
export function getSubtitleData(postId: string): SubtitleData | null {
  return getLocalSubtitleData(postId);
}

/**
 * Derive the bboxes.json URL from a video's CDN URL.
 * e.g. "https://cdn.example.com/videos/abc123/video.mp4"
 *    → "https://cdn.example.com/videos/abc123/bboxes.json"
 */
function deriveBboxesUrl(cdnUrl: string): string {
  const lastSlash = cdnUrl.lastIndexOf("/");
  if (lastSlash === -1) {
    throw new Error(`Invalid CDN URL: ${cdnUrl}`);
  }
  return cdnUrl.substring(0, lastSlash + 1) + `bboxes.json?${TRANSCRIPT_VERSION}`;
}

/**
 * Fetch OCR bounding box data from the CDN for a given video.
 * Used for invisible tap targets over burned-in subtitle text.
 */
export async function fetchSubtitleData(cdnUrl: string): Promise<SubtitleData> {
  const bboxesUrl = deriveBboxesUrl(cdnUrl);
  const response = await fetch(bboxesUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch subtitles: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Derive the stt.json URL from a video's CDN URL.
 */
function deriveSttUrl(cdnUrl: string): string {
  const lastSlash = cdnUrl.lastIndexOf("/");
  if (lastSlash === -1) {
    throw new Error(`Invalid CDN URL: ${cdnUrl}`);
  }
  return cdnUrl.substring(0, lastSlash + 1) + "stt.json";
}

/**
 * Fetch STT transcript data from the CDN for a given video.
 * Used as fallback for the subtitle drawer.
 * Returns null if STT data is not available.
 */
export async function fetchSttData(cdnUrl: string): Promise<SubtitleData | null> {
  try {
    const sttUrl = deriveSttUrl(cdnUrl);
    const response = await fetch(sttUrl);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

/**
 * Derive the transcript.json URL from a video's CDN URL.
 */
function deriveTranscriptUrl(cdnUrl: string): string {
  const lastSlash = cdnUrl.lastIndexOf("/");
  if (lastSlash === -1) {
    throw new Error(`Invalid CDN URL: ${cdnUrl}`);
  }
  return cdnUrl.substring(0, lastSlash + 1) + `transcript.json?${TRANSCRIPT_VERSION}`;
}

/**
 * Fetch merged transcript (OCR content + STT timing) from the CDN.
 * This is the primary data source for the subtitle drawer.
 * Contains only spoken subtitles (title cards filtered out).
 *
 * Fallback chain:
 *   1. transcript.json — OCR-first merged output (preferred)
 *   2. bboxes.json — raw OCR data (for videos not yet processed through the merge pipeline)
 *
 * stt.json is intentionally NOT in the fallback chain. The STT output contains
 * Whisper hallucinations, Traditional Chinese characters, and erroneous text
 * (e.g. "魔法" instead of "模仿"). The OCR backbone is always more accurate
 * for burned-in subtitle text, so if transcript.json is missing we prefer raw OCR.
 */
export async function fetchTranscriptData(cdnUrl: string): Promise<SubtitleData | null> {
  // 1. Try transcript.json (OCR-first merged output)
  try {
    const url = deriveTranscriptUrl(cdnUrl);
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) {
      console.log("[subtitles] loaded transcript.json for", url);
      return response.json();
    }
    console.log("[subtitles] transcript.json not ok:", response.status, url);
  } catch (e) {
    console.log("[subtitles] transcript.json fetch error:", e);
  }

  // 2. Fall back to bboxes.json (raw OCR — never stt.json)
  try {
    const bboxUrl = deriveBboxesUrl(cdnUrl);
    const response = await fetch(bboxUrl, { cache: "no-store" });
    if (response.ok) {
      console.log("[subtitles] fell back to bboxes.json for", bboxUrl);
      return response.json();
    }
  } catch {}

  return null;
}
