export interface Post {
  id: string;
  creator: string;
  media: string[];
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
