import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { supabase } from "../../lib/supabase";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  signOut,
} from "../../services/auth";
import { getPostsByUser } from "./postSlice";
import { User } from "../../../types";

function mapSupabaseUser(
  supaUser: { id: string; email?: string; user_metadata?: Record<string, any> },
): User {
  return {
    uid: supaUser.id,
    email: supaUser.email ?? "",
    displayName: supaUser.user_metadata?.full_name ?? supaUser.user_metadata?.name ?? null,
    photoURL: supaUser.user_metadata?.avatar_url ?? supaUser.user_metadata?.picture,
    followingCount: 0,
    followersCount: 0,
    likesCount: 0,
  };
}

export const userAuthStateListener = createAsyncThunk(
  "auth/userAuthStateListener",
  async (_, { dispatch }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      dispatch(setUserState({ currentUser: mapSupabaseUser(session.user), loaded: true }));
      dispatch(getPostsByUser(session.user.id));
    } else {
      dispatch(setUserState({ currentUser: null, loaded: true }));
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        dispatch(setUserState({ currentUser: mapSupabaseUser(session.user), loaded: true }));
        dispatch(getPostsByUser(session.user.id));
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

export const { setUserState } = authSlice.actions;
export default authSlice.reducer;
