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
    console.log("[language] loading languages for user:", userId);
    try {
      const data = await fetchUserLanguages(userId);
      console.log("[language] loaded:", JSON.stringify(data));
      return data;
    } catch (err) {
      console.error("[language] load failed:", err);
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
    console.log("[language] saving:", { userId, nativeLanguage, learningLanguages });
    try {
      await updateUserLanguages(userId, nativeLanguage, learningLanguages);
      console.log("[language] saved successfully");
      return { nativeLanguage, learningLanguages };
    } catch (err) {
      console.error("[language] save failed:", err);
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
        console.log("[language] load rejected, showing onboarding. Error:", action.error.message);
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
        console.log("[language] saved to server successfully");
      })
      .addCase(saveLanguages.rejected, (state, action) => {
        state.loading = false;
        // Keep onboardingComplete = true — don't send user back to onboarding
        // The save will be retried next time the app opens
        state.error = action.error.message ?? "Failed to save languages";
        console.warn("[language] save failed, will retry later:", action.error.message);
      });
  },
});

export const { setActiveLearningLanguage } = languageSlice.actions;
export default languageSlice.reducer;
