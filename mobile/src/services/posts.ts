import { Post, Comment } from "../../types";
import { Dispatch, SetStateAction } from "react";

/**
 * Mock post data — sample videos from public sources.
 * Replace with Supabase queries when ready.
 */
const MOCK_USER_ID = "mock-user-001";

const MOCK_POSTS: Post[] = [
  {
    id: "post-001",
    creator: MOCK_USER_ID,
    media: [
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
      "",
    ],
    description: "Learning Spanish with immersion videos #language #spanish",
    likesCount: 42,
    commentsCount: 5,
    creation: new Date().toISOString(),
  },
  {
    id: "post-002",
    creator: "user-002",
    media: [
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
      "",
    ],
    description: "Japanese phrases for daily life #japanese #nihongo",
    likesCount: 128,
    commentsCount: 12,
    creation: new Date().toISOString(),
  },
  {
    id: "post-003",
    creator: "user-003",
    media: [
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
      "",
    ],
    description: "French pronunciation tips #french #francais",
    likesCount: 89,
    commentsCount: 7,
    creation: new Date().toISOString(),
  },
  {
    id: "post-004",
    creator: MOCK_USER_ID,
    media: [
      "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
      "",
    ],
    description: "Korean vocabulary through K-dramas #korean #hangul",
    likesCount: 215,
    commentsCount: 23,
    creation: new Date().toISOString(),
  },
];

const MOCK_COMMENTS: Comment[] = [
  { id: "c1", creator: "user-002", comment: "Great content!" },
  { id: "c2", creator: "user-003", comment: "This helped me so much" },
];

const likedPosts = new Set<string>();

export const getFeed = (): Promise<Post[]> => {
  return Promise.resolve([...MOCK_POSTS]);
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
  return () => {}; // unsubscribe no-op
};

export const clearCommentListener = () => {};

export const getPostsByUserId = (uid?: string): Promise<Post[]> => {
  if (!uid) return Promise.reject(new Error("User ID is not set"));
  const userPosts = MOCK_POSTS.filter((p) => p.creator === uid);
  return Promise.resolve(userPosts);
};
