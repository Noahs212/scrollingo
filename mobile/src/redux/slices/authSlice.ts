import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { supabase } from "../../lib/supabase";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  signOut,
} from "../../services/auth";
import { getUserById } from "../../services/user";
import { getPostsByUser } from "./postSlice";
import { User } from "../../../types";

/**
 * Creates a minimal User from Supabase auth metadata.
 * Used as a fallback when the DB profile hasn't loaded yet.
 */
function mapSupabaseUser(
  supaUser: { id: string; email?: string; user_metadata?: Record<string, any> },
): User {
  return {
    uid: supaUser.id,
    email: supaUser.email ?? "",
    displayName: supaUser.user_metadata?.full_name ?? supaUser.user_metadata?.name ?? null,
    photoURL: supaUser.user_metadata?.avatar_url || supaUser.user_metadata?.picture || undefined,
    followingCount: 0,
    followersCount: 0,
    likesCount: 0,
    nativeLanguage: "en",
    targetLanguage: "en",
    learningLanguages: ["en"],
    streakDays: 0,
    longestStreak: 0,
    totalWordsLearned: 0,
    totalVideosWatched: 0,
    dailyGoalMinutes: 10,
    premium: false,
  };
}

/**
 * Loads the full user profile from the database.
 * Falls back to auth metadata if DB fetch fails (network issues on simulator).
 */
async function loadFullProfile(
  supaUser: { id: string; email?: string; user_metadata?: Record<string, any> },
): Promise<User> {
  try {
    const dbUser = await getUserById(supaUser.id);
    if (dbUser) {
      // Merge: DB data + email from auth (email not stored in users table)
      return { ...dbUser, email: supaUser.email ?? dbUser.email };
    }
  } catch (err) {
  }
  return mapSupabaseUser(supaUser);
}

export const userAuthStateListener = createAsyncThunk(
  "auth/userAuthStateListener",
  async (_, { dispatch }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      // Set immediately with auth metadata, then enhance with DB data
      dispatch(setUserState({ currentUser: mapSupabaseUser(session.user), loaded: true }));
      dispatch(getPostsByUser(session.user.id));
      // Load full profile in background
      const fullUser = await loadFullProfile(session.user);
      dispatch(setUserState({ currentUser: fullUser, loaded: true }));
    } else {
      dispatch(setUserState({ currentUser: null, loaded: true }));
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        dispatch(setUserState({ currentUser: mapSupabaseUser(session.user), loaded: true }));
        dispatch(getPostsByUser(session.user.id));
        const fullUser = await loadFullProfile(session.user);
        dispatch(setUserState({ currentUser: fullUser, loaded: true }));
      } else {
        dispatch(setUserState({ currentUser: null, loaded: true }));
      }
    });
  },
);

export const login = createAsyncThunk(
  "auth/login",
  async ({ email, password }: { email: string; password: string }) => {
    await signInWithEmail(email, password);
  },
);

export const register = createAsyncThunk(
  "auth/register",
  async ({ email, password }: { email: string; password: string }) => {
    await signUpWithEmail(email, password);
  },
);

export const loginWithGoogle = createAsyncThunk(
  "auth/loginWithGoogle",
  async () => {
    await signInWithGoogle();
  },
);

export const loginWithApple = createAsyncThunk(
  "auth/loginWithApple",
  async () => {
    await signInWithApple();
  },
);

export const logout = createAsyncThunk(
  "auth/logout",
  async () => {
    await signOut();
  },
);

interface AuthState {
  currentUser: User | null;
  loaded: boolean;
  error: string | null;
}

const initialState: AuthState = {
  currentUser: null,
  loaded: false,
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUserState: (state, action) => {
      state.currentUser = action.payload.currentUser;
      state.loaded = action.payload.loaded;
    },
    updateUserField: (state, action: PayloadAction<{ field: string; value: any }>) => {
      if (state.currentUser) {
        (state.currentUser as any)[action.payload.field] = action.payload.value;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.rejected, (state, action) => {
        state.error = action.error.message ?? "Login failed";
      })
      .addCase(login.fulfilled, (state) => {
        state.error = null;
      })
      .addCase(register.rejected, (state, action) => {
        state.error = action.error.message ?? "Registration failed";
      })
      .addCase(register.fulfilled, (state) => {
        state.error = null;
      })
      .addCase(loginWithGoogle.rejected, (state, action) => {
        state.error = action.error.message ?? "Google sign-in failed";
      })
      .addCase(loginWithGoogle.fulfilled, (state) => {
        state.error = null;
      })
      .addCase(loginWithApple.rejected, (state, action) => {
        state.error = action.error.message ?? "Apple sign-in failed";
      })
      .addCase(loginWithApple.fulfilled, (state) => {
        state.error = null;
      })
      .addCase(logout.fulfilled, (state) => {
        state.currentUser = null;
        state.error = null;
      });
  },
});

export const { setUserState, updateUserField } = authSlice.actions;
export default authSlice.reducer;
