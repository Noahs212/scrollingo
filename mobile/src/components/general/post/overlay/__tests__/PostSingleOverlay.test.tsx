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
  ...overrides,
});

const mockVideo = createMockVideo();

// Helper that renders the overlay
function renderOverlay(video: Video = mockVideo) {
  render(<PostSingleOverlay video={video} />);
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
    expect(screen.getByText("Learning Spanish with immersion videos #language #spanish")).toBeTruthy();
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
      // Video info
      expect(screen.getByTestId("display-name")).toBeTruthy();
      expect(screen.getByTestId("description")).toBeTruthy();
      // Gradient
      expect(screen.getByTestId("linear-gradient")).toBeTruthy();
    });
  });

  // ── Long description / hashtag tests ──

  describe("long descriptions and hashtags", () => {
    it("renders long description with hashtags correctly", () => {
      const longVideo = createMockVideo({
        description:
          "This is a very long description about learning Chinese through immersion " +
          "with native content creators. Watch real conversations and pick up vocabulary " +
          "naturally! #中文 #学习 #language #learning #chinese #immersion #tiktok #scrollingo",
      });

      renderOverlay(longVideo);
      const desc = screen.getByTestId("description");
      expect(desc).toBeTruthy();
      // Verify numberOfLines limits the display
      expect(desc.props.numberOfLines).toBe(2);
      // Verify the full text is in the component (even if visually truncated)
      expect(desc.props.children).toContain("#中文");
      expect(desc.props.children).toContain("#scrollingo");
    });

    it("renders Chinese characters in description", () => {
      const chineseVideo = createMockVideo({
        description: "学习中文很有趣！#中文学习 #每日一句 #加油",
      });

      renderOverlay(chineseVideo);
      expect(screen.getByText("学习中文很有趣！#中文学习 #每日一句 #加油")).toBeTruthy();
    });

    it("renders description with many hashtags", () => {
      const hashtagVideo = createMockVideo({
        description:
          "#fyp #foryou #foryoupage #chinese #中文 #mandarin #learn #language " +
          "#study #daily #motivation #viral #trending #scrollingo #education",
      });

      renderOverlay(hashtagVideo);
      const desc = screen.getByTestId("description");
      expect(desc.props.numberOfLines).toBe(2);
      expect(desc.props.children).toContain("#fyp");
      expect(desc.props.children).toContain("#scrollingo");
    });

    it("renders null description gracefully", () => {
      const nullDescVideo = createMockVideo({ description: null });
      renderOverlay(nullDescVideo);
      // description element should not be rendered when null
      expect(screen.queryByTestId("description")).toBeNull();
    });

    it("renders description with emojis", () => {
      const emojiVideo = createMockVideo({
        description: "🔥 Best Chinese learning content 🇨🇳 #中文 #学习 💪 Keep going!",
      });

      renderOverlay(emojiVideo);
      expect(
        screen.getByText("🔥 Best Chinese learning content 🇨🇳 #中文 #学习 💪 Keep going!"),
      ).toBeTruthy();
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
