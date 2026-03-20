import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import SettingsScreen from "../index";

const mockDispatch = jest.fn().mockReturnValue({ unwrap: jest.fn() });

jest.mock("react-redux", () => ({
  useSelector: jest.fn((selector) =>
    selector({
      auth: {
        currentUser: {
          uid: "user-123",
          dailyGoalMinutes: 10,
        },
      },
      language: {
        nativeLanguage: "es",
        learningLanguages: ["en", "zh"],
        activeLearningLanguage: "en",
        onboardingComplete: true,
      },
    }),
  ),
  useDispatch: () => mockDispatch,
}));

jest.mock("../../../hooks/useCurrentUserId", () => ({
  useCurrentUserId: jest.fn(() => "user-123"),
}));

jest.mock("../../../services/language", () => ({
  LEARNING_LANGUAGES: [
    { code: "en", name: "English", flag: "" },
    { code: "zh", name: "Chinese", flag: "" },
  ],
  NATIVE_LANGUAGES: [
    { code: "en", name: "English", flag: "" },
    { code: "es", name: "Spanish", flag: "" },
    { code: "zh", name: "Chinese", flag: "" },
    { code: "ja", name: "Japanese", flag: "" },
    { code: "ko", name: "Korean", flag: "" },
    { code: "hi", name: "Hindi", flag: "" },
    { code: "fr", name: "French", flag: "" },
    { code: "de", name: "German", flag: "" },
    { code: "pt", name: "Portuguese", flag: "" },
    { code: "ar", name: "Arabic", flag: "" },
    { code: "it", name: "Italian", flag: "" },
    { code: "ru", name: "Russian", flag: "" },
  ],
  updateActiveLanguage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../redux/slices/languageSlice", () => ({
  __esModule: true,
  default: jest.fn(),
  saveLanguages: jest.fn((args) => ({
    type: "language/save",
    meta: { arg: args },
  })),
  setActiveLearningLanguage: jest.fn(),
}));

jest.mock("../../../redux/slices/authSlice", () => ({
  __esModule: true,
  default: jest.fn(),
  logout: jest.fn(() => ({ type: "auth/logout" })),
  updateUserField: jest.fn((payload) => ({
    type: "auth/updateUserField",
    payload,
  })),
}));

jest.mock("../../../services/user", () => ({
  saveUserField: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../redux/store", () => ({
  RootState: {},
}));

describe("SettingsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all sections", () => {
    render(<SettingsScreen />);

    expect(screen.getByText("Native Language")).toBeTruthy();
    expect(screen.getByText("Learning Languages")).toBeTruthy();
    expect(screen.getByText("Daily Goal")).toBeTruthy();
    expect(screen.getByText("Sign Out")).toBeTruthy();
  });

  it("displays current native language", () => {
    render(<SettingsScreen />);

    expect(screen.getByText(/Spanish/)).toBeTruthy();
  });

  it("shows learning language chips with selected state", () => {
    render(<SettingsScreen />);

    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText("Chinese")).toBeTruthy();
  });

  it("renders daily goal options", () => {
    render(<SettingsScreen />);

    expect(screen.getByText("5 min")).toBeTruthy();
    expect(screen.getByText("10 min")).toBeTruthy();
    expect(screen.getByText("15 min")).toBeTruthy();
    expect(screen.getByText("20 min")).toBeTruthy();
    expect(screen.getByText("30 min")).toBeTruthy();
  });

  it("dispatches updateUserField when daily goal is changed", () => {
    const { updateUserField } = require("../../../redux/slices/authSlice");
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText("20 min"));
    expect(updateUserField).toHaveBeenCalledWith({
      field: "dailyGoalMinutes",
      value: 20,
    });
  });

  it("dispatches saveLanguages when learning language is toggled", () => {
    const { saveLanguages } = require("../../../redux/slices/languageSlice");
    render(<SettingsScreen />);

    // Toggle off Chinese (currently selected)
    // Both en and zh are selected; tapping Chinese should remove it
    fireEvent.press(screen.getByText("Chinese"));
    expect(saveLanguages).toHaveBeenCalledWith({
      userId: "user-123",
      nativeLanguage: "es",
      learningLanguages: ["en"],
    });
  });

  it("dispatches logout when Sign Out is pressed", () => {
    const { logout } = require("../../../redux/slices/authSlice");
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText("Sign Out"));
    expect(logout).toHaveBeenCalled();
  });

  it("does not dispatch when selecting already-active goal", () => {
    const { updateUserField } = require("../../../redux/slices/authSlice");
    render(<SettingsScreen />);

    // 10 min is already selected
    fireEvent.press(screen.getByText("10 min"));
    expect(updateUserField).not.toHaveBeenCalled();
  });
});
