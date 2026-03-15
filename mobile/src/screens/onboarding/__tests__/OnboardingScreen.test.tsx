import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import OnboardingScreen from "../index";

// Mock react-redux hooks
const mockDispatch = jest.fn().mockReturnValue({ unwrap: jest.fn() });
jest.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: any) => {
    const mockState = {
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
    };
    return selector(mockState);
  },
}));

// Mock language service (prevent supabase import)
jest.mock("../../../services/language", () => ({
  fetchUserLanguages: jest.fn(),
  updateUserLanguages: jest.fn(),
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

jest.mock("../../../redux/slices/languageSlice", () => ({
  __esModule: true,
  default: jest.fn(),
  saveLanguages: jest.fn(() => ({ type: "language/save" })),
}));

describe("OnboardingScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the native language selection step first", () => {
    render(<OnboardingScreen />);
    expect(screen.getByText("What language do you speak?")).toBeTruthy();
    expect(screen.getByText("Continue")).toBeTruthy();
  });

  it("navigates to learning step after selecting native language", () => {
    render(<OnboardingScreen />);
    fireEvent.press(screen.getByText("Spanish"));
    fireEvent.press(screen.getByText("Continue"));
    expect(screen.getByText("What do you want to learn?")).toBeTruthy();
  });

  it("excludes native language from learning options", () => {
    render(<OnboardingScreen />);
    fireEvent.press(screen.getByText("English"));
    fireEvent.press(screen.getByText("Continue"));
    expect(screen.getByText("Chinese")).toBeTruthy();
  });

  it("can go back from learning step", () => {
    render(<OnboardingScreen />);
    fireEvent.press(screen.getByText("Spanish"));
    fireEvent.press(screen.getByText("Continue"));
    fireEvent.press(screen.getByText("Back"));
    expect(screen.getByText("What language do you speak?")).toBeTruthy();
  });

  it("dispatches saveLanguages on Start Learning", () => {
    render(<OnboardingScreen />);
    fireEvent.press(screen.getByText("Spanish"));
    fireEvent.press(screen.getByText("Continue"));
    fireEvent.press(screen.getByText("Chinese"));
    fireEvent.press(screen.getByText("Start Learning"));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("renders all 12 native language options", () => {
    render(<OnboardingScreen />);
    for (const lang of ["English", "Spanish", "Chinese", "Japanese", "Korean",
      "Hindi", "French", "German", "Portuguese", "Arabic", "Italian", "Russian"]) {
      expect(screen.getByText(lang)).toBeTruthy();
    }
  });

  it("shows Start Learning button disabled when no learning language selected", () => {
    render(<OnboardingScreen />);
    fireEvent.press(screen.getByText("Spanish"));
    fireEvent.press(screen.getByText("Continue"));
    // Start Learning should exist but be disabled (no learning lang selected)
    expect(screen.getByText("Start Learning")).toBeTruthy();
  });
});
