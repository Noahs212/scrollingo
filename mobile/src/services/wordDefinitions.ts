/**
 * Word definitions service — fetches word translations from Supabase.
 * Uses two queries (video_words + word_definitions) joined in JS
 * for reliability — PostgREST FK joins across sibling tables are fragile.
 */

import { supabase } from "../lib/supabase";
import { WordDefinition } from "../../types";

export async function fetchWordDefinitions(
  videoId: string,
  targetLanguage: string,
): Promise<WordDefinition[]> {
  // Query 1: Get video_words with vocab_words (direct FK)
  const { data: videoWords, error: vwError } = await supabase
    .from("video_words")
    .select("word_index, display_text, start_ms, end_ms, vocab_word_id, vocab_words(word, pinyin)")
    .eq("video_id", videoId)
    .order("word_index");

  if (vwError) {
    console.warn("Failed to fetch video_words:", vwError.message);
    return [];
  }

  if (!videoWords || videoWords.length === 0) return [];

  // Query 2: Get word_definitions for this video + target language
  const { data: definitions, error: wdError } = await supabase
    .from("word_definitions")
    .select("id, vocab_word_id, translation, contextual_definition, part_of_speech")
    .eq("video_id", videoId)
    .eq("target_language", targetLanguage);

  if (wdError) {
    console.warn("Failed to fetch word_definitions:", wdError.message);
    return [];
  }

  // Build lookup: vocab_word_id → definition (including definition_id for flashcard save)
  const defMap = new Map<string, { id: string; translation: string; contextual_definition: string; part_of_speech: string | null }>();
  for (const def of (definitions ?? [])) {
    defMap.set(def.vocab_word_id, {
      id: def.id,
      translation: def.translation,
      contextual_definition: def.contextual_definition,
      part_of_speech: def.part_of_speech,
    });
  }

  // Join in JS
  return videoWords.map((vw: any) => {
    const vocabWord = vw.vocab_words;
    const def = defMap.get(vw.vocab_word_id);

    return {
      word_index: vw.word_index,
      display_text: vw.display_text,
      start_ms: vw.start_ms,
      end_ms: vw.end_ms,
      word: vocabWord?.word ?? vw.display_text,
      pinyin: vocabWord?.pinyin ?? null,
      translation: def?.translation ?? "",
      contextual_definition: def?.contextual_definition ?? "",
      part_of_speech: def?.part_of_speech ?? null,
      vocab_word_id: vw.vocab_word_id,
      definition_id: def?.id ?? "",
    };
  });
}
