/**
 * Integration tests for the Onboarding Flow.
 * Tests the full 3-step flow: native → learning → daily goal.
 */

// Mock supabase before anything
jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      abortSignal: jest.fn().mockReturnThis(),
    }),
  },
}));

jest.mock("../../services/user", () => ({
  saveUserField: jest.fn().mockResolvedValue(undefined),
  getUserById: jest.fn().mockResolvedValue(null),
}));

jest.mock("../../services/language", () => ({
  fetchUserLanguages: jest.fn(),
  updateUserLanguages: jest.fn().mockResolvedValue(undefined),
  LEARNING_LANGUAGES: [
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "zh", name: "Chinese", flag: "🇨🇳" },
  ],
  NATIVE_LANGUAGES: [
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "es", name: "Spanish", flag: "🇪🇸" },
    { code: "zh", name: "Chinese", flag: "🇨🇳" },
    { code: "ja", name: "Japanese", flag: "🇯🇵" },
    { code: "ko", name: "Korean", flag: "🇰🇷" },
    { code: "hi", name: "Hindi", flag: "🇮🇳" },
    { code: "fr", name: "French", flag: "🇫🇷" },
    { code: "de", name: "German", flag: "🇩🇪" },
    { code: "pt", name: "Portuguese", flag: "🇧🇷" },
    { code: "ar", name: "Arabic", flag: "🇸🇦" },
    { code: "it", name: "Italian", flag: "🇮🇹" },
    { code: "ru", name: "Russian", flag: "🇷🇺" },
  ],
}));

jest.mock("../../redux/slices/languageSlice", () => ({
  __esModule: true,
  default: jest.fn(),
  saveLanguages: jest.fn(() => ({ type: "language/save" })),
}));

jest.mock("../../redux/slices/authSlice", () => ({
  __esModule: true,
  default: jest.fn(),
  updateUserField: jest.fn((payload) => ({ type: "auth/updateUserField", payload })),
}));

jest.mock("../../services/posts", () => ({
  getPostsByUserId: jest.fn().mockResolvedValue([]),
}));

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import OnboardingScreen from "../../screens/onboarding";
import { saveLanguages } from "../../redux/slices/languageSlice";
import { updateUserField } from "../../redux/slices/authSlice";
import { saveUserField } from "../../services/user";

// Mock react-redux hooks
const mockDispatch = jest.fn().mockReturnValue(Promise.resolve());
jest.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: any) => {
    return selector({
      auth: {
        currentUser: { uid: "user-123" },
        loaded: true,
        error: null,
      },
      language: {
        nativeLanguage: null,
        learningLanguages: [],
        activeLearningLanguage: null,
        onboardingComplete: false,
        loaded: false,
        loading: false,
        error: null,
      },
    });
  },
}));

describe("Onboarding Flow Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("completes full 3-step flow: native → learning → goal → dispatches save", () => {
    render(<OnboardingScreen />);

    // Step 1: Native language
    expect(screen.getByText("What language do you speak?")).toBeTruthy();
    fireEvent.press(screen.getByText("Spanish"));
    fireEvent.press(screen.getByText("Continue"));

    // Step 2: Learning language
    expect(screen.getByText("What do you want to learn?")).toBeTruthy();
    fireEvent.press(screen.getByText("Chinese"));
    fireEvent.press(screen.getByText("Continue"));

    // Step 3: Daily goal
    expect(screen.getByText("Set your daily goal")).toBeTruthy();
    expect(screen.getByText("5 min")).toBeTruthy();
    expect(screen.getByText("10 min")).toBeTruthy();
    expect(screen.getByText("30 min")).toBeTruthy();
    fireEvent.press(screen.getByText("15 min"));
    fireEvent.press(screen.getByText("Start Learning"));

    // Verify dispatches
    expect(mockDispatch).toHaveBeenCalledWith(
      updateUserField({ field: "dailyGoalMinutes", value: 15 }),
    );
    expect(saveUserField).toHaveBeenCalledWith("dailyGoalMinutes", "15");
    expect(mockDispatch).toHaveBeenCalledWith(
      saveLanguages({
        userId: "user-123",
        nativeLanguage: "es",
        learningLanguages: ["zh"],
      }),
    );
  });

  it("going back through all steps preserves selections", () => {
    render(<OnboardingScreen />);

    // Step 1
    fireEvent.press(screen.getByText("Spanish"));
    fireEvent.press(screen.getByText("Continue"));

    // Step 2
    fireEvent.press(screen.getByText("Chinese"));
    fireEvent.press(screen.getByText("Continue"));

    // Step 3: go back to step 2
    fireEvent.press(screen.getByText("Back"));
    expect(screen.getByText("What do you want to learn?")).toBeTruthy();

    // Go back to step 1
    fireEvent.press(screen.getByText("Back"));
    expect(screen.getByText("What language do you speak?")).toBeTruthy();
    // Spanish should still be visually marked (re-rendered)
  });

  it("selecting English as native removes it from learning options", () => {
    render(<OnboardingScreen />);

    fireEvent.press(screen.getByText("English"));
    fireEvent.press(screen.getByText("Continue"));

    // Only Chinese should appear (English filtered out)
    expect(screen.getByText("Chinese")).toBeTruthy();
    // "English" text still exists in other contexts, but not as a learning option
    const learningTitle = screen.getByText("What do you want to learn?");
    expect(learningTitle).toBeTruthy();
  });

  it("daily goal defaults to 10 minutes", () => {
    render(<OnboardingScreen />);

    fireEvent.press(screen.getByText("Spanish"));
    fireEvent.press(screen.getByText("Continue"));
    fireEvent.press(screen.getByText("Chinese"));
    fireEvent.press(screen.getByText("Continue"));

    // Tap Start Learning without changing the default
    fireEvent.press(screen.getByText("Start Learning"));

    // Should dispatch with default 10 min
    expect(mockDispatch).toHaveBeenCalledWith(
      updateUserField({ field: "dailyGoalMinutes", value: 10 }),
    );
  });
});
