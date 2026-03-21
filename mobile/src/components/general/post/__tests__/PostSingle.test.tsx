import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import PostSingle from "../index";
import { Video } from "../../../../../types";
import { useVideoPlayer } from "expo-video";

// Mock the useSubtitles hook
jest.mock("../../../../hooks/useSubtitles", () => ({
  useSubtitles: jest.fn(() => ({ data: null })),
}));

// Mock useUser (PostSingle fetches creator profile)
jest.mock("../../../../hooks/useUser", () => ({
  useUser: jest.fn(() => ({ data: null })),
}));

// Mock useWordDefinitions (PostSingle fetches word translations)
jest.mock("../../../../hooks/useWordDefinitions", () => ({
  useWordDefinitions: jest.fn(() => ({ data: null })),
}));

// Mock expo-haptics
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

// Mock react-redux for nativeLanguage
jest.mock("react-redux", () => ({
  useSelector: jest.fn((selector) =>
    selector({ language: { nativeLanguage: "en" } }),
  ),
}));

// Mock redux store
jest.mock("../../../../redux/store", () => ({ RootState: {} }));

// Mock PostSingleOverlay to isolate PostSingle tests
jest.mock("../overlay", () => {
  const { View, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ video }: { video: Video }) => (
      <View testID="post-overlay">
        <Text testID="overlay-title">{video.title}</Text>
        <Text testID="overlay-description">{video.description}</Text>
      </View>
    ),
  };
});

// Mock getLikeById
jest.mock("../../../../services/posts", () => ({
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

const mockVideo = createMockVideo();

describe("PostSingle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the VideoView component", () => {
    render(<PostSingle item={mockVideo} />);

    const videoView = screen.getByTestId("video-view");
    expect(videoView).toBeTruthy();
  });

  it("initializes the video player with the video cdn_url", () => {
    render(<PostSingle item={mockVideo} />);

    expect(useVideoPlayer).toHaveBeenCalledWith(
      "https://example.com/videos/test/video.mp4",
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

    render(<PostSingle item={mockVideo} />);

    // The setup callback should set loop to true
    expect(mockPlayer.loop).toBe(true);
  });

  it("renders the overlay with video title", () => {
    render(<PostSingle item={mockVideo} />);

    const overlay = screen.getByTestId("post-overlay");
    expect(overlay).toBeTruthy();

    expect(screen.getByTestId("overlay-title")).toBeTruthy();
    expect(screen.getByText("Test Video")).toBeTruthy();
  });

  it("renders the video description in the overlay", () => {
    render(<PostSingle item={mockVideo} />);

    expect(screen.getByText("Test description")).toBeTruthy();
  });

  it("exposes play and stop methods via ref", () => {
    const ref = React.createRef<{ play: () => void; stop: () => void; unload: () => void }>();

    render(<PostSingle item={mockVideo} ref={ref} />);

    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.play).toBe("function");
    expect(typeof ref.current?.stop).toBe("function");
    expect(typeof ref.current?.unload).toBe("function");
  });
});
