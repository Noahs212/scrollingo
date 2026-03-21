/**
 * Video feed service — fetches videos from Supabase with keyset pagination.
 * Used by useFeed hook for the infinite-scroll feed (M4).
 */

import { supabase } from "../lib/supabase";
import { Video, FeedPage } from "../../types";

/**
 * Fetch a page of videos for the feed using keyset pagination.
 *
 * Videos are ordered by (created_at DESC, id DESC). The cursor holds the
 * created_at + id of the last item on the previous page so we can efficiently
 * fetch the next page without OFFSET.
 */
export async function fetchFeedPage(
  language: string,
  cursor?: { created_at: string; id: string },
  limit = 10,
): Promise<FeedPage> {
  let query = supabase
    .from("videos")
    .select(
      "id, title, description, language, cdn_url, thumbnail_url, duration_sec, like_count, comment_count, view_count, created_at",
    )
    .eq("status", "ready")
    .eq("language", language)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt("created_at", cursor.created_at);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch feed: ${error.message}`);
  }

  const videos: Video[] = data ?? [];

  // Derive nextCursor from the last item — null if we got fewer than `limit`
  let nextCursor: FeedPage["nextCursor"] = null;
  if (videos.length === limit) {
    const last = videos[videos.length - 1];
    nextCursor = { created_at: last.created_at, id: last.id };
  }

  return { videos, nextCursor };
}

/**
 * Track that a user viewed a video. Upserts into user_views so
 * duplicate views from the same user are idempotent.
 */
export async function trackView(
  userId: string,
  videoId: string,
): Promise<void> {
  const { error } = await supabase
    .from("user_views")
    .upsert(
      { user_id: userId, video_id: videoId },
      { onConflict: "user_id,video_id" },
    );

  if (error) {
    // Non-critical — log but don't throw so it doesn't break the feed
    console.warn(`Failed to track view: ${error.message}`);
  }
}
