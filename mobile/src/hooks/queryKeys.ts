// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

export const keys = {
  user: (user: string | null) => ["user", user],
  userFollowing: (userId: string, otherUserId: string) => [
    "following",
    userId + otherUserId,
  ],
  feed: (language: string | null) => ["feed", language] as const,
  subtitles: (videoId: string) => ["subtitles", videoId] as const,
  wordDefinitions: (videoId: string, lang: string | null) =>
    ["wordDefinitions", videoId, lang] as const,
  flashcards: (language: string | null) => ["flashcards", language] as const,
  flashcardCount: (language: string | null) =>
    ["flashcardCount", language] as const,
  allFlashcards: (language: string | null) =>
    ["allFlashcards", language] as const,
};
