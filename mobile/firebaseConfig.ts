/**
 * Mock backend config — placeholder until Supabase (or other provider) is integrated.
 *
 * This file exports the same shape the rest of the app expects
 * so all existing imports continue to work.
 */

export const MOCK_USER_UID = "mock-user-001";

export const MOCK_CURRENT_USER = {
  uid: MOCK_USER_UID,
  email: "demo@scrollingo.app",
  displayName: "Demo User",
  photoURL: null as string | null,
};

/**
 * Minimal mock that mirrors the subset of Firebase Auth the app uses.
 * Replace with your real auth provider later.
 */
export const FIREBASE_AUTH = {
  currentUser: { ...MOCK_CURRENT_USER } as typeof MOCK_CURRENT_USER | null,
  onAuthStateChanged(callback: (user: typeof MOCK_CURRENT_USER | null) => void) {
    // Immediately fire with mock user (simulates "already signed in")
    setTimeout(() => callback(MOCK_CURRENT_USER), 100);
    return () => {}; // unsubscribe
  },
};

// These are no-ops — service files no longer use them directly
export const FIREBASE_DB = null;
export const FIREBASE_STORAGE = null;
export const FIREBASE_APP = null;
