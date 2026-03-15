import { configureStore } from "@reduxjs/toolkit";
import authReducer, {
  login,
  register,
  logout,
  userAuthStateListener,
  setUserState,
} from "../authSlice";

// Mock supabase
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn().mockReturnValue({
  data: { subscription: { unsubscribe: jest.fn() } },
});

jest.mock("../../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
      onAuthStateChange: (...args: any[]) => mockOnAuthStateChange(...args),
    },
  },
}));

// Mock auth service
const mockSignInWithEmail = jest.fn();
const mockSignUpWithEmail = jest.fn();
const mockSignOut = jest.fn();

jest.mock("../../../services/auth", () => ({
  signInWithEmail: (...args: any[]) => mockSignInWithEmail(...args),
  signUpWithEmail: (...args: any[]) => mockSignUpWithEmail(...args),
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  signOut: (...args: any[]) => mockSignOut(...args),
}));

// Mock posts
jest.mock("../../../services/posts", () => ({
  getPostsByUserId: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../../services/utils", () => ({
  saveMediaToStorage: jest.fn(),
}));

function createTestStore() {
  return configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
}

describe("authSlice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Initial State ---

  it("has correct initial state", () => {
    const store = createTestStore();
    expect(store.getState().auth).toEqual({
      currentUser: null,
      loaded: false,
      error: null,
    });
  });

  // --- setUserState reducer ---

  it("sets user and loaded via setUserState", () => {
    const store = createTestStore();
    const mockUser = {
      uid: "user-1",
      email: "test@example.com",
      displayName: "Test User",
      followingCount: 0,
      followersCount: 0,
      likesCount: 0,
    };

    store.dispatch(setUserState({ currentUser: mockUser, loaded: true }));

    expect(store.getState().auth.currentUser).toEqual(mockUser);
    expect(store.getState().auth.loaded).toBe(true);
  });

  it("clears user via setUserState", () => {
    const store = createTestStore();

    store.dispatch(setUserState({ currentUser: { uid: "1", email: "a@b.com", displayName: null, followingCount: 0, followersCount: 0, likesCount: 0 }, loaded: true }));
    store.dispatch(setUserState({ currentUser: null, loaded: true }));

    expect(store.getState().auth.currentUser).toBeNull();
    expect(store.getState().auth.loaded).toBe(true);
  });

  // --- login thunk ---

  it("calls signInWithEmail on login", async () => {
    mockSignInWithEmail.mockResolvedValue({ user: { id: "1" }, session: {} });
    const store = createTestStore();

    await store.dispatch(login({ email: "test@test.com", password: "pass123" }));

    expect(mockSignInWithEmail).toHaveBeenCalledWith("test@test.com", "pass123");
  });

  it("sets error when login fails", async () => {
    mockSignInWithEmail.mockRejectedValue(new Error("Invalid login credentials"));
    const store = createTestStore();

    await store.dispatch(login({ email: "test@test.com", password: "wrong" }));

    expect(store.getState().auth.error).toBe("Invalid login credentials");
  });

  it("clears error when login succeeds", async () => {
    const store = createTestStore();

    // First fail
    mockSignInWithEmail.mockRejectedValueOnce(new Error("bad"));
    await store.dispatch(login({ email: "a@b.com", password: "x" }));
    expect(store.getState().auth.error).toBe("bad");

    // Then succeed
    mockSignInWithEmail.mockResolvedValueOnce({});
    await store.dispatch(login({ email: "a@b.com", password: "correct" }));
    expect(store.getState().auth.error).toBeNull();
  });

  // --- register thunk ---

  it("calls signUpWithEmail on register", async () => {
    mockSignUpWithEmail.mockResolvedValue({ user: { id: "2" }, session: {} });
    const store = createTestStore();

    await store.dispatch(register({ email: "new@test.com", password: "newpass" }));

    expect(mockSignUpWithEmail).toHaveBeenCalledWith("new@test.com", "newpass");
  });

  it("sets error when register fails", async () => {
    mockSignUpWithEmail.mockRejectedValue(new Error("User already registered"));
    const store = createTestStore();

    await store.dispatch(register({ email: "exists@test.com", password: "pass" }));

    expect(store.getState().auth.error).toBe("User already registered");
  });

  it("clears error when register succeeds", async () => {
    const store = createTestStore();

    mockSignUpWithEmail.mockRejectedValueOnce(new Error("fail"));
    await store.dispatch(register({ email: "a@b.com", password: "x" }));
    expect(store.getState().auth.error).toBe("fail");

    mockSignUpWithEmail.mockResolvedValueOnce({});
    await store.dispatch(register({ email: "a@b.com", password: "x" }));
    expect(store.getState().auth.error).toBeNull();
  });

  // --- logout thunk ---

  it("clears currentUser on logout", async () => {
    mockSignOut.mockResolvedValue(undefined);
    const store = createTestStore();

    // Set a user first
    store.dispatch(setUserState({
      currentUser: { uid: "1", email: "a@b.com", displayName: "User", followingCount: 0, followersCount: 0, likesCount: 0 },
      loaded: true,
    }));
    expect(store.getState().auth.currentUser).not.toBeNull();

    await store.dispatch(logout());

    expect(store.getState().auth.currentUser).toBeNull();
    expect(store.getState().auth.error).toBeNull();
  });

  it("calls signOut service on logout", async () => {
    mockSignOut.mockResolvedValue(undefined);
    const store = createTestStore();

    await store.dispatch(logout());

    expect(mockSignOut).toHaveBeenCalled();
  });

  // --- userAuthStateListener thunk ---

  it("sets user when session exists on init", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "supa-user-1",
            email: "supa@test.com",
            user_metadata: { full_name: "Supa User", avatar_url: "https://img.com/pic.jpg" },
          },
        },
      },
    });
    const store = createTestStore();

    await store.dispatch(userAuthStateListener());

    const state = store.getState().auth;
    expect(state.loaded).toBe(true);
    expect(state.currentUser).toMatchObject({
      uid: "supa-user-1",
      email: "supa@test.com",
      displayName: "Supa User",
      photoURL: "https://img.com/pic.jpg",
      followingCount: 0,
      followersCount: 0,
      likesCount: 0,
    });
  });

  it("sets loaded with null user when no session exists", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const store = createTestStore();

    await store.dispatch(userAuthStateListener());

    const state = store.getState().auth;
    expect(state.loaded).toBe(true);
    expect(state.currentUser).toBeNull();
  });

  it("registers onAuthStateChange listener", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const store = createTestStore();

    await store.dispatch(userAuthStateListener());

    expect(mockOnAuthStateChange).toHaveBeenCalled();
  });

  it("handles auth state change to signed in", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    let authChangeCallback: Function;
    mockOnAuthStateChange.mockImplementation((cb: Function) => {
      authChangeCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    const store = createTestStore();
    await store.dispatch(userAuthStateListener());

    // Initially no user
    expect(store.getState().auth.currentUser).toBeNull();

    // Simulate auth state change
    authChangeCallback!("SIGNED_IN", {
      user: {
        id: "new-user",
        email: "new@test.com",
        user_metadata: { name: "New User" },
      },
    });

    expect(store.getState().auth.currentUser?.uid).toBe("new-user");
    expect(store.getState().auth.currentUser?.displayName).toBe("New User");
  });

  it("handles auth state change to signed out", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: "user-1", email: "test@test.com", user_metadata: {} },
        },
      },
    });
    let authChangeCallback: Function;
    mockOnAuthStateChange.mockImplementation((cb: Function) => {
      authChangeCallback = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    const store = createTestStore();
    await store.dispatch(userAuthStateListener());

    // User is signed in
    expect(store.getState().auth.currentUser).not.toBeNull();

    // Simulate sign out
    authChangeCallback!("SIGNED_OUT", null);

    expect(store.getState().auth.currentUser).toBeNull();
  });
});
