// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDispatch } from "react-redux";
import { changeFollowState } from "../services/user";
import { keys } from "./queryKeys";
import { useCurrentUserId } from "./useCurrentUserId";
import { updateUserField } from "../redux/slices/authSlice";
import { store, AppDispatch } from "../redux/store";
import { User } from "../../types";

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
  const dispatch = useDispatch<AppDispatch>();

  return useMutation({
    mutationFn: changeFollowState,
    ...options,
    onMutate: (variables) => {
      if (!currentUserId) {
        console.error("No current user");
        return;
      }

      const delta = variables.isFollowing ? -1 : 1;

      // Update follow boolean cache
      queryClient.setQueryData(
        keys.userFollowing(currentUserId, variables.otherUserId),
        !variables.isFollowing,
      );

      // Update current user's followingCount in Redux
      const currentUser = store.getState().auth.currentUser;
      if (currentUser) {
        dispatch(
          updateUserField({
            field: "followingCount",
            value: Math.max((currentUser.followingCount ?? 0) + delta, 0),
          }),
        );
      }

      // Update other user's followersCount in React Query cache
      queryClient.setQueryData(
        keys.user(variables.otherUserId),
        (old: User | undefined) => {
          if (!old) return old;
          return {
            ...old,
            followersCount: Math.max((old.followersCount ?? 0) + delta, 0),
          };
        },
      );
    },
  });
};
