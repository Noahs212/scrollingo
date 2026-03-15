import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import PostSingleOverlay from "../index";
import { Post, User } from "../../../../../../types";
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

const mockUser: User = {
  uid: "user-001",
  email: "test@example.com",
  displayName: "TestCreator",
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

const mockUserWithPhoto: User = {
  ...mockUser,
  photoURL: "https://example.com/avatar.jpg",
};

const mockPost: Post = {
  id: "post-001",
  creator: "user-001",
  media: ["https://example.com/video1.mp4", ""],
  description: "Learning Spanish with immersion videos #language #spanish",
  likesCount: 42,
  commentsCount: 5,
  creation: new Date().toISOString(),
};

// Helper that renders and waits for the getLikeById effect to settle
async function renderOverlay(user: User, post: Post) {
  render(<PostSingleOverlay user={user} post={post} />);
  await waitFor(() => {
    expect(screen.getByText("heart-outline")).toBeTruthy();
  });
}

describe("PostSingleOverlay", () => {
  const mockDispatchFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useDispatch as unknown as jest.Mock).mockReturnValue(mockDispatchFn);
  });

  // ── Existing tests ──

  it("renders the user display name with @ prefix", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByText("@TestCreator")).toBeTruthy();
  });

  it("falls back to email when displayName is null", async () => {
    const userWithoutName: User = { ...mockUser, displayName: null };
    render(<PostSingleOverlay user={userWithoutName} post={mockPost} />);
    await waitFor(() => {
      expect(screen.getByText("@test@example.com")).toBeTruthy();
    });
  });

  it("renders the post description", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByText("Learning Spanish with immersion videos #language #spanish")).toBeTruthy();
  });

  it("renders the like count", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("renders the comment count", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders the share button text", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByText("Share")).toBeTruthy();
  });

  it("renders the like button with heart-outline icon initially", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByText("heart-outline")).toBeTruthy();
  });

  it("toggles the like state when the like button is pressed", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByText("heart-outline")).toBeTruthy();
    fireEvent.press(screen.getByText("heart-outline"));
    expect(screen.getByText("heart")).toBeTruthy();
    expect(screen.getByText("43")).toBeTruthy();
  });

  it("dispatches openCommentModal when comment button is pressed", async () => {
    await renderOverlay(mockUser, mockPost);
    fireEvent.press(screen.getByText("chatbubble-ellipses"));
    expect(mockDispatchFn).toHaveBeenCalled();
  });

  it("renders the LinearGradient for readability", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByTestId("linear-gradient")).toBeTruthy();
  });

  it("renders avatar-icon when user has no photoURL", async () => {
    await renderOverlay(mockUser, mockPost);
    expect(screen.getByTestId("avatar-icon")).toBeTruthy();
  });

  it("renders a user avatar image when photoURL is present", async () => {
    render(<PostSingleOverlay user={mockUserWithPhoto} post={mockPost} />);
    await waitFor(() => {
      expect(screen.queryByTestId("avatar-icon")).toBeNull();
    });
  });

  // ── Layout & formatting tests ──

  describe("layout and formatting", () => {
    it("overlay container is absolutely positioned to fill parent", async () => {
      await renderOverlay(mockUser, mockPost);
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

    it("text container includes safe area bottom inset padding", async () => {
      await renderOverlay(mockUser, mockPost);
      const textContainer = screen.getByTestId("text-container");
      const styles = textContainer.props.style;
      // Style is an array: [staticStyle, { paddingBottom: 16 + insets.bottom }]
      const dynamicStyle = Array.isArray(styles) ? styles[1] : styles;
      expect(dynamicStyle.paddingBottom).toBe(16 + 34); // 16 base + 34 inset
    });

    it("text container has right padding to avoid overlapping action buttons", async () => {
      await renderOverlay(mockUser, mockPost);
      const textContainer = screen.getByTestId("text-container");
      const styles = textContainer.props.style;
      const staticStyle = Array.isArray(styles) ? styles[0] : styles;
      expect(staticStyle.paddingRight).toBeGreaterThanOrEqual(70);
    });

    it("actions column is positioned on the right side", async () => {
      await renderOverlay(mockUser, mockPost);
      const actionsColumn = screen.getByTestId("actions-column");
      const style = actionsColumn.props.style;
      const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
      expect(flatStyle.position).toBe("absolute");
      expect(flatStyle.right).toBeLessThanOrEqual(16);
    });

    it("description text is limited to 2 lines", async () => {
      await renderOverlay(mockUser, mockPost);
      const description = screen.getByTestId("description");
      expect(description.props.numberOfLines).toBe(2);
    });

    it("all overlay elements are present (complete overlay check)", async () => {
      await renderOverlay(mockUser, mockPost);
      // Avatar area
      expect(screen.getByTestId("avatar-icon") || screen.queryByTestId("avatar-icon")).toBeTruthy();
      // Action buttons
      expect(screen.getByText("heart-outline")).toBeTruthy();
      expect(screen.getByText("chatbubble-ellipses")).toBeTruthy();
      expect(screen.getByText("arrow-redo")).toBeTruthy();
      expect(screen.getByText("Share")).toBeTruthy();
      // Counts
      expect(screen.getByText("42")).toBeTruthy();
      expect(screen.getByText("5")).toBeTruthy();
      // User info
      expect(screen.getByTestId("display-name")).toBeTruthy();
      expect(screen.getByTestId("description")).toBeTruthy();
      // Gradient
      expect(screen.getByTestId("linear-gradient")).toBeTruthy();
    });
  });

  // ── Long description / hashtag tests ──

  describe("long descriptions and hashtags", () => {
    it("renders long description with hashtags correctly", async () => {
      const longPost: Post = {
        ...mockPost,
        description:
          "This is a very long description about learning Chinese through immersion " +
          "with native content creators. Watch real conversations and pick up vocabulary " +
          "naturally! #中文 #学习 #language #learning #chinese #immersion #tiktok #scrollingo",
      };

      render(<PostSingleOverlay user={mockUser} post={longPost} />);
      await waitFor(() => {
        const desc = screen.getByTestId("description");
        expect(desc).toBeTruthy();
        // Verify numberOfLines limits the display
        expect(desc.props.numberOfLines).toBe(2);
        // Verify the full text is in the component (even if visually truncated)
        expect(desc.props.children).toContain("#中文");
        expect(desc.props.children).toContain("#scrollingo");
      });
    });

    it("renders Chinese characters in description", async () => {
      const chinesePost: Post = {
        ...mockPost,
        description: "学习中文很有趣！#中文学习 #每日一句 #加油",
      };

      render(<PostSingleOverlay user={mockUser} post={chinesePost} />);
      await waitFor(() => {
        expect(screen.getByText("学习中文很有趣！#中文学习 #每日一句 #加油")).toBeTruthy();
      });
    });

    it("renders description with many hashtags", async () => {
      const hashtagPost: Post = {
        ...mockPost,
        description:
          "#fyp #foryou #foryoupage #chinese #中文 #mandarin #learn #language " +
          "#study #daily #motivation #viral #trending #scrollingo #education",
      };

      render(<PostSingleOverlay user={hashtagPost.creator === mockUser.uid ? mockUser : mockUser} post={hashtagPost} />);
      await waitFor(() => {
        const desc = screen.getByTestId("description");
        expect(desc.props.numberOfLines).toBe(2);
        expect(desc.props.children).toContain("#fyp");
        expect(desc.props.children).toContain("#scrollingo");
      });
    });

    it("renders empty description gracefully", async () => {
      const emptyPost: Post = { ...mockPost, description: "" };
      render(<PostSingleOverlay user={mockUser} post={emptyPost} />);
      await waitFor(() => {
        const desc = screen.getByTestId("description");
        expect(desc).toBeTruthy();
        expect(desc.props.children).toBe("");
      });
    });

    it("renders description with emojis", async () => {
      const emojiPost: Post = {
        ...mockPost,
        description: "🔥 Best Chinese learning content 🇨🇳 #中文 #学习 💪 Keep going!",
      };

      render(<PostSingleOverlay user={mockUser} post={emojiPost} />);
      await waitFor(() => {
        expect(
          screen.getByText("🔥 Best Chinese learning content 🇨🇳 #中文 #学习 💪 Keep going!"),
        ).toBeTruthy();
      });
    });

    it("renders very long username without breaking layout", async () => {
      const longNameUser: User = {
        ...mockUser,
        displayName: "AVeryLongUsernameWithManyCharactersThatMightOverflow",
      };

      render(<PostSingleOverlay user={longNameUser} post={mockPost} />);
      await waitFor(() => {
        expect(
          screen.getByText("@AVeryLongUsernameWithManyCharactersThatMightOverflow"),
        ).toBeTruthy();
      });
    });
  });
});
