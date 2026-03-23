import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveFlashcard } from "../services/flashcards";
import { keys } from "./queryKeys";

interface SaveFlashcardParams {
  vocabWordId: string;
  definitionId: string;
  sourceVideoId: string;
  language: string;
}

export function useSaveFlashcard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: SaveFlashcardParams) =>
      saveFlashcard(
        params.vocabWordId,
        params.definitionId,
        params.sourceVideoId,
        params.language,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: keys.flashcardCount(variables.language),
      });
      queryClient.invalidateQueries({
        queryKey: keys.flashcards(variables.language),
      });
    },
  });
}
