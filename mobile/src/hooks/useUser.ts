// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { getUserById } from "../services/user";

/**
 * hook meant to fetch a user using react-query in order
 * to cache data and avoid unnecessary queries to be made
 * to firestore
 *
 * @param {String} userId of the user we want to fetch
 * @param {Object} options to be passed along to useQuery
 * @returns
 */
export const useUser = (userId: string | null, options = {}) => {
  return useQuery({
    queryKey: keys.user(userId),
    queryFn: () => {
      if (!userId) {
        return null;
      }
      return getUserById(userId);
    },
    ...options,
  });
};
