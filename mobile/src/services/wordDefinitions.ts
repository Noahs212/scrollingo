import { supabase } from "../lib/supabase";
import { WordDefinition } from "../../types";

interface VideoWordRow {
  word_index: number;
  display_text: string;
  start_ms: number;
  end_ms: number;
  vocab_words: { word: string; pinyin: string | null };
  word_definitions: { translation: string; contextual_definition: string; part_of_speech: string | null };
}

export async function fetchWordDefinitions(
  videoId: string,
  targetLanguage: string,
): Promise<WordDefinition[]> {
  const { data, error } = await supabase
    .from("video_words")
    .select(`
      word_index, display_text, start_ms, end_ms,
      vocab_words!inner(word, pinyin),
      word_definitions!inner(translation, contextual_definition, part_of_speech)
    `)
    .eq("video_id", videoId)
    .eq("word_definitions.target_language", targetLanguage)
    .eq("word_definitions.video_id", videoId)
    .order("word_index");

  if (error) {
    throw new Error(`Failed to fetch word definitions: ${error.message}`);
  }

  return ((data as unknown as VideoWordRow[]) ?? []).map((row) => ({
    word_index: row.word_index,
    display_text: row.display_text,
    start_ms: row.start_ms,
    end_ms: row.end_ms,
    word: row.vocab_words.word,
    pinyin: row.vocab_words.pinyin,
    translation: row.word_definitions.translation,
    contextual_definition: row.word_definitions.contextual_definition,
    part_of_speech: row.word_definitions.part_of_speech,
  }));
}
