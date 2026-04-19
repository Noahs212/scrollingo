/**
 * Segment translations service — fetches sentence-level translations from Supabase.
 * Returns a Map<start_ms, translation> for O(1) lookup in SubtitleDrawer.
 */

import { supabase } from "../lib/supabase";

export async function fetchSegmentTranslations(
  videoId: string,
  targetLanguage: string,
): Promise<Map<number, string>> {
  const { data, error } = await supabase
    .from("segment_translations")
    .select("start_ms, translation")
    .eq("video_id", videoId)
    .eq("target_language", targetLanguage);

  if (error) {
    console.warn("Failed to fetch segment_translations:", error.message);
    return new Map();
  }

  const map = new Map<number, string>();
  for (const row of (data ?? [])) {
    map.set(row.start_ms, row.translation);
  }
  return map;
}
