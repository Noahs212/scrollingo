import { configureStore } from "@reduxjs/toolkit";
import languageSlice, {
  loadLanguages,
  saveLanguages,
  setActiveLearningLanguage,
} from "../languageSlice";
import { fetchUserLanguages, updateUserLanguages } from "../../../services/language";

jest.mock("../../../services/language", () => ({
  fetchUserLanguages: jest.fn(),
  updateUserLanguages: jest.fn(),
  LEARNING_LANGUAGES: [
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "zh", name: "Chinese", flag: "🇨🇳" },
  ],
  NATIVE_LANGUAGES: [
    { code: "en", name: "English", flag: "🇺🇸" },
    { code: "es", name: "Spanish", flag: "🇪🇸" },
  ],
}));

function createTestStore() {
  return configureStore({ reducer: { language: languageSlice } });
}

describe("languageSlice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("initial state", () => {
    it("starts with null languages and onboarding not complete", () => {
      const store = createTestStore();
      const state = store.getState().language;
      expect(state.nativeLanguage).toBeNull();
      expect(state.learningLanguages).toEqual([]);
      expect(state.onboardingComplete).toBe(false);
      expect(state.loaded).toBe(false);
      expect(state.loading).toBe(false);
    });
  });

  describe("loadLanguages", () => {
    it("marks onboarding complete when languages are set beyond defaults", async () => {
      (fetchUserLanguages as jest.Mock).mockResolvedValue({
        native_language: "es",
        target_language: "en",
        learning_languages: ["en"],
      });

      const store = createTestStore();
      await store.dispatch(loadLanguages("user-123"));

      const state = store.getState().language;
      expect(state.loaded).toBe(true);
      expect(state.nativeLanguage).toBe("es");
      expect(state.learningLanguages).toEqual(["en"]);
      expect(state.activeLearningLanguage).toBe("en");
      expect(state.onboardingComplete).toBe(true);
    });

    it("marks onboarding NOT complete when languages are still defaults", async () => {
      (fetchUserLanguages as jest.Mock).mockResolvedValue({
        native_language: "en",
        target_language: "en",
        learning_languages: ["en"],
      });

      const store = createTestStore();
      await store.dispatch(loadLanguages("user-123"));

      const state = store.getState().language;
      expect(state.loaded).toBe(true);
      expect(state.onboardingComplete).toBe(false);
    });

    it("handles fetch failure gracefully", async () => {
      (fetchUserLanguages as jest.Mock).mockRejectedValue(
        new Error("Network request failed"),
      );

      const store = createTestStore();
      await store.dispatch(loadLanguages("user-123"));

      const state = store.getState().language;
      expect(state.loaded).toBe(true);
      expect(state.onboardingComplete).toBe(false);
      expect(state.error).toBe("Network request failed");
    });
  });

  describe("saveLanguages", () => {
    it("optimistically updates state on pending", async () => {
      // Make updateUserLanguages hang so we can check pending state
      (updateUserLanguages as jest.Mock).mockReturnValue(new Promise(() => {}));

      const store = createTestStore();
      store.dispatch(
        saveLanguages({
          userId: "user-123",
          nativeLanguage: "es",
          learningLanguages: ["en", "zh"],
        }),
      );

      // Check optimistic update happened immediately
      const state = store.getState().language;
      expect(state.nativeLanguage).toBe("es");
      expect(state.learningLanguages).toEqual(["en", "zh"]);
      expect(state.activeLearningLanguage).toBe("en");
      expect(state.onboardingComplete).toBe(true);
    });

    it("clears error on successful save", async () => {
      (updateUserLanguages as jest.Mock).mockResolvedValue(undefined);

      const store = createTestStore();
      await store.dispatch(
        saveLanguages({
          userId: "user-123",
          nativeLanguage: "es",
          learningLanguages: ["zh"],
        }),
      );

      const state = store.getState().language;
      expect(state.error).toBeNull();
      expect(state.loading).toBe(false);
    });

    it("keeps onboardingComplete true even if save fails", async () => {
      (updateUserLanguages as jest.Mock).mockRejectedValue(
        new Error("Network error"),
      );

      const store = createTestStore();
      await store.dispatch(
        saveLanguages({
          userId: "user-123",
          nativeLanguage: "es",
          learningLanguages: ["en"],
        }),
      );

      const state = store.getState().language;
      expect(state.onboardingComplete).toBe(true); // Not reverted
      expect(state.error).toBe("Network error");
    });
  });

  describe("setActiveLearningLanguage", () => {
    it("updates the active learning language", () => {
      const store = createTestStore();
      store.dispatch(setActiveLearningLanguage("zh"));
      expect(store.getState().language.activeLearningLanguage).toBe("zh");
    });
  });
});
