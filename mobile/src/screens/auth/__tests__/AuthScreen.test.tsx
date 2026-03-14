import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

// --- Mock react-redux ---
const mockDispatch = jest.fn();
let mockSelectorValues: Record<string, any> = {};

jest.mock("react-redux", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: any) => any) => {
    // Build a fake state from mockSelectorValues
    const fakeState = {
      auth: {
        currentUser: mockSelectorValues.currentUser ?? null,
        loaded: mockSelectorValues.loaded ?? true,
        error: mockSelectorValues.error ?? null,
      },
    };
    return selector(fakeState);
  },
}));

// --- Mock auth thunks (they return action objects when called) ---
jest.mock("../../../redux/slices/authSlice", () => ({
  login: (payload: any) => ({ type: "auth/login", payload }),
  register: (payload: any) => ({ type: "auth/register", payload }),
  loginWithGoogle: () => ({ type: "auth/loginWithGoogle" }),
  loginWithApple: () => ({ type: "auth/loginWithApple" }),
}));

import AuthScreen from "../index";

describe("AuthScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDispatch.mockClear();
    mockSelectorValues = {};
  });

  // --- Rendering ---

  it("renders the app name", () => {
    render(<AuthScreen />);
    expect(screen.getByText("Scrollingo")).toBeTruthy();
  });

  it("renders the tagline", () => {
    render(<AuthScreen />);
    expect(screen.getByText("Learn languages through short videos")).toBeTruthy();
  });

  it("renders email and password inputs", () => {
    render(<AuthScreen />);
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
  });

  it("renders Sign In as the default submit button text", () => {
    render(<AuthScreen />);
    expect(screen.getByText("Sign In")).toBeTruthy();
  });

  it("renders the Google OAuth button", () => {
    render(<AuthScreen />);
    expect(screen.getByText("Continue with Google")).toBeTruthy();
  });

  it("renders the or divider between form and OAuth", () => {
    render(<AuthScreen />);
    expect(screen.getByText("or")).toBeTruthy();
  });

  it("renders the sign up toggle link", () => {
    render(<AuthScreen />);
    expect(screen.getByText(/Don't have an account/)).toBeTruthy();
  });

  // --- Toggle Sign In / Sign Up ---

  it("toggles to Sign Up mode when toggle is pressed", () => {
    render(<AuthScreen />);
    fireEvent.press(screen.getByText(/Don't have an account/));
    expect(screen.getByText("Sign Up")).toBeTruthy();
    expect(screen.getByText(/Already have an account/)).toBeTruthy();
  });

  it("toggles back to Sign In mode from Sign Up", () => {
    render(<AuthScreen />);
    fireEvent.press(screen.getByText(/Don't have an account/));
    fireEvent.press(screen.getByText(/Already have an account/));
    expect(screen.getByText("Sign In")).toBeTruthy();
  });

  // --- Login ---

  it("dispatches login with email and password on Sign In", () => {
    render(<AuthScreen />);

    fireEvent.changeText(screen.getByPlaceholderText("Email"), "test@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Password"), "password123");
    fireEvent.press(screen.getByTestId("submit-button"));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "auth/login",
      payload: { email: "test@example.com", password: "password123" },
    });
  });

  it("dispatches login with empty fields when no input provided", () => {
    render(<AuthScreen />);

    fireEvent.press(screen.getByTestId("submit-button"));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "auth/login",
      payload: { email: "", password: "" },
    });
  });

  // --- Registration ---

  it("dispatches register with email and password on Sign Up", () => {
    render(<AuthScreen />);

    // Toggle to sign up
    fireEvent.press(screen.getByText(/Don't have an account/));

    fireEvent.changeText(screen.getByPlaceholderText("Email"), "new@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Password"), "newpass123");
    fireEvent.press(screen.getByTestId("submit-button"));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "auth/register",
      payload: { email: "new@example.com", password: "newpass123" },
    });
  });

  // --- OAuth ---

  it("dispatches loginWithGoogle when Google button is pressed", () => {
    render(<AuthScreen />);

    fireEvent.press(screen.getByTestId("google-button"));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "auth/loginWithGoogle",
    });
  });

  // --- Error display ---

  it("displays an error message when auth error exists", () => {
    mockSelectorValues.error = "Invalid login credentials";

    render(<AuthScreen />);

    expect(screen.getByText("Invalid login credentials")).toBeTruthy();
  });

  it("does not display error text when there is no error", () => {
    render(<AuthScreen />);
    expect(screen.queryByText("Invalid login credentials")).toBeNull();
  });

  it("displays registration error message", () => {
    mockSelectorValues.error = "User already registered";

    render(<AuthScreen />);

    expect(screen.getByText("User already registered")).toBeTruthy();
  });

  it("displays generic error message", () => {
    mockSelectorValues.error = "Network request failed";

    render(<AuthScreen />);

    expect(screen.getByText("Network request failed")).toBeTruthy();
  });
});
