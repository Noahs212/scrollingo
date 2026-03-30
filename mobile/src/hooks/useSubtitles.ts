/**
 * useSubtitles — fetches OCR bounding box data for tap targets over burned-in text.
 * useSttSubtitles — fetches STT transcript data for the visible subtitle drawer.
 */

import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchSubtitleData, fetchSttData, fetchTranscriptData } from "../services/subtitles";
import { SubtitleData } from "../components/general/post/subtitleOverlay";

/** OCR bounding boxes — for invisible tap targets over burned-in text */
export function useSubtitles(videoId: string, cdnUrl: string) {
  return useQuery<SubtitleData, Error>({
    queryKey: keys.subtitles(videoId),
    queryFn: () => fetchSubtitleData(cdnUrl),
    staleTime: Infinity,
    enabled: !!videoId && !!cdnUrl,
  });
}

/** STT transcript — for visible subtitle drawer with word timing */
export function useSttSubtitles(videoId: string, cdnUrl: string) {
  return useQuery<SubtitleData | null, Error>({
    queryKey: [...keys.subtitles(videoId), "stt"],
    queryFn: () => fetchSttData(cdnUrl),
    staleTime: Infinity,
    enabled: !!videoId && !!cdnUrl,
  });
}

/** Merged transcript (OCR text + STT timing) — primary source for subtitle drawer.
 * Falls back: transcript.json → stt.json → bboxes.json */
export function useTranscript(videoId: string, cdnUrl: string) {
  return useQuery<SubtitleData | null, Error>({
    queryKey: [...keys.subtitles(videoId), "transcript"],
    queryFn: () => fetchTranscriptData(cdnUrl),
    staleTime: Infinity,
    enabled: !!videoId && !!cdnUrl,
  });
}
