/**
 * Integration tests for the Language Loading Flow.
 *
 * Tests how language loading from the server affects onboarding state,
 * using the REAL Redux store with all reducers.
 */

// --- Mocks must come before any imports that use the mocked modules ---

jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
    }),
  },
}));

jest.mock("../../services/user", () => ({
  saveUserField: jest.fn().mockResolvedValue(undefined),
  getUserById: jest.fn().mockResolvedValue(null),
}));

const mockFetchUserLanguages = jest.fn();
const mockUpdateUserLanguages = jest.fn();

jest.mock("../../services/language", () => ({
  fetchUserLanguages: (...args: any[]) => mockFetchUserLanguages(...args),
  updateUserLanguages: (...args: any[]) => mockUpdateUserLanguages(...args),
  LEARNING_LANGUAGES: [
    { code: "en", name: "English", flag: "\u{1F1FA}\u{1F1F8}" },
    { code: "zh", name: "Chinese", flag: "\u{1F1E8}\u{1F1F3}" },
  ],
  NATIVE_LANGUAGES: [
    { code: "en", name: "English", flag: "\u{1F1FA}\u{1F1F8}" },
    { code: "es", name: "Spanish", flag: "\u{1F1EA}\u{1F1F8}" },
  ],
}));

jest.mock("../../services/posts", () => ({
  getPostsByUserId: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../services/utils", () => ({
  saveMediaToStorage: jest.fn(),
}));

import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../../redux/slices/authSlice";
import postReducer from "../../redux/slices/postSlice";
import modalReducer from "../../redux/slices/modalSlice";
import chatReducer from "../../redux/slices/chatSlice";
import languageReducer, {
  loadLanguages,
  saveLanguages,
} from "../../redux/slices/languageSlice";

function createTestStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      post: postReducer,
      modal: modalReducer,
      chat: chatReducer,
      language: languageReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
}

describe("Language Loading Flow Integration", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = createTestStore();
  });

  it("when languages load successfully with non-default values -> onboardingComplete = true", async () => {
    mockFetchUserLanguages.mockResolvedValue({
      native_language: "es",
      target_language: "zh",
      learning_languages: ["zh"],
    });

    await store.dispatch(loadLanguages("user-123"));

    const state = store.getState().language;
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.onboardingComplete).toBe(true);
    expect(state.nativeLanguage).toBe("es");
    expect(state.learningLanguages).toEqual(["zh"]);
    expect(state.activeLearningLanguage).toBe("zh");
    expect(state.error).toBeNull();
  });

  it("when languages load with default values -> onboardingComplete = false", async () => {
    mockFetchUserLanguages.mockResolvedValue({
      native_language: "en",
      target_language: "en",
      learning_languages: ["en"],
    });

    await store.dispatch(loadLanguages("user-123"));

    const state = store.getState().language;
    expect(state.loaded).toBe(true);
    expect(state.onboardingComplete).toBe(false);
    // The default values should still be populated in state
    expect(state.nativeLanguage).toBe("en");
    expect(state.learningLanguages).toEqual(["en"]);
  });

  it("when language load fails -> onboardingComplete = false, loaded = true (no black screen)", async () => {
    mockFetchUserLanguages.mockRejectedValue(
      new Error("Network request failed"),
    );

    await store.dispatch(loadLanguages("user-123"));

    const state = store.getState().language;
    // loaded must be true to prevent the loading screen from showing forever
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    // onboardingComplete should be false so user sees onboarding
    expect(state.onboardingComplete).toBe(false);
    expect(state.error).toBe("Network request failed");
  });

  it("save languages optimistically updates state even before server response", () => {
    // Make the server call hang indefinitely
    mockUpdateUserLanguages.mockReturnValue(new Promise(() => {}));

    // Dispatch save (do NOT await - we want to check intermediate state)
    store.dispatch(
      saveLanguages({
        userId: "user-123",
        nativeLanguage: "ja",
        learningLanguages: ["en", "zh"],
      }),
    );

    // State should be updated immediately (optimistic update)
    const state = store.getState().language;
    expect(state.nativeLanguage).toBe("ja");
    expect(state.learningLanguages).toEqual(["en", "zh"]);
    expect(state.activeLearningLanguage).toBe("en");
    expect(state.onboardingComplete).toBe(true);
    expect(state.loading).toBe(true); // Still loading since server hasn't responded
  });

  it("save languages keeps onboardingComplete even if server fails", async () => {
    mockUpdateUserLanguages.mockRejectedValue(new Error("Server error"));

    await store.dispatch(
      saveLanguages({
        userId: "user-123",
        nativeLanguage: "ko",
        learningLanguages: ["en"],
      }),
    );

    const state = store.getState().language;
    // User should NOT be sent back to onboarding
    expect(state.onboardingComplete).toBe(true);
    expect(state.nativeLanguage).toBe("ko");
    expect(state.learningLanguages).toEqual(["en"]);
    expect(state.error).toBe("Server error");
    expect(state.loading).toBe(false);
  });

  it("multiple language values beyond defaults are handled correctly", async () => {
    mockFetchUserLanguages.mockResolvedValue({
      native_language: "zh",
      target_language: "en",
      learning_languages: ["en"],
    });

    await store.dispatch(loadLanguages("user-123"));

    const state = store.getState().language;
    // zh native with en learning is non-default -> onboarding complete
    expect(state.onboardingComplete).toBe(true);
    expect(state.nativeLanguage).toBe("zh");
  });

  it("loading sets loading flag to true while pending", () => {
    // Make fetch hang
    mockFetchUserLanguages.mockReturnValue(new Promise(() => {}));

    store.dispatch(loadLanguages("user-123"));

    const state = store.getState().language;
    expect(state.loading).toBe(true);
    expect(state.loaded).toBe(false);
  });
});
