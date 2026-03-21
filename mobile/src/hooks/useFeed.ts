/**
 * useFeed — infinite-scroll hook for the video feed.
 * Wraps useInfiniteQuery to fetch paginated videos from Supabase.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";
import { fetchFeedPage } from "../services/videos";
import { FeedPage } from "../../types";

export function useFeed(language: string | null) {
  return useInfiniteQuery<
    FeedPage,
    Error,
    { pages: FeedPage[]; pageParams: unknown[] },
    ReturnType<typeof keys.feed>,
    FeedPage["nextCursor"]
  >({
    queryKey: keys.feed(language),
    queryFn: ({ pageParam }) => fetchFeedPage(language!, pageParam ?? undefined),
    initialPageParam: null as FeedPage["nextCursor"],
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!language,
    staleTime: 5 * 60 * 1000,
  });
}
