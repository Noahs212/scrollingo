/**
 * Flashcard service — CRUD operations + FSRS scheduling via Supabase.
 * Flashcards store full FSRS card state; display data resolved via JOINs.
 */

import { supabase } from "../lib/supabase";
import { Flashcard } from "../../types";

/** Fields stored on the flashcard that mirror ts-fsrs Card */
export interface FsrsCardFields {
  state: number;
  stability: number;
  difficulty: number;
  due: string;
  last_review_at: string;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
}

/** Fields stored on review_logs that mirror ts-fsrs ReviewLog */
export interface FsrsLogFields {
  rating: number;
  state: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
}

export async function saveFlashcard(
  vocabWordId: string,
  definitionId: string,
  sourceVideoId: string,
  language: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("flashcards")
    .upsert(
      {
        user_id: user.id,
        vocab_word_id: vocabWordId,
        definition_id: definitionId,
        source_video_id: sourceVideoId,
      },
      { onConflict: "user_id,vocab_word_id,definition_id" },
    );

  if (error) throw error;
}

export async function fetchDueFlashcards(
  language: string,
  limit: number,
): Promise<Flashcard[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("flashcards")
    .select(`
      id, user_id, vocab_word_id, definition_id, source_video_id,
      state, stability, difficulty, due, last_review_at,
      elapsed_days, scheduled_days, reps, lapses, learning_steps,
      created_at,
      vocab_words!inner(word, pinyin, language),
      word_definitions!inner(translation, contextual_definition, part_of_speech)
    `)
    .eq("user_id", user.id)
    .lte("due", new Date().toISOString())
    .eq("vocab_words.language", language)
    .order("due", { ascending: true })
    .limit(limit);

  if (error) {
    console.warn("Failed to fetch due flashcards:", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    vocab_word_id: row.vocab_word_id,
    definition_id: row.definition_id,
    source_video_id: row.source_video_id,
    state: row.state,
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    due: row.due,
    last_review_at: row.last_review_at,
    elapsed_days: row.elapsed_days ?? 0,
    scheduled_days: row.scheduled_days ?? 0,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    learning_steps: row.learning_steps ?? 0,
    word: row.vocab_words.word,
    pinyin: row.vocab_words.pinyin,
    translation: row.word_definitions.translation,
    contextual_definition: row.word_definitions.contextual_definition,
    part_of_speech: row.word_definitions.part_of_speech,
    language: row.vocab_words.language,
    created_at: row.created_at,
  }));
}

export async function updateFlashcardAfterReview(
  id: string,
  fields: FsrsCardFields,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("flashcards")
    .update({
      state: fields.state,
      stability: fields.stability,
      difficulty: fields.difficulty,
      due: fields.due,
      last_review_at: fields.last_review_at,
      elapsed_days: fields.elapsed_days,
      scheduled_days: fields.scheduled_days,
      reps: fields.reps,
      lapses: fields.lapses,
      learning_steps: fields.learning_steps,
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}

export async function logReview(
  flashcardId: string,
  fsrsLog: FsrsLogFields,
  durationMs?: number,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("review_logs")
    .insert({
      user_id: user.id,
      flashcard_id: flashcardId,
      rating: fsrsLog.rating,
      review_duration_ms: durationMs ?? null,
      state: fsrsLog.state,
      stability: fsrsLog.stability,
      difficulty: fsrsLog.difficulty,
      elapsed_days: fsrsLog.elapsed_days,
      last_elapsed_days: fsrsLog.last_elapsed_days,
      scheduled_days: fsrsLog.scheduled_days,
      learning_steps: fsrsLog.learning_steps,
    });

  if (error) throw error;
}

export async function fetchFlashcardCount(
  language: string,
): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count, error } = await supabase
    .from("flashcards")
    .select("id, vocab_words!inner(language)", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("vocab_words.language", language);

  if (error) {
    console.warn("Failed to fetch flashcard count:", error.message);
    return 0;
  }

  return count ?? 0;
}

export async function deleteFlashcard(id: string): Promise<void> {
  const { error } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
