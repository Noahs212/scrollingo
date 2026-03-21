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
 * Using VideOCR (SSIM dedup) — best positioning accuracy in our comparison.
 * These are the same videos in the same order as LOCAL_VIDEOS in posts.ts.
 */
const SUBTITLE_FILES: Record<string, SubtitleData> = {
  "local-video-1": require("../../assets/subtitles/video_2_videocr2.json"),
  "local-video-2": require("../../assets/subtitles/video_3_videocr2.json"),
  "local-video-3": require("../../assets/subtitles/video_4_videocr2.json"),
  "local-video-4": require("../../assets/subtitles/video_6_videocr2.json"),
  "local-video-5": require("../../assets/subtitles/video_8_videocr2.json"),
  "local-video-6": require("../../assets/subtitles/video_9_videocr2.json"),
  "local-video-7": require("../../assets/subtitles/video_10_videocr2.json"),
  "local-video-8": require("../../assets/subtitles/video_11_videocr2.json"),
  "local-video-9": require("../../assets/subtitles/video_12_videocr2.json"),
  "local-video-10": require("../../assets/subtitles/video_13_videocr2.json"),
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
 * Fetch subtitle/OCR bounding box data from the CDN for a given video.
 * Used when videos are served from Supabase + R2 (M4+).
 */
export async function fetchSubtitleData(cdnUrl: string): Promise<SubtitleData> {
  const bboxesUrl = deriveBboxesUrl(cdnUrl);
  const response = await fetch(bboxesUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch subtitles: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
