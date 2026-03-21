/**
 * useSubtitles — fetches OCR bounding box data for a video from the CDN.
 * Returns SubtitleData for the SubtitleTapOverlay component.
 */

import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchSubtitleData } from "../services/subtitles";
import { SubtitleData } from "../components/general/post/subtitleOverlay";

export function useSubtitles(videoId: string, cdnUrl: string) {
  return useQuery<SubtitleData, Error>({
    queryKey: keys.subtitles(videoId),
    queryFn: () => fetchSubtitleData(cdnUrl),
    staleTime: Infinity,
    enabled: !!videoId && !!cdnUrl,
  });
}
