jest.unmock("react-redux");

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureStore } from "@reduxjs/toolkit";
import { Alert } from "react-native";
import authSlice from "../../../redux/slices/authSlice";
import languageSlice from "../../../redux/slices/languageSlice";
import postSlice from "../../../redux/slices/postSlice";
import modalSlice from "../../../redux/slices/modalSlice";
import chatSlice from "../../../redux/slices/chatSlice";

const mockFetchAll = jest.fn().mockResolvedValue([]);
const mockDeleteFlashcard = jest.fn().mockResolvedValue(undefined);
const mockToggleStarred = jest.fn().mockResolvedValue(undefined);

jest.mock("../../../lib/supabase", () => ({
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    })),
  },
}));

jest.mock("../../../services/flashcards", () => ({
  fetchAllFlashcards: (...args: any[]) => mockFetchAll(...args),
  deleteFlashcard: (...args: any[]) => mockDeleteFlashcard(...args),
  toggleStarred: (...args: any[]) => mockToggleStarred(...args),
  fetchDueFlashcards: jest.fn().mockResolvedValue([]),
  fetchFlashcardCount: jest.fn().mockResolvedValue(0),
  saveFlashcard: jest.fn(),
  updateFlashcardAfterReview: jest.fn(),
  logReview: jest.fn(),
}));

jest.mock("expo-speech", () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));
jest.mock("ts-fsrs", () => ({
  fsrs: () => ({ repeat: jest.fn() }),
  createEmptyCard: jest.fn(() => ({})),
  Rating: { Again: 1, Hard: 2, Good: 3, Easy: 4 },
  State: { New: 0, Learning: 1, Review: 2, Relearning: 3 },
}));

import VocabList from "../VocabList";
import { Flashcard } from "../../../../types";

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "card-1",
    user_id: "user-1",
    vocab_word_id: "v1",
    definition_id: "d1",
    source_video_id: "vid1",
    state: 0,
    stability: 0,
    difficulty: 0,
    due: new Date().toISOString(),
    last_review_at: null,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    starred: false,
    word: "好",
    pinyin: "hǎo",
    translation: "good",
    contextual_definition: "fine",
    part_of_speech: "adj",
    language: "zh",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function createStore() {
  return configureStore({
    reducer: {
      auth: authSlice,
      language: languageSlice,
      post: postSlice,
      modal: modalSlice,
      chat: chatSlice,
    },
    preloadedState: {
      language: {
        nativeLanguage: "en",
        learningLanguages: ["zh"],
        activeLearningLanguage: "zh",
        isLoaded: true,
        onboardingComplete: true,
      },
      auth: {
        currentUser: {
          uid: "user-1",
          email: "t@t.com",
          displayName: "T",
          followingCount: 0,
          followersCount: 0,
          likesCount: 0,
          nativeLanguage: "en",
          targetLanguage: "zh",
          learningLanguages: ["zh"],
          streakDays: 0,
          longestStreak: 0,
          totalWordsLearned: 0,
          totalVideosWatched: 0,
          dailyGoalMinutes: 10,
          maxReviewsPerDay: 20,
          premium: false,
        },
      },
    },
    middleware: (m) => m({ serializableCheck: false }),
  });
}

function renderVocab(onBack = jest.fn()) {
  const store = createStore();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <VocabList onBack={onBack} />
      </QueryClientProvider>
    </Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchAll.mockResolvedValue([]);
});

describe("VocabList — empty state", () => {
  it("shows empty message when no saved words", async () => {
    renderVocab();
    expect(await screen.findByText("No saved words")).toBeTruthy();
  });

  it("shows header with title and count 0", async () => {
    renderVocab();
    expect(await screen.findByText("Saved Words")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });
});

describe("VocabList — with cards", () => {
  const cards = [
    makeCard({ id: "c1", word: "好", pinyin: "hǎo", translation: "good", starred: false, state: 0, reps: 0 }),
    makeCard({ id: "c2", word: "累", pinyin: "lèi", translation: "tired", starred: true, state: 2, reps: 5 }),
    makeCard({ id: "c3", word: "行", pinyin: "xíng", translation: "okay", starred: false, state: 1, reps: 2 }),
  ];

  beforeEach(() => {
    mockFetchAll.mockResolvedValue(cards);
  });

  it("renders all words", async () => {
    renderVocab();
    expect(await screen.findByText("好")).toBeTruthy();
    expect(screen.getByText("累")).toBeTruthy();
    expect(screen.getByText("行")).toBeTruthy();
  });

  it("shows pinyin for each word", async () => {
    renderVocab();
    expect(await screen.findByText("hǎo")).toBeTruthy();
    expect(screen.getByText("lèi")).toBeTruthy();
    expect(screen.getByText("xíng")).toBeTruthy();
  });

  it("shows translations", async () => {
    renderVocab();
    expect(await screen.findByText("good")).toBeTruthy();
    expect(screen.getByText("tired")).toBeTruthy();
    expect(screen.getByText("okay")).toBeTruthy();
  });

  it("shows FSRS state badges", async () => {
    renderVocab();
    expect(await screen.findByText("New")).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText("Learning")).toBeTruthy();
  });

  it("shows review count for reviewed cards", async () => {
    renderVocab();
    expect(await screen.findByText("5 reviews")).toBeTruthy();
    expect(screen.getByText("2 reviews")).toBeTruthy();
  });

  it("shows total count in header", async () => {
    renderVocab();
    expect(await screen.findByText("3")).toBeTruthy();
  });

  it("shows filter tabs with counts", async () => {
    renderVocab();
    expect(await screen.findByText("All (3)")).toBeTruthy();
    expect(screen.getByText(/Starred \(1\)/)).toBeTruthy();
  });

  it("filters to starred only when Starred tab pressed", async () => {
    renderVocab();
    await screen.findByText("好");

    fireEvent.press(screen.getByText(/Starred \(1\)/));

    // Only the starred card should be visible
    expect(screen.getByText("累")).toBeTruthy();
    expect(screen.queryByText("好")).toBeNull();
    expect(screen.queryByText("行")).toBeNull();
  });

  it("shows empty starred message when no starred cards", async () => {
    mockFetchAll.mockResolvedValue([
      makeCard({ id: "c1", starred: false }),
    ]);
    renderVocab();
    await screen.findByText("好");

    fireEvent.press(screen.getByText(/Starred \(0\)/));

    expect(await screen.findByText("No starred words")).toBeTruthy();
  });
});

describe("VocabList — star toggle", () => {
  it("calls toggleStarred when star icon pressed", async () => {
    mockFetchAll.mockResolvedValue([
      makeCard({ id: "c1", starred: false }),
    ]);
    renderVocab();
    await screen.findByText("好");

    // Press the star icon (star-outline for unstarred)
    fireEvent.press(screen.getByText("star-outline"));

    await waitFor(() => {
      expect(mockToggleStarred).toHaveBeenCalledWith("c1", true);
    });
  });
});

describe("VocabList — delete", () => {
  it("shows confirmation alert when delete pressed", async () => {
    const alertSpy = jest.spyOn(Alert, "alert");
    mockFetchAll.mockResolvedValue([
      makeCard({ id: "c1", word: "好" }),
    ]);
    renderVocab();
    await screen.findByText("好");

    fireEvent.press(screen.getByText("trash-outline"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Remove Word",
      'Remove "好" from your vocab?',
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });
});

describe("VocabList — navigation", () => {
  it("calls onBack when back button pressed", async () => {
    const onBack = jest.fn();
    renderVocab(onBack);
    await screen.findByText("Saved Words");

    fireEvent.press(screen.getByText("chevron-back"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
