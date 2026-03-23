import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchDueFlashcards } from "../services/flashcards";
import { Flashcard } from "../../types";

export function useFlashcards(language: string | null, limit: number) {
  return useQuery<Flashcard[], Error>({
    queryKey: keys.flashcards(language),
    queryFn: () => fetchDueFlashcards(language!, limit),
    enabled: !!language,
  });
}
