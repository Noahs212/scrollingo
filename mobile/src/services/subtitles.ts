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
 * These are the same videos in the same order as LOCAL_VIDEOS in posts.ts.
 */
const SUBTITLE_FILES: Record<string, SubtitleData> = {
  "local-video-1": require("../../assets/subtitles/video_2.json"),
  "local-video-2": require("../../assets/subtitles/video_3.json"),
  "local-video-3": require("../../assets/subtitles/video_4.json"),
  "local-video-4": require("../../assets/subtitles/video_6.json"),
  "local-video-5": require("../../assets/subtitles/video_8.json"),
  "local-video-6": require("../../assets/subtitles/video_9.json"),
  "local-video-7": require("../../assets/subtitles/video_10.json"),
  "local-video-8": require("../../assets/subtitles/video_11.json"),
  "local-video-9": require("../../assets/subtitles/video_12.json"),
  "local-video-10": require("../../assets/subtitles/video_13.json"),
};

export function getSubtitleData(postId: string): SubtitleData | null {
  return SUBTITLE_FILES[postId] ?? null;
}
