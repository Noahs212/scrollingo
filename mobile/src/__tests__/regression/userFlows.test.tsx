/**
 * Regression tests for critical user flows.
 *
 * These tests verify REQUIREMENTS, not implementation details.
 * They should NOT be rewritten when components are refactored —
 * if a refactor breaks a test here, that's the test doing its job.
 *
 * Each test maps to a user-visible feature that must survive across milestones.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Video, User } from "../../../types";

// ─── Shared test data ───

const mockUser: User = {
  uid: "creator-001",
  email: "creator@test.com",
  displayName: "TestCreator",
  photoURL: "https://example.com/avatar.jpg",
  followingCount: 10,
  followersCount: 100,
  likesCount: 500,
  nativeLanguage: "en",
  targetLanguage: "zh",
  learningLanguages: ["zh"],
  streakDays: 5,
  longestStreak: 10,
  totalWordsLearned: 50,
  totalVideosWatched: 20,
  dailyGoalMinutes: 15,
  premium: false,
};

const mockVideo: Video = {
  id: "video-001",
  title: "Test Video Title",
  description: "Test description",
  language: "zh",
  cdn_url: "https://cdn.example.com/videos/video-001/video.mp4",
  thumbnail_url: "https://cdn.example.com/videos/video-001/thumbnail.jpg",
  duration_sec: 30,
  like_count: 42,
  comment_count: 5,
  view_count: 100,
  created_at: new Date().toISOString(),
  creator_id: "creator-001",
};

// ─── Mocks ───

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => true,
  useRoute: () => ({ params: {} }),
}));

jest.mock("react-redux", () => ({
  useSelector: jest.fn((selector) =>
    selector({
      auth: { currentUser: { uid: "me-001" } },
      language: { learningLanguages: ["zh"], activeLearningLanguage: "zh" },
    }),
  ),
  useDispatch: () => jest.fn(),
}));

jest.mock("../../redux/store", () => ({ RootState: {} }));
jest.mock("../../redux/slices/modalSlice", () => ({
  openCommentModal: jest.fn(() => ({ type: "modal/open" })),
}));
jest.mock("../../redux/slices/languageSlice", () => ({
  setActiveLearningLanguage: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children, ...props }: any) => {
    const { View } = require("react-native");
    return <View testID="linear-gradient" {...props}>{children}</View>;
  },
}));

jest.mock("react-native-paper", () => ({
  Avatar: { Icon: (props: any) => { const { View } = require("react-native"); return <View testID="avatar-icon" />; } },
}));

// ─── Flow 1 & 2: Creator attribution in feed overlay ───

describe("FLOW: Creator attribution on video overlay", () => {
  // Import overlay directly to test in isolation
  const PostSingleOverlay = require("../../components/general/post/overlay").default;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MUST show creator username when user is provided", () => {
    render(<PostSingleOverlay video={mockVideo} user={mockUser} />);
    expect(screen.getByText(`@${mockUser.displayName}`)).toBeTruthy();
  });

  it("MUST show creator avatar when user has photoURL", () => {
    const { toJSON } = render(<PostSingleOverlay video={mockVideo} user={mockUser} />);
    const json = JSON.stringify(toJSON());
    // Avatar image URL should be in the rendered tree
    expect(json).toContain(mockUser.photoURL);
  });

  it("MUST navigate to creator profile when username is tapped", () => {
    render(<PostSingleOverlay video={mockVideo} user={mockUser} />);
    const username = screen.getByText(`@${mockUser.displayName}`);
    fireEvent.press(username);
    expect(mockNavigate).toHaveBeenCalledWith("profileOther", {
      initialUserId: mockUser.uid,
    });
  });

  it("MUST show video title", () => {
    render(<PostSingleOverlay video={mockVideo} user={mockUser} />);
    expect(screen.getByText(mockVideo.title)).toBeTruthy();
  });

  it("MUST show like and comment counts", () => {
    render(<PostSingleOverlay video={mockVideo} user={mockUser} />);
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("MUST still render overlay when user is null (no crash)", () => {
    render(<PostSingleOverlay video={mockVideo} user={null} />);
    // Should show title but NOT username
    expect(screen.getByText(mockVideo.title)).toBeTruthy();
    expect(screen.queryByText(`@${mockUser.displayName}`)).toBeNull();
  });
});

// ─── Flow 3: Profile grid thumbnail navigation ───

describe("FLOW: Profile grid thumbnail navigates to correct video", () => {
  const ProfilePostListItem = require("../../components/profile/postList/item").default;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MUST navigate to userPosts with creator_id and correct index", () => {
    const { toJSON } = render(<ProfilePostListItem item={mockVideo} index={3} />);
    // The root element is a TouchableOpacity — press it
    const tree = toJSON();
    expect(tree).not.toBeNull();
    fireEvent.press(screen.root);
    expect(mockNavigate).toHaveBeenCalledWith("userPosts", {
      creator: mockVideo.creator_id,
      profile: true,
      initialIndex: 3,
    });
  });

  it("MUST render thumbnail from R2 CDN", () => {
    const { toJSON } = render(<ProfilePostListItem item={mockVideo} index={0} />);
    const json = JSON.stringify(toJSON());
    expect(json).toContain(mockVideo.thumbnail_url);
  });

  it("MUST handle null thumbnail gracefully", () => {
    const noThumbVideo = { ...mockVideo, thumbnail_url: null };
    render(<ProfilePostListItem item={noThumbVideo} index={0} />);
    // Should not crash — renders a placeholder View instead
    expect(screen.root).toBeTruthy();
  });
});
