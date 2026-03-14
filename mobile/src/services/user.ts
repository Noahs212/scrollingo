import { SearchUser, User } from "../../types";

/**
 * Mock user data. Replace with Supabase queries when ready.
 */
const MOCK_USERS: Record<string, User> = {
  "mock-user-001": {
    uid: "mock-user-001",
    email: "demo@scrollingo.app",
    displayName: "Demo User",
    followingCount: 12,
    followersCount: 48,
    likesCount: 156,
  },
  "user-002": {
    uid: "user-002",
    email: "maria@example.com",
    displayName: "Maria Garcia",
    followingCount: 34,
    followersCount: 892,
    likesCount: 4521,
  },
  "user-003": {
    uid: "user-003",
    email: "yuki@example.com",
    displayName: "Yuki Tanaka",
    followingCount: 67,
    followersCount: 1203,
    likesCount: 8934,
  },
};

const followingSet = new Set<string>();

export const saveUserProfileImage = (_image: string) =>
  Promise.resolve();

export const saveUserField = (_field: string, _value: string) =>
  Promise.resolve();

export const queryUsersByEmail = (email: string): Promise<SearchUser[]> => {
  if (!email) return Promise.resolve([]);
  const results = Object.values(MOCK_USERS)
    .filter((u) => u.email.toLowerCase().includes(email.toLowerCase()))
    .map((u) => ({ ...u, id: u.uid }));
  return Promise.resolve(results);
};

export const getUserById = async (id: string): Promise<User | null> => {
  return MOCK_USERS[id] ?? null;
};

export const getIsFollowing = async (
  _userId: string,
  otherUserId: string,
): Promise<boolean> => {
  return followingSet.has(otherUserId);
};

export const changeFollowState = async ({
  otherUserId,
  isFollowing,
}: {
  otherUserId: string;
  isFollowing: boolean;
}) => {
  if (isFollowing) {
    followingSet.delete(otherUserId);
  } else {
    followingSet.add(otherUserId);
  }
  return true;
};
