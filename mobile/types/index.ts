export interface Video {
  id: string;
  title: string;
  description: string | null;
  language: string;
  cdn_url: string;
  thumbnail_url: string | null;
  duration_sec: number;
  like_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
  creator_id: string | null;
  subtitle_source: "stt" | "ocr" | "both" | null;
}

export interface FeedPage {
  videos: Video[];
  nextCursor: { created_at: string; id: string } | null;
}

export interface Post {
  id: string;
  creator: string;
  media: (string | number)[];  // string = URL, number = require() asset
  description: string;
  likesCount: number;
  commentsCount: number;
  creation: string;
}

export interface Comment {
  id: string;
  creator: string;
  comment: string;
}

export interface User {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL?: string;
  // Social counts
  followingCount: number;
  followersCount: number;
  likesCount: number;
  // Language preferences
  nativeLanguage: string;
  targetLanguage: string;
  learningLanguages: string[];
  // Learning stats
  streakDays: number;
  longestStreak: number;
  totalWordsLearned: number;
  totalVideosWatched: number;
  dailyGoalMinutes: number;
  maxReviewsPerDay: number;
  premium: boolean;
}

export interface SearchUser extends User {
  id: string;
}

export interface Chat {
  id: string;
  members: string[];
  lastMessage: string;
  lastUpdate?: {
    seconds?: number;
    nanoseconds?: number;
  };
  messages: Message[];
}

export interface Message {
  id: string;
  creator: string;
  message: string;
}

export interface WordDefinition {
  word_index: number;
  display_text: string;
  start_ms: number;
  end_ms: number;
  word: string;
  pinyin: string | null;
  translation: string;
  contextual_definition: string;
  part_of_speech: string | null;
  vocab_word_id: string;
  definition_id: string;
}

export interface Flashcard {
  id: string;
  user_id: string;
  vocab_word_id: string;
  definition_id: string;
  source_video_id: string | null;
  // FSRS fields (must match ts-fsrs Card interface)
  state: number;           // 0=new, 1=learning, 2=review, 3=relearning
  stability: number;
  difficulty: number;
  due: string;
  last_review_at: string | null;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  starred: boolean;
  // Display data (joined from vocab_words + word_definitions)
  word: string;
  pinyin: string | null;
  translation: string;
  contextual_definition: string;
  part_of_speech: string | null;
  language: string;
  created_at: string;
}

export interface ReviewLog {
  id: string;
  flashcard_id: string;
  rating: number;
  review_duration_ms: number | null;
  reviewed_at: string;
}
