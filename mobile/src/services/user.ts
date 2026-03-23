import { supabase } from "../lib/supabase";
import { SearchUser, User } from "../../types";

/**
 * Maps a Supabase users row to the app's User interface.
 */
function mapDbUser(
  row: Record<string, any>,
  email: string = "",
): User {
  return {
    uid: row.id,
    email,
    displayName: row.display_name ?? null,
    photoURL: row.avatar_url || undefined,
    followingCount: row.following_count ?? 0,
    followersCount: row.follower_count ?? 0,
    likesCount: 0, // Computed from user_likes count; not stored on users table
    nativeLanguage: row.native_language ?? "en",
    targetLanguage: row.target_language ?? "en",
    learningLanguages: row.learning_languages ?? ["en"],
    streakDays: row.streak_days ?? 0,
    longestStreak: row.longest_streak ?? 0,
    totalWordsLearned: row.total_words_learned ?? 0,
    totalVideosWatched: row.total_videos_watched ?? 0,
    dailyGoalMinutes: row.daily_goal_minutes ?? 10,
    maxReviewsPerDay: row.max_reviews_per_day ?? 20,
    premium: row.premium ?? false,
  };
}

/**
 * Fetch a user profile by ID from Supabase.
 * likesCount is computed from user_likes (not stored on users table).
 */
export async function getUserById(id: string): Promise<User | null> {
  const [profileResult, likesResult, authResult] = await Promise.all([
    supabase.from("users").select("*").eq("id", id).single(),
    supabase.from("user_likes").select("*", { count: "exact", head: true }).eq("user_id", id),
    supabase.auth.getUser(),
  ]);

  if (profileResult.error || !profileResult.data) {
    return null;
  }

  const email = authResult.data?.user?.id === id
    ? (authResult.data.user.email ?? "")
    : "";

  const user = mapDbUser(profileResult.data, email);
  user.likesCount = likesResult.count ?? 0;
  return user;
}

/**
 * Save a profile field to Supabase.
 */
export async function saveUserField(
  field: string,
  value: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Map camelCase field names to snake_case DB columns
  const fieldMap: Record<string, string> = {
    displayName: "display_name",
    avatarUrl: "avatar_url",
    nativeLanguage: "native_language",
    targetLanguage: "target_language",
    dailyGoalMinutes: "daily_goal_minutes",
    maxReviewsPerDay: "max_reviews_per_day",
  };

  const dbField = fieldMap[field];
  if (!dbField) {
    throw new Error(`Unknown profile field: "${field}". Add it to the fieldMap in saveUserField.`);
  }

  // Convert numeric fields from string to number
  const numericFields = new Set(["daily_goal_minutes", "max_reviews_per_day"]);
  const dbValue = numericFields.has(dbField) ? parseInt(value, 10) : value;

  const { error } = await supabase
    .from("users")
    .update({ [dbField]: dbValue })
    .eq("id", user.id);

  if (error) {
    throw error;
  }
}

/**
 * Save profile image URL to Supabase.
 * For now, stores the local URI. In production, upload to R2 first.
 */
export async function saveUserProfileImage(imageUri: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("users")
    .update({ avatar_url: imageUri })
    .eq("id", user.id);

  if (error) {
    throw error;
  }
}

/**
 * Search users by email or display name.
 */
export async function queryUsersByEmail(
  query: string,
): Promise<SearchUser[]> {
  if (!query || query.length < 2) return [];

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .or(`display_name.ilike.%${query}%,username.ilike.%${query}%`)
    .limit(20);

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    ...mapDbUser(row),
    id: row.id,
  }));
}

/**
 * Check if the current user follows another user.
 */
export async function getIsFollowing(
  userId: string,
  otherUserId: string,
): Promise<boolean> {
  if (!userId || !otherUserId || userId === otherUserId) return false;

  const { data, error } = await supabase
    .from("user_follows")
    .select("follower_id")
    .eq("follower_id", userId)
    .eq("following_id", otherUserId)
    .maybeSingle();

  if (error) {
    return false;
  }

  return data !== null;
}

/**
 * Toggle follow state for a user.
 */
export async function changeFollowState({
  otherUserId,
  isFollowing,
}: {
  otherUserId: string;
  isFollowing: boolean;
}): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  if (isFollowing) {
    // Unfollow
    const { error } = await supabase
      .from("user_follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("following_id", otherUserId);

    if (error) {
      throw error;
    }
  } else {
    // Follow
    const { error } = await supabase
      .from("user_follows")
      .insert({ follower_id: user.id, following_id: otherUserId });

    if (error) {
      throw error;
    }
  }

  return true;
}
