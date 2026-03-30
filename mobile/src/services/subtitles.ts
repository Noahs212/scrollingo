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
  return cdnUrl.substring(0, lastSlash + 1) + "bboxes.json";
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
  return cdnUrl.substring(0, lastSlash + 1) + "transcript.json";
}

/**
 * Fetch merged transcript (OCR content + STT timing) from the CDN.
 * This is the primary data source for the subtitle drawer.
 * Contains only spoken subtitles (title cards filtered out).
 * Falls back to stt.json, then bboxes.json for old videos.
 */
export async function fetchTranscriptData(cdnUrl: string): Promise<SubtitleData | null> {
  // Try transcript.json first (merged OCR+STT)
  try {
    const url = deriveTranscriptUrl(cdnUrl);
    const response = await fetch(url);
    if (response.ok) return response.json();
  } catch {}

  // Fall back to stt.json
  try {
    const sttUrl = deriveSttUrl(cdnUrl);
    const response = await fetch(sttUrl);
    if (response.ok) return response.json();
  } catch {}

  // Fall back to bboxes.json (old videos)
  try {
    const bboxUrl = deriveBboxesUrl(cdnUrl);
    const response = await fetch(bboxUrl);
    if (response.ok) return response.json();
  } catch {}

  return null;
}
