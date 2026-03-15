import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { fetchUserLanguages, updateUserLanguages } from "../../services/language";

interface LanguageState {
  nativeLanguage: string | null;
  learningLanguages: string[];
  activeLearningLanguage: string | null;
  onboardingComplete: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: LanguageState = {
  nativeLanguage: null,
  learningLanguages: [],
  activeLearningLanguage: null,
  onboardingComplete: false,
  loaded: false,
  loading: false,
  error: null,
};

export const loadLanguages = createAsyncThunk(
  "language/load",
  async (userId: string) => {
    try {
      const data = await fetchUserLanguages(userId);
      return data;
    } catch (err) {
      throw err;
    }
  },
);

export const saveLanguages = createAsyncThunk(
  "language/save",
  async ({
    userId,
    nativeLanguage,
    learningLanguages,
  }: {
    userId: string;
    nativeLanguage: string;
    learningLanguages: string[];
  }) => {
    try {
      await updateUserLanguages(userId, nativeLanguage, learningLanguages);
      return { nativeLanguage, learningLanguages };
    } catch (err) {
      throw err;
    }
  },
);

const languageSlice = createSlice({
  name: "language",
  initialState,
  reducers: {
    setActiveLearningLanguage: (state, action: PayloadAction<string>) => {
      state.activeLearningLanguage = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadLanguages.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadLanguages.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.error = null;
        const { native_language, target_language, learning_languages } = action.payload;
        state.nativeLanguage = native_language;
        state.learningLanguages = learning_languages;
        state.activeLearningLanguage = target_language;
        // Onboarding is complete if user has set languages beyond the defaults
        state.onboardingComplete =
          native_language != null &&
          learning_languages != null &&
          learning_languages.length > 0 &&
          !(native_language === "en" && learning_languages.length === 1 && learning_languages[0] === "en");
      })
      .addCase(loadLanguages.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.onboardingComplete = false; // Show onboarding on failure — user can set languages
        state.error = action.error.message ?? "Failed to load languages";
      })
      .addCase(saveLanguages.pending, (state, action) => {
        state.loading = true;
        // Optimistically update — navigate to home immediately
        const { nativeLanguage, learningLanguages } = action.meta.arg;
        state.nativeLanguage = nativeLanguage;
        state.learningLanguages = learningLanguages;
        state.activeLearningLanguage = learningLanguages[0];
        state.onboardingComplete = true;
      })
      .addCase(saveLanguages.fulfilled, (state) => {
        state.loading = false;
        state.error = null;
      })
      .addCase(saveLanguages.rejected, (state, action) => {
        state.loading = false;
        // Keep onboardingComplete = true — don't send user back to onboarding
        // The save will be retried next time the app opens
        state.error = action.error.message ?? "Failed to save languages";
      });
  },
});

export const { setActiveLearningLanguage } = languageSlice.actions;
export default languageSlice.reducer;
