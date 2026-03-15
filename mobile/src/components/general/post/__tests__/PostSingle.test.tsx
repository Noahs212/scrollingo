import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import PostSingle from "../index";
import { Post, User } from "../../../../../types";
import { useVideoPlayer } from "expo-video";

// Mock the useUser hook
const mockUser: User = {
  uid: "user-001",
  email: "test@example.com",
  displayName: "TestUser",
  photoURL: undefined,
  followingCount: 5,
  followersCount: 10,
  likesCount: 50,
  nativeLanguage: "en",
  targetLanguage: "es",
  learningLanguages: ["es"],
  streakDays: 0,
  longestStreak: 0,
  totalWordsLearned: 0,
  totalVideosWatched: 0,
  dailyGoalMinutes: 10,
  premium: false,
};

jest.mock("../../../../hooks/useUser", () => ({
  useUser: jest.fn(() => ({
    data: mockUser,
    isLoading: false,
    error: null,
  })),
}));

// Mock PostSingleOverlay to isolate PostSingle tests
jest.mock("../overlay", () => {
  const { View, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ user, post }: { user: User; post: Post }) => (
      <View testID="post-overlay">
        <Text testID="overlay-username">@{user.displayName}</Text>
        <Text testID="overlay-description">{post.description}</Text>
      </View>
    ),
  };
});

// Mock getLikeById
jest.mock("../../../../services/posts", () => ({
  getLikeById: jest.fn().mockResolvedValue(false),
  updateLike: jest.fn(),
}));

const mockPost: Post = {
  id: "post-001",
  creator: "user-001",
  media: ["https://example.com/video1.mp4", ""],
  description: "Test video description #test",
  likesCount: 42,
  commentsCount: 5,
  creation: new Date().toISOString(),
};

describe("PostSingle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the VideoView component", () => {
    render(<PostSingle item={mockPost} />);

    const videoView = screen.getByTestId("video-view");
    expect(videoView).toBeTruthy();
  });

  it("initializes the video player with the post media URL", () => {
    render(<PostSingle item={mockPost} />);

    expect(useVideoPlayer).toHaveBeenCalledWith(
      "https://example.com/video1.mp4",
      expect.any(Function),
    );
  });

  it("sets the player to loop mode", () => {
    const mockPlayer = {
      play: jest.fn(),
      pause: jest.fn(),
      loop: false,
      currentTime: 0,
      duration: 0,
      muted: false,
      volume: 1,
      status: "idle",
      replace: jest.fn(),
      seekBy: jest.fn(),
      replay: jest.fn(),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
    };

    (useVideoPlayer as jest.Mock).mockImplementation((_source, setup) => {
      if (setup) setup(mockPlayer);
      return mockPlayer;
    });

    render(<PostSingle item={mockPost} />);

    // The setup callback should set loop to true
    expect(mockPlayer.loop).toBe(true);
  });

  it("renders the overlay with user info when user data is available", () => {
    render(<PostSingle item={mockPost} />);

    const overlay = screen.getByTestId("post-overlay");
    expect(overlay).toBeTruthy();

    expect(screen.getByTestId("overlay-username")).toBeTruthy();
    expect(screen.getByText("@TestUser")).toBeTruthy();
  });

  it("renders the post description in the overlay", () => {
    render(<PostSingle item={mockPost} />);

    expect(screen.getByText("Test video description #test")).toBeTruthy();
  });

  it("exposes play and stop methods via ref", () => {
    const ref = React.createRef<{ play: () => void; stop: () => void; unload: () => void }>();

    render(<PostSingle item={mockPost} ref={ref} />);

    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.play).toBe("function");
    expect(typeof ref.current?.stop).toBe("function");
    expect(typeof ref.current?.unload).toBe("function");
  });
});
