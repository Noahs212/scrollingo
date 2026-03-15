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
 * Get the current user's ID to use as creator for local dev videos.
 */
async function getCurrentUserId(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? "unknown";
}

const MOCK_COMMENTS: Comment[] = [
  { id: "c1", creator: "user-002", comment: "Great content!" },
  { id: "c2", creator: "user-003", comment: "This helped me so much" },
];

const likedPosts = new Set<string>();

export const getFeed = async (): Promise<Post[]> => {
  const userId = await getCurrentUserId();

  return LOCAL_VIDEOS.map((videoSource, i) => ({
    id: `local-video-${i + 1}`,
    creator: userId,
    media: [videoSource, ""],
    description: `Chinese learning video #${i + 1} #中文 #学习`,
    likesCount: Math.floor(Math.random() * 200),
    commentsCount: Math.floor(Math.random() * 20),
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
