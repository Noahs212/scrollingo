import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchSegmentTranslations } from "../services/segmentTranslations";

export function useSegmentTranslations(videoId: string, targetLanguage: string | null) {
  return useQuery<Map<number, string>, Error>({
    queryKey: keys.segmentTranslations(videoId, targetLanguage),
    queryFn: () => fetchSegmentTranslations(videoId, targetLanguage!),
    staleTime: Infinity,
    enabled: !!videoId && !!targetLanguage,
  });
}
