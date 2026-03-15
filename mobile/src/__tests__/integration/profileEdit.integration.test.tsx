/**
 * Integration tests for Profile Edit Flow.
 * Tests that edits save to service AND update Redux + invalidate React Query cache.
 */

jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "user-123", email: "test@test.com" } },
      }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      abortSignal: jest.fn().mockReturnThis(),
    }),
  },
}));

const mockSaveUserField = jest.fn().mockResolvedValue(undefined);
jest.mock("../../services/user", () => ({
  saveUserField: (...args: any[]) => mockSaveUserField(...args),
  getUserById: jest.fn().mockResolvedValue(null),
  saveUserProfileImage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/language", () => ({
  fetchUserLanguages: jest.fn(),
  updateUserLanguages: jest.fn(),
  LEARNING_LANGUAGES: [
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "zh", name: "Chinese", flag: "🇨🇳" },
  ],
  NATIVE_LANGUAGES: [
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "es", name: "Spanish", flag: "🇪🇸" },
  ],
}));

jest.mock("../../redux/slices/authSlice", () => ({
  __esModule: true,
  default: jest.fn(),
  updateUserField: jest.fn((payload) => ({ type: "auth/updateUserField", payload })),
  setUserState: jest.fn(),
}));

jest.mock("../../hooks/useCurrentUserId", () => ({
  useCurrentUserId: jest.fn(() => "user-123"),
}));

jest.mock("../../hooks/queryKeys", () => ({
  keys: { user: (id: string) => ["user", id] },
}));

// Mock SafeAreaView
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const { View } = require("react-native");
    return <View {...props}>{children}</View>;
  },
}));

// Mock react-native-paper
jest.mock("react-native-paper", () => ({
  Divider: () => null,
}));

// Mock styles
jest.mock("../../styles", () => ({
  generalStyles: { textInput: {} },
  buttonStyles: {},
}));

// Mock navigation
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: mockGoBack,
  }),
}));

// Mock NavBarGeneral to expose the save action
jest.mock("../../components/general/navbar", () => {
  const React = require("react");
  const { TouchableOpacity, Text } = require("react-native");
  return function MockNavBar({ rightButton }: any) {
    return rightButton?.display ? (
      <TouchableOpacity testID="save-button" onPress={rightButton.action}>
        <Text>{rightButton.name}</Text>
      </TouchableOpacity>
    ) : null;
  };
});

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react-native";
import EditProfileFieldScreen from "../../screens/profile/edit/field";
import { updateUserField } from "../../redux/slices/authSlice";

// Mock react-redux
const mockDispatch = jest.fn();
const mockInvalidateQueries = jest.fn();

jest.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: any) =>
    selector({
      auth: {
        currentUser: {
          uid: "user-123",
          displayName: "Old Name",
          dailyGoalMinutes: 10,
        },
        loaded: true,
      },
      language: {
        nativeLanguage: "en",
        learningLanguages: ["zh"],
      },
    }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

describe("Profile Edit Flow Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("edit display name → save → dispatches updateUserField + invalidates cache", async () => {
    const route = {
      params: { title: "Display Name", field: "displayName", value: "Old Name" },
      key: "test",
      name: "editProfileField" as const,
    };

    render(<EditProfileFieldScreen route={route as any} navigation={null as any} />);

    // Change the text input
    const input = screen.getByDisplayValue("Old Name");
    fireEvent.changeText(input, "New Name");

    // Press save
    await act(async () => {
      fireEvent.press(screen.getByTestId("save-button"));
    });

    // Verify service was called
    expect(mockSaveUserField).toHaveBeenCalledWith("displayName", "New Name");

    // Verify Redux dispatch
    expect(mockDispatch).toHaveBeenCalledWith(
      updateUserField({ field: "displayName", value: "New Name" }),
    );

    // Verify cache invalidation
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user", "user-123"],
    });

    // Verify navigation back
    expect(mockGoBack).toHaveBeenCalled();
  });

  it("edit daily goal → save → dispatches numeric value", async () => {
    const route = {
      params: { title: "Daily Goal (minutes)", field: "dailyGoalMinutes", value: "10" },
      key: "test",
      name: "editProfileField" as const,
    };

    render(<EditProfileFieldScreen route={route as any} navigation={null as any} />);

    const input = screen.getByDisplayValue("10");
    fireEvent.changeText(input, "20");

    await act(async () => {
      fireEvent.press(screen.getByTestId("save-button"));
    });

    expect(mockSaveUserField).toHaveBeenCalledWith("dailyGoalMinutes", "20");

    // Should dispatch as a number, not string
    expect(mockDispatch).toHaveBeenCalledWith(
      updateUserField({ field: "dailyGoalMinutes", value: 20 }),
    );
  });

  it("save failure does not navigate back", async () => {
    mockSaveUserField.mockRejectedValueOnce(new Error("Network error"));

    const route = {
      params: { title: "Display Name", field: "displayName", value: "Old Name" },
      key: "test",
      name: "editProfileField" as const,
    };

    render(<EditProfileFieldScreen route={route as any} navigation={null as any} />);

    fireEvent.changeText(screen.getByDisplayValue("Old Name"), "New Name");

    await act(async () => {
      fireEvent.press(screen.getByTestId("save-button"));
    });

    // Should NOT navigate back on failure
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
