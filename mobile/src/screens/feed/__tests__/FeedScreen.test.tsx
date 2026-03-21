// Polyfill window.dispatchEvent for React 19 test renderer
if (typeof window !== "undefined" && !window.dispatchEvent) {
  window.dispatchEvent = () => true;
}

import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import FeedScreen from "../index";
import { Video } from "../../../../types";

// Mock useMaterialNavBarHeight
jest.mock("../../../hooks/useMaterialNavBarHeight", () => ({
  __esModule: true,
  default: jest.fn(() => 80),
}));

// Mock the CurrentUserProfileItemInViewContext - use require inside factory
jest.mock("../../../navigation/feed", () => {
  const { createContext } = require("react");
  return {
    CurrentUserProfileItemInViewContext: createContext({
      currentUserProfileItemInView: null,
      setCurrentUserProfileItemInView: jest.fn(),
    }),
    FeedStackParamList: {},
  };
});

// Mock react-redux
jest.mock("react-redux", () => ({
  useSelector: jest.fn((selector) =>
    selector({
      auth: {
        currentUser: { uid: "user-001" },
      },
      language: {
        learningLanguages: ["zh"],
        activeLearningLanguage: "zh",
      },
    }),
  ),
  useDispatch: jest.fn(() => jest.fn()),
}));

// Mock useCurrentUserId
jest.mock("../../../hooks/useCurrentUserId", () => ({
  useCurrentUserId: jest.fn(() => "user-001"),
}));

// Mock Redux store
jest.mock("../../../redux/store", () => ({
  RootState: {},
}));

// Mock useUser (used by PostSingle for creator profiles)
jest.mock("../../../hooks/useUser", () => ({
  useUser: jest.fn(() => ({ data: null })),
}));

// Mock useSubtitles (used by PostSingle for OCR data)
jest.mock("../../../hooks/useSubtitles", () => ({
  useSubtitles: jest.fn(() => ({ data: null })),
}));

// Mock language slice
jest.mock("../../../redux/slices/languageSlice", () => ({
  setActiveLearningLanguage: jest.fn((code: string) => ({
    type: "language/setActiveLearningLanguage",
    payload: code,
  })),
}));

// Mock language service
jest.mock("../../../services/language", () => ({
  LEARNING_LANGUAGES: [
    { code: "en", name: "English", flag: "" },
    { code: "zh", name: "Chinese", flag: "" },
  ],
  updateActiveLanguage: jest.fn().mockResolvedValue(undefined),
}));

// Mock useFeed hook
const mockUseFeed = jest.fn();
jest.mock("../../../hooks/useFeed", () => ({
  useFeed: (...args: unknown[]) => mockUseFeed(...args),
}));

// Mock videos service
jest.mock("../../../services/videos", () => ({
  trackView: jest.fn(),
  fetchVideosByCreator: jest.fn().mockResolvedValue([]),
}));

// Mock useQuery for profile mode (fetchVideosByCreator)
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQuery: jest.fn(() => ({ data: [], isLoading: false })),
}));

// Mock useSubtitles
jest.mock("../../../hooks/useSubtitles", () => ({
  useSubtitles: jest.fn(() => ({ data: null })),
}));

// Mock posts service (may still be used by overlay)
jest.mock("../../../services/posts", () => ({
  getLikeById: jest.fn().mockResolvedValue(false),
  updateLike: jest.fn(),
}));

const createMockVideo = (overrides?: Partial<Video>): Video => ({
  id: "video-001",
  title: "Test Video",
  description: "Test description",
  language: "zh",
  cdn_url: "https://example.com/videos/test/video.mp4",
  thumbnail_url: "https://example.com/videos/test/thumbnail.jpg",
  duration_sec: 30,
  like_count: 42,
  comment_count: 5,
  view_count: 100,
  created_at: new Date().toISOString(),
  creator_id: "user-001",
  ...overrides,
});

const mockVideos: Video[] = [
  createMockVideo({
    id: "video-001",
    title: "Learning Spanish",
    description: "Learning Spanish with immersion videos #language #spanish",
    like_count: 42,
    comment_count: 5,
  }),
  createMockVideo({
    id: "video-002",
    title: "Japanese Phrases",
    description: "Japanese phrases for daily life #japanese",
    like_count: 128,
    comment_count: 12,
  }),
];

const createRoute = (params: { creator?: string; profile?: boolean } = {}) => ({
  key: "feed-route",
  name: "feedList" as const,
  params: {
    creator: params.creator ?? "",
    profile: params.profile ?? false,
  },
});

describe("FeedScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows a loading state initially before videos load", () => {
    mockUseFeed.mockReturnValue({
      data: undefined,
      isLoading: true,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const { toJSON } = render(<FeedScreen route={createRoute()} />);

    // While loading, no video views should be rendered (FlatList not shown)
    expect(screen.queryAllByTestId("video-view")).toHaveLength(0);

    // The component tree should exist (not null) - loading view is rendered
    expect(toJSON()).not.toBeNull();
  });

  it("renders videos after loading completes", async () => {
    mockUseFeed.mockReturnValue({
      data: { pages: [{ videos: mockVideos, nextCursor: null }] },
      isLoading: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    render(<FeedScreen route={createRoute()} />);

    // Wait for the loading state to clear and videos to render
    await waitFor(() => {
      const videoViews = screen.getAllByTestId("video-view");
      expect(videoViews.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("calls useFeed with the active learning language", () => {
    mockUseFeed.mockReturnValue({
      data: { pages: [{ videos: mockVideos, nextCursor: null }] },
      isLoading: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    render(<FeedScreen route={createRoute({ profile: false })} />);

    expect(mockUseFeed).toHaveBeenCalledWith("zh");
  });

  it("renders empty state when no videos are returned", () => {
    mockUseFeed.mockReturnValue({
      data: { pages: [{ videos: [], nextCursor: null }] },
      isLoading: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    render(<FeedScreen route={createRoute()} />);

    // Should show empty state, not video views
    expect(screen.queryAllByTestId("video-view")).toHaveLength(0);
    expect(screen.getByText("No videos yet")).toBeTruthy();
    expect(screen.getByText("Videos in your learning language will appear here")).toBeTruthy();
  });
});
