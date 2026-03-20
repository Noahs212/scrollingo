// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { Post, Comment } from "../../types";
import { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";

/**
 * Local video assets from downloads/ folder.
 * These are Chinese short-form videos for development/testing.
 * In production, videos will come from the videos table in Supabase + R2 CDN.
 */
const LOCAL_VIDEOS = [
  require("../../assets/videos/video_2.mp4"),
  require("../../assets/videos/video_3.mp4"),
  require("../../assets/videos/video_4.mp4"),
  require("../../assets/videos/video_6.mp4"),
  require("../../assets/videos/video_8.mp4"),
  require("../../assets/videos/video_9.mp4"),
  require("../../assets/videos/video_10.mp4"),
  require("../../assets/videos/video_11.mp4"),
  require("../../assets/videos/video_12.mp4"),
  require("../../assets/videos/video_13.mp4"),
];

/**
 * Seed user IDs for dev/testing. These are real rows in Supabase.
 */
const SEED_CREATORS = [
  "aaaaaaaa-1111-4000-a000-000000000001", // Li Wei
  "aaaaaaaa-1111-4000-a000-000000000002", // Sarah Chen
  "aaaaaaaa-1111-4000-a000-000000000003", // Pat Kim
  "aaaaaaaa-1111-4000-a000-000000000004", // Maria Garcia
];

const VIDEO_DESCRIPTIONS = [
  "How to order food in Chinese #中文 #学习",
  "Basic greetings in Mandarin #你好 #chinese",
  "Numbers 1-100 in Chinese #数字 #beginner",
  "Chinese tones explained #声调 #pronunciation",
  "Daily routines vocabulary #日常 #vocab",
  "Shopping phrases in Chinese #购物 #travel",
  "Chinese slang you need to know #俚语 #advanced",
  "How to introduce yourself #自我介绍 #beginner",
  "Colors and descriptions #颜色 #vocab",
  "Chinese culture tips #文化 #travel",
];

/**
 * Get the current user's ID to use as creator for local dev videos.
 */
async function getCurrentUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? "unknown";
}

const MOCK_COMMENTS: Comment[] = [
  { id: "c1", creator: SEED_CREATORS[0], comment: "Great content!" },
  { id: "c2", creator: SEED_CREATORS[1], comment: "This helped me so much" },
];

/**
 * In-memory like tracking for mock videos.
 * Real Supabase likes (user_likes table) will be used in M7 when
 * videos exist as real DB rows. Currently mock video IDs (local-video-*)
 * have no corresponding rows in the videos table, so FK constraints
 * prevent inserting into user_likes.
 */
const likedPosts = new Set<string>();

/**
 * Stable per-video like/comment counts so they don't re-randomize on every fetch.
 * Seeded deterministically from video index.
 */
const STABLE_LIKES = LOCAL_VIDEOS.map((_, i) => 12 + ((i * 37 + 13) % 188));
const STABLE_COMMENTS = LOCAL_VIDEOS.map((_, i) => 1 + ((i * 7 + 3) % 18));

export const getFeed = async (): Promise<Post[]> => {
  const userId = await getCurrentUserId();

  // Mix current user with seed creators so feed shows different people
  const creators = [userId, ...SEED_CREATORS];

  return LOCAL_VIDEOS.map((videoSource, i) => ({
    id: `local-video-${i + 1}`,
    creator: creators[i % creators.length],
    media: [videoSource, ""],
    description: VIDEO_DESCRIPTIONS[i] ?? `Chinese learning video #${i + 1}`,
    likesCount: STABLE_LIKES[i],
    commentsCount: STABLE_COMMENTS[i],
    creation: new Date().toISOString(),
  }));
};

export const getLikeById = async (
  postId: string,
  _uid: string,
): Promise<boolean> => {
  return likedPosts.has(postId);
};

export const updateLike = async (
  postId: string,
  _uid: string,
  currentLikeState: boolean,
) => {
  if (currentLikeState) {
    likedPosts.delete(postId);
  } else {
    likedPosts.add(postId);
  }
};

export const addComment = async (
  _postId: string,
  creator: string,
  comment: string,
) => {
  MOCK_COMMENTS.unshift({
    id: `c-${Date.now()}`,
    creator,
    comment,
  });
};

export const commentListener = (
  _postId: string,
  setCommentList: Dispatch<SetStateAction<Comment[]>>,
) => {
  setCommentList([...MOCK_COMMENTS]);
  return () => {};
};

export const clearCommentListener = () => {};

export const getPostsByUserId = async (uid?: string): Promise<Post[]> => {
  if (!uid) return [];
  const allPosts = await getFeed();
  return allPosts.filter((p) => p.creator === uid);
};
