// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

export const keys = {
  user: (user: string | null) => ["user", user],
  userFollowing: (userId: string, otherUserId: string) => [
    "following",
    userId + otherUserId,
  ],
};
