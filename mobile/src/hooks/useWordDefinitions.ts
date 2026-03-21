import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchWordDefinitions } from "../services/wordDefinitions";
import { WordDefinition } from "../../types";

export function useWordDefinitions(videoId: string, targetLanguage: string | null) {
  return useQuery<WordDefinition[], Error>({
    queryKey: keys.wordDefinitions(videoId, targetLanguage),
    queryFn: () => fetchWordDefinitions(videoId, targetLanguage!),
    staleTime: Infinity,
    enabled: !!videoId && !!targetLanguage,
  });
}
