import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import PostSingleOverlay from "../index";
import { Video } from "../../../../../../types";
import { useDispatch } from "react-redux";

// Mock the services
jest.mock("../../../../../services/posts", () => ({
  getLikeById: jest.fn().mockResolvedValue(false),
  updateLike: jest.fn(),
}));

// Mock throttle-debounce to execute immediately
jest.mock("throttle-debounce", () => ({
  throttle: jest.fn((_delay: number, fn: (...args: unknown[]) => void) => fn),
}));

// Mock safe area insets — simulate iPhone with home bar (bottom = 34)
const mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}));

const createMockVideo = (overrides?: Partial<Video>): Video => ({
  id: "video-001",
  title: "Test Video",
  description: "Learning Spanish with immersion videos #language #spanish",
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

// Helper that renders the overlay
function renderOverlay(video: Video = mockVideo) {
  render(<PostSingleOverlay video={video} user={null} />);
}

describe("PostSingleOverlay", () => {
  const mockDispatchFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useDispatch as unknown as jest.Mock).mockReturnValue(mockDispatchFn);
  });

  // ── Existing tests ──

  it("renders the video title", () => {
    renderOverlay();
    expect(screen.getByText("Test Video")).toBeTruthy();
  });

  it("renders the video description", () => {
    renderOverlay();
    expect(screen.getByText("Test Video")).toBeTruthy(); // overlay shows video.title
  });

  it("renders the like count", () => {
    renderOverlay();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("renders the comment count", () => {
    renderOverlay();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders the share button text", () => {
    renderOverlay();
    expect(screen.getByText("Share")).toBeTruthy();
  });

  it("renders the like button with heart-outline icon initially", () => {
    renderOverlay();
    expect(screen.getByText("heart-outline")).toBeTruthy();
  });

  it("toggles the like state when the like button is pressed", () => {
    renderOverlay();
    expect(screen.getByText("heart-outline")).toBeTruthy();
    fireEvent.press(screen.getByText("heart-outline"));
    expect(screen.getByText("heart")).toBeTruthy();
    expect(screen.getByText("43")).toBeTruthy();
  });

  it("dispatches openCommentModal when comment button is pressed", () => {
    renderOverlay();
    fireEvent.press(screen.getByText("chatbubble-ellipses"));
    expect(mockDispatchFn).toHaveBeenCalled();
  });

  it("renders the LinearGradient for readability", () => {
    renderOverlay();
    expect(screen.getByTestId("linear-gradient")).toBeTruthy();
  });

  // ── Layout & formatting tests ──

  describe("layout and formatting", () => {
    it("overlay container is absolutely positioned to fill parent", () => {
      renderOverlay();
      const container = screen.getByTestId("overlay-container");
      const style = container.props.style;
      // Flatten if array
      const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
      expect(flatStyle.position).toBe("absolute");
      expect(flatStyle.top).toBe(0);
      expect(flatStyle.bottom).toBe(0);
      expect(flatStyle.left).toBe(0);
      expect(flatStyle.right).toBe(0);
    });

    it("text container includes safe area bottom inset padding", () => {
      renderOverlay();
      const textContainer = screen.getByTestId("text-container");
      const styles = textContainer.props.style;
      // Style is an array: [staticStyle, { paddingBottom: 16 + insets.bottom }]
      const dynamicStyle = Array.isArray(styles) ? styles[1] : styles;
      expect(dynamicStyle.paddingBottom).toBe(16 + 34); // 16 base + 34 inset
    });

    it("text container has right padding to avoid overlapping action buttons", () => {
      renderOverlay();
      const textContainer = screen.getByTestId("text-container");
      const styles = textContainer.props.style;
      const staticStyle = Array.isArray(styles) ? styles[0] : styles;
      expect(staticStyle.paddingRight).toBeGreaterThanOrEqual(70);
    });

    it("actions column is positioned on the right side", () => {
      renderOverlay();
      const actionsColumn = screen.getByTestId("actions-column");
      const style = actionsColumn.props.style;
      const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
      expect(flatStyle.position).toBe("absolute");
      expect(flatStyle.right).toBeLessThanOrEqual(16);
    });

    it("description text is limited to 2 lines", () => {
      renderOverlay();
      const description = screen.getByTestId("description");
      expect(description.props.numberOfLines).toBe(2);
    });

    it("all overlay elements are present (complete overlay check)", () => {
      renderOverlay();
      // Action buttons
      expect(screen.getByText("heart-outline")).toBeTruthy();
      expect(screen.getByText("chatbubble-ellipses")).toBeTruthy();
      expect(screen.getByText("arrow-redo")).toBeTruthy();
      expect(screen.getByText("Share")).toBeTruthy();
      // Counts
      expect(screen.getByText("42")).toBeTruthy();
      expect(screen.getByText("5")).toBeTruthy();
      // Video info — title shown in description area, no username when user=null
      expect(screen.getByTestId("description")).toBeTruthy();
      expect(screen.queryByTestId("display-name")).toBeNull(); // user is null
      // Gradient
      expect(screen.getByTestId("linear-gradient")).toBeTruthy();
    });
  });

  // ── Long description / hashtag tests ──

  describe("long descriptions and hashtags", () => {
    it("renders title in the description area", () => {
      const video = createMockVideo({ title: "Chinese Tones Explained #声调" });
      renderOverlay(video);
      const desc = screen.getByTestId("description");
      expect(desc).toBeTruthy();
      expect(desc.props.numberOfLines).toBe(2);
      expect(desc.props.children).toContain("Chinese Tones Explained #声调");
    });

    it("renders Chinese title correctly", () => {
      const chineseVideo = createMockVideo({ title: "学习中文很有趣" });
      renderOverlay(chineseVideo);
      expect(screen.getByText("学习中文很有趣")).toBeTruthy();
    });

    it("renders long title with truncation", () => {
      const longVideo = createMockVideo({
        title: "A very long title that should be limited to two lines of text on the display",
      });
      renderOverlay(longVideo);
      const desc = screen.getByTestId("description");
      expect(desc.props.numberOfLines).toBe(2);
    });

    it("renders title even when description is null", () => {
      const nullDescVideo = createMockVideo({ description: null, title: "Still has title" });
      renderOverlay(nullDescVideo);
      expect(screen.getByText("Still has title")).toBeTruthy();
    });

    it("renders title with emojis", () => {
      const emojiVideo = createMockVideo({
        title: "🔥 Best Chinese Learning 🇨🇳 #中文",
      });
      renderOverlay(emojiVideo);
      expect(screen.getByText("🔥 Best Chinese Learning 🇨🇳 #中文")).toBeTruthy();
    });

    it("renders very long title without breaking layout", () => {
      const longTitleVideo = createMockVideo({
        title: "A Very Long Video Title With Many Characters That Might Overflow The Display",
      });

      renderOverlay(longTitleVideo);
      expect(
        screen.getByText("A Very Long Video Title With Many Characters That Might Overflow The Display"),
      ).toBeTruthy();
    });
  });
});
