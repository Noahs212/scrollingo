/**
 * useSubtitles — fetches OCR bounding box data for tap targets over burned-in text.
 * useTranscript — fetches merged transcript for the subtitle drawer.
 */

import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchSubtitleData, fetchTranscriptData } from "../services/subtitles";
import { SubtitleData } from "../components/general/post/subtitleOverlay";

// 1 hour — content rarely changes mid-session but we don't want year-long stale cache
const SUBTITLE_STALE_MS = 60 * 60 * 1000;

/** OCR bounding boxes — for invisible tap targets over burned-in text */
export function useSubtitles(videoId: string, cdnUrl: string) {
  return useQuery<SubtitleData, Error>({
    queryKey: keys.subtitles(videoId),
    queryFn: () => fetchSubtitleData(cdnUrl),
    staleTime: SUBTITLE_STALE_MS,
    enabled: !!videoId && !!cdnUrl,
  });
}

/** Merged transcript (OCR text + STT timing) — primary source for subtitle drawer.
 * Falls back: transcript.json → bboxes.json (never stt.json) */
export function useTranscript(videoId: string, cdnUrl: string) {
  return useQuery<SubtitleData | null, Error>({
    queryKey: [...keys.subtitles(videoId), "transcript"],
    queryFn: () => fetchTranscriptData(cdnUrl),
    staleTime: SUBTITLE_STALE_MS,
    enabled: !!videoId && !!cdnUrl,
  });
}
