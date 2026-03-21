import { useQuery } from "@tanstack/react-query";
import { getIsFollowing } from "../services/user";
import { keys } from "./queryKeys";

/**
 * Hook to check if a user is following another user.
 * Uses React Query for caching. Returns null when either ID is missing.
 */
export const useFollowing = (
  userId: string | null,
  otherUserId: string | null,
) => {
  return useQuery({
    queryKey: keys.userFollowing(userId ?? "", otherUserId ?? ""),
    queryFn: () => getIsFollowing(userId!, otherUserId!),
    enabled: !!userId && !!otherUserId,
  });
};
