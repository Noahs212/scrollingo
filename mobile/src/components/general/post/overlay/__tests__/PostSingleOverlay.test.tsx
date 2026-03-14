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

const mockUser: User = {
  uid: "user-001",
  email: "test@example.com",
  displayName: "TestCreator",
  photoURL: undefined,
  followingCount: 5,
  followersCount: 10,
  likesCount: 50,
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
  // Wait for the async getLikeById effect to complete and state to settle
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

  it("renders the user display name with @ prefix", async () => {
    await renderOverlay(mockUser, mockPost);

    expect(screen.getByText("@TestCreator")).toBeTruthy();
  });

  it("falls back to email when displayName is null", async () => {
    const userWithoutName: User = {
      ...mockUser,
      displayName: null,
    };

    render(<PostSingleOverlay user={userWithoutName} post={mockPost} />);
    await waitFor(() => {
      expect(screen.getByText("@test@example.com")).toBeTruthy();
    });
  });

  it("renders the post description", async () => {
    await renderOverlay(mockUser, mockPost);

    expect(
      screen.getByText(
        "Learning Spanish with immersion videos #language #spanish",
      ),
    ).toBeTruthy();
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

    // Our Ionicons mock renders the icon name as text
    expect(screen.getByText("heart-outline")).toBeTruthy();
  });

  it("toggles the like state when the like button is pressed", async () => {
    await renderOverlay(mockUser, mockPost);

    // Initially shows heart-outline
    expect(screen.getByText("heart-outline")).toBeTruthy();

    // Press the like button
    fireEvent.press(screen.getByText("heart-outline"));

    // After pressing, should show filled heart and incremented count
    expect(screen.getByText("heart")).toBeTruthy();
    expect(screen.getByText("43")).toBeTruthy();
  });

  it("dispatches openCommentModal when comment button is pressed", async () => {
    await renderOverlay(mockUser, mockPost);

    // Press the comment button (the chatbubble-ellipses icon)
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
      // When photoURL is present, an Image is rendered instead of Avatar.Icon
      expect(screen.queryByTestId("avatar-icon")).toBeNull();
    });
  });
});
