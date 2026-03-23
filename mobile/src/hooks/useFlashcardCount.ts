import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchFlashcardCount } from "../services/flashcards";

export function useFlashcardCount(language: string | null) {
  return useQuery<number, Error>({
    queryKey: keys.flashcardCount(language),
    queryFn: () => fetchFlashcardCount(language!),
    enabled: !!language,
  });
}
