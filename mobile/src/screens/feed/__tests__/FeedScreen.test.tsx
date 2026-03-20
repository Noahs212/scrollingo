// Polyfill window.dispatchEvent for React 19 test renderer
if (typeof window !== "undefined" && !window.dispatchEvent) {
  window.dispatchEvent = () => true;
}

import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import FeedScreen from "../index";
import { Post } from "../../../../types";
import { getFeed, getPostsByUserId } from "../../../services/posts";

// Mock useMaterialNavBarHeight
jest.mock("../../../hooks/useMaterialNavBarHeight", () => ({
  __esModule: true,
  default: jest.fn(() => 80),
}));

// Mock the useUser hook used by PostSingle -> PostSingleOverlay
jest.mock("../../../hooks/useUser", () => ({
  useUser: jest.fn(() => ({
    data: {
      uid: "user-001",
      email: "test@example.com",
      displayName: "TestUser",
      photoURL: null,
      followingCount: 5,
      followersCount: 10,
      likesCount: 50,
    },
    isLoading: false,
    error: null,
  })),
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

// Mock posts service
jest.mock("../../../services/posts", () => ({
  getFeed: jest.fn(),
  getPostsByUserId: jest.fn(),
  getLikeById: jest.fn().mockResolvedValue(false),
  updateLike: jest.fn(),
}));

const mockPosts: Post[] = [
  {
    id: "post-001",
    creator: "user-001",
    media: ["https://example.com/video1.mp4", ""],
    description: "Learning Spanish with immersion videos #language #spanish",
    likesCount: 42,
    commentsCount: 5,
    creation: new Date().toISOString(),
  },
  {
    id: "post-002",
    creator: "user-002",
    media: ["https://example.com/video2.mp4", ""],
    description: "Japanese phrases for daily life #japanese",
    likesCount: 128,
    commentsCount: 12,
    creation: new Date().toISOString(),
  },
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

  it("shows a loading state initially before posts load", () => {
    // Make getFeed return a promise that never resolves, keeping loading=true
    (getFeed as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { toJSON } = render(<FeedScreen route={createRoute()} />);

    // While loading, no video views should be rendered (FlatList not shown)
    expect(screen.queryAllByTestId("video-view")).toHaveLength(0);

    // The component tree should exist (not null) - loading view is rendered
    expect(toJSON()).not.toBeNull();
  });

  it("renders posts after loading completes", async () => {
    (getFeed as jest.Mock).mockResolvedValue(mockPosts);

    render(<FeedScreen route={createRoute()} />);

    // Wait for the loading state to clear and posts to render
    await waitFor(() => {
      const videoViews = screen.getAllByTestId("video-view");
      expect(videoViews.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("calls getFeed when profile param is false", async () => {
    (getFeed as jest.Mock).mockResolvedValue(mockPosts);

    render(<FeedScreen route={createRoute({ profile: false })} />);

    await waitFor(() => {
      expect(getFeed).toHaveBeenCalled();
    });
  });

  it("calls getPostsByUserId when profile param is true with a creator", async () => {
    (getPostsByUserId as jest.Mock).mockResolvedValue([mockPosts[0]]);

    render(
      <FeedScreen
        route={createRoute({ profile: true, creator: "user-001" })}
      />,
    );

    await waitFor(() => {
      expect(getPostsByUserId).toHaveBeenCalledWith("user-001");
    });
  });

  it("renders empty state when no posts are returned", async () => {
    (getFeed as jest.Mock).mockResolvedValue([]);

    render(<FeedScreen route={createRoute()} />);

    await waitFor(() => {
      expect(getFeed).toHaveBeenCalled();
    });

    // Should show empty state, not video views
    expect(screen.queryAllByTestId("video-view")).toHaveLength(0);
    expect(screen.getByText("No videos yet")).toBeTruthy();
    expect(screen.getByText("Videos in your learning language will appear here")).toBeTruthy();
  });
});
