import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { FIREBASE_AUTH, MOCK_CURRENT_USER } from "../../../firebaseConfig";
import { getPostsByUser } from "./postSlice";
import { User } from "../../../types";

export const userAuthStateListener = createAsyncThunk(
  "auth/userAuthStateListener",
  async (_, { dispatch }) => {
    FIREBASE_AUTH.onAuthStateChanged((user) => {
      if (user) {
        dispatch(getCurrentUserData());
        dispatch(getPostsByUser(user.uid));
      } else {
        dispatch(setUserState({ currentUser: null, loaded: true }));
      }
    });
  },
);

export const getCurrentUserData = createAsyncThunk(
  "auth/getCurrentUserData",
  async (_, { dispatch }) => {
    if (FIREBASE_AUTH.currentUser) {
      // Mock: immediately set the current user data
      const mockUser: User = {
        uid: MOCK_CURRENT_USER.uid,
        email: MOCK_CURRENT_USER.email,
        displayName: MOCK_CURRENT_USER.displayName,
        photoURL: MOCK_CURRENT_USER.photoURL ?? undefined,
        followingCount: 12,
        followersCount: 48,
        likesCount: 156,
      };
      dispatch(setUserState({ currentUser: mockUser, loaded: true }));
    }
  },
);

export const login = createAsyncThunk(
  "auth/login",
  async (_payload: { email: string; password: string }, { dispatch }) => {
    // Mock: auto-login with mock user
    FIREBASE_AUTH.currentUser = { ...MOCK_CURRENT_USER };
    dispatch(getCurrentUserData());
    dispatch(getPostsByUser(MOCK_CURRENT_USER.uid));
  },
);

export const register = createAsyncThunk(
  "auth/register",
  async (_payload: { email: string; password: string }, { dispatch }) => {
    // Mock: auto-register and login
    FIREBASE_AUTH.currentUser = { ...MOCK_CURRENT_USER };
    dispatch(getCurrentUserData());
    dispatch(getPostsByUser(MOCK_CURRENT_USER.uid));
  },
);

interface AuthState {
  currentUser: User | null;
  loaded: boolean;
}

const initialState: AuthState = {
  currentUser: null,
  loaded: false,
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
  extraReducers: (_builder) => {},
});

export const { setUserState } = authSlice.actions;
export default authSlice.reducer;
