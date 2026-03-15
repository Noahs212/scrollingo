/**
 * Integration tests for Auth + Profile flow.
 *
 * Tests that after authentication, the full user profile loads from DB
 * (not just auth metadata), and that the User type has all expected fields.
 */

// --- Mocks must come before any imports that use the mocked modules ---

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn().mockReturnValue({
  data: { subscription: { unsubscribe: jest.fn() } },
});

jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: "user-123",
            email: "test@example.com",
          },
        },
      }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
    }),
  },
}));

const mockGetUserById = jest.fn();
jest.mock("../../services/user", () => ({
  getUserById: (...args: any[]) => mockGetUserById(...args),
  saveUserField: jest.fn().mockResolvedValue(undefined),
  saveUserProfileImage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/auth", () => ({
  signInWithEmail: jest.fn().mockResolvedValue({}),
  signUpWithEmail: jest.fn().mockResolvedValue({}),
  signInWithGoogle: jest.fn().mockResolvedValue({}),
  signInWithApple: jest.fn().mockResolvedValue({}),
  signOut: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/language", () => ({
  fetchUserLanguages: jest.fn().mockResolvedValue({
    native_language: "en",
    target_language: "en",
    learning_languages: ["en"],
  }),
  updateUserLanguages: jest.fn(),
  LEARNING_LANGUAGES: [],
  NATIVE_LANGUAGES: [],
}));

jest.mock("../../services/posts", () => ({
  getPostsByUserId: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../services/utils", () => ({
  saveMediaToStorage: jest.fn(),
}));

import { configureStore } from "@reduxjs/toolkit";
import authReducer, { userAuthStateListener } from "../../redux/slices/authSlice";
import postReducer from "../../redux/slices/postSlice";
import modalReducer from "../../redux/slices/modalSlice";
import chatReducer from "../../redux/slices/chatSlice";
import languageReducer from "../../redux/slices/languageSlice";
import { User } from "../../../types";

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

const fullDbUser: User = {
  uid: "user-123",
  email: "test@example.com",
  displayName: "Full Profile Name",
  photoURL: "https://cdn.example.com/avatar.jpg",
  followingCount: 15,
  followersCount: 42,
  likesCount: 200,
  nativeLanguage: "es",
  targetLanguage: "en",
  learningLanguages: ["en", "zh"],
  streakDays: 30,
  longestStreak: 45,
  totalWordsLearned: 500,
  totalVideosWatched: 120,
  dailyGoalMinutes: 20,
  premium: true,
};

describe("Auth + Profile Integration", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = createTestStore();
  });

  it("after auth, full user profile loads from DB (not just auth metadata)", async () => {
    // Simulate a session with minimal auth metadata
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "user-123",
            email: "test@example.com",
            user_metadata: {
              full_name: "Auth Only Name",
              avatar_url: "https://auth-avatar.com/pic.jpg",
            },
          },
        },
      },
    });

    // DB returns full profile
    mockGetUserById.mockResolvedValue(fullDbUser);

    await store.dispatch(userAuthStateListener());

    const state = store.getState().auth;
    expect(state.loaded).toBe(true);

    const user = state.currentUser;
    expect(user).not.toBeNull();

    // Should have DB values, not just auth metadata
    expect(user?.displayName).toBe("Full Profile Name");
    expect(user?.photoURL).toBe("https://cdn.example.com/avatar.jpg");
    expect(user?.followingCount).toBe(15);
    expect(user?.followersCount).toBe(42);
    expect(user?.nativeLanguage).toBe("es");
    expect(user?.learningLanguages).toEqual(["en", "zh"]);
    expect(user?.streakDays).toBe(30);
    expect(user?.dailyGoalMinutes).toBe(20);
    expect(user?.premium).toBe(true);

    // Email should come from auth (merged), not DB
    expect(user?.email).toBe("test@example.com");
  });

  it("User type has all required fields (language, streak, dailyGoalMinutes, etc.)", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "user-123",
            email: "test@example.com",
            user_metadata: {},
          },
        },
      },
    });

    mockGetUserById.mockResolvedValue(fullDbUser);

    await store.dispatch(userAuthStateListener());

    const user = store.getState().auth.currentUser;
    expect(user).not.toBeNull();

    // Verify ALL User type fields are present
    const requiredFields: (keyof User)[] = [
      "uid",
      "email",
      "displayName",
      "followingCount",
      "followersCount",
      "likesCount",
      "nativeLanguage",
      "targetLanguage",
      "learningLanguages",
      "streakDays",
      "longestStreak",
      "totalWordsLearned",
      "totalVideosWatched",
      "dailyGoalMinutes",
      "premium",
    ];

    for (const field of requiredFields) {
      expect(user).toHaveProperty(field);
      expect((user as any)[field]).toBeDefined();
    }
  });

  it("falls back to auth metadata when DB profile fetch fails", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "user-456",
            email: "fallback@test.com",
            user_metadata: {
              full_name: "Auth Fallback",
              avatar_url: "https://auth.com/pic.jpg",
            },
          },
        },
      },
    });

    // DB fetch fails
    mockGetUserById.mockRejectedValue(new Error("Network error"));

    await store.dispatch(userAuthStateListener());

    const user = store.getState().auth.currentUser;
    expect(user).not.toBeNull();
    expect(user?.uid).toBe("user-456");
    expect(user?.email).toBe("fallback@test.com");
    expect(user?.displayName).toBe("Auth Fallback");

    // Fallback defaults from mapSupabaseUser
    expect(user?.followingCount).toBe(0);
    expect(user?.followersCount).toBe(0);
    expect(user?.nativeLanguage).toBe("en");
    expect(user?.dailyGoalMinutes).toBe(10);
    expect(user?.premium).toBe(false);
  });

  it("sets loaded=true and user=null when no session exists", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await store.dispatch(userAuthStateListener());

    const state = store.getState().auth;
    expect(state.loaded).toBe(true);
    expect(state.currentUser).toBeNull();
  });

  it("auth state change callback loads full profile for new sign-in", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    let authChangeCallback: Function;
    mockOnAuthStateChange.mockImplementation((cb: Function) => {
      authChangeCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    await store.dispatch(userAuthStateListener());
    expect(store.getState().auth.currentUser).toBeNull();

    // Set up DB mock for new user
    mockGetUserById.mockResolvedValue({
      ...fullDbUser,
      uid: "new-user-789",
      displayName: "Newly Signed In",
    });

    // Simulate auth state change (sign in)
    await authChangeCallback!("SIGNED_IN", {
      user: {
        id: "new-user-789",
        email: "new@test.com",
        user_metadata: { full_name: "Auth Name" },
      },
    });

    const user = store.getState().auth.currentUser;
    expect(user).not.toBeNull();
    // Should eventually have the DB profile name, not auth metadata
    // (The last dispatch wins - the full profile loads after the initial auth-only set)
    expect(user?.displayName).toBe("Newly Signed In");
  });
});
