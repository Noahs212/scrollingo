// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { changeFollowState } from "../services/user";
import { keys } from "./queryKeys";
import { useCurrentUserId } from "./useCurrentUserId";

/**
 * Mutate the state of the follow cache system
 * over a pair of users.
 * In order to do this action optimistically we mutate
 * the data as soon as the request is made, not waiting for the
 * firestore response.
 *
 * @param {Object} options to be passed along to useQuery
 * @returns
 */
export const useFollowingMutation = (options = {}) => {
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();

  return useMutation({
    mutationFn: changeFollowState,
    ...options,
    onMutate: (variables) => {
      if (!currentUserId) {
        console.error("No current user");
        return;
      }

      queryClient.setQueryData(
        keys.userFollowing(currentUserId, variables.otherUserId),
        !variables.isFollowing,
      );
    },
  });
};
