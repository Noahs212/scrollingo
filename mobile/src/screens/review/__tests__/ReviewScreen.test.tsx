// Use real react-redux (not the global mock) since we provide a real store
jest.unmock("react-redux");

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureStore } from "@reduxjs/toolkit";
import authSlice from "../../../redux/slices/authSlice";
import languageSlice from "../../../redux/slices/languageSlice";
import postSlice from "../../../redux/slices/postSlice";
import modalSlice from "../../../redux/slices/modalSlice";
import chatSlice from "../../../redux/slices/chatSlice";

// ─── Mocks ───

const mockFetchDue = jest.fn().mockResolvedValue([]);
const mockFetchCount = jest.fn().mockResolvedValue(0);
const mockUpdateCard = jest.fn().mockResolvedValue(undefined);
const mockLogReview = jest.fn().mockResolvedValue(undefined);

jest.mock("../../../lib/supabase", () => ({
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "test-user" } } }) },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

jest.mock("../../../services/flashcards", () => ({
  fetchDueFlashcards: (...args: any[]) => mockFetchDue(...args),
  fetchFlashcardCount: (...args: any[]) => mockFetchCount(...args),
  updateFlashcardAfterReview: (...args: any[]) => mockUpdateCard(...args),
  logReview: (...args: any[]) => mockLogReview(...args),
  saveFlashcard: jest.fn(),
  deleteFlashcard: jest.fn(),
}));

jest.mock("expo-speech", () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

// Mock ts-fsrs with realistic scheduling behavior
jest.mock("ts-fsrs", () => {
  const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
  const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };
  return {
    fsrs: () => ({
      repeat: (card: any, now: Date) => {
        const makeResult = (rating: number) => {
          const isAgain = rating === 1;
          return {
            card: {
              due: new Date(now.getTime() + (isAgain ? 60000 : 86400000)),
              stability: isAgain ? 0.2 : 2.3,
              difficulty: isAgain ? 6.4 : 2.1,
              elapsed_days: 0,
              scheduled_days: isAgain ? 0 : 1,
              reps: (card.reps ?? 0) + 1,
              lapses: card.lapses ?? 0,
              learning_steps: isAgain ? 0 : 1,
              state: isAgain ? State.Learning : State.Learning,
              last_review: now,
            },
            log: {
              rating,
              state: card.state ?? 0,
              stability: card.stability ?? 0,
              difficulty: card.difficulty ?? 0,
              elapsed_days: 0,
              last_elapsed_days: 0,
              scheduled_days: 0,
              learning_steps: card.learning_steps ?? 0,
              review: now,
            },
          };
        };
        return {
          [Rating.Again]: makeResult(Rating.Again),
          [Rating.Hard]: makeResult(Rating.Hard),
          [Rating.Good]: makeResult(Rating.Good),
          [Rating.Easy]: makeResult(Rating.Easy),
        };
      },
    }),
    createEmptyCard: jest.fn(() => ({})),
    Rating,
    State,
  };
});

import ReviewScreen from "../index";
import { Flashcard } from "../../../../types";

// ─── Helpers ───

function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "card-1",
    user_id: "test-user",
    vocab_word_id: "vocab-1",
    definition_id: "def-1",
    source_video_id: "video-1",
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
    word: "好",
    pinyin: "hǎo",
    translation: "good",
    contextual_definition: "fine, okay",
    part_of_speech: "adjective",
    language: "zh",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function createTestStore() {
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
          uid: "test-user",
          email: "test@test.com",
          displayName: "Test",
          followingCount: 0,
          followersCount: 0,
          likesCount: 0,
          nativeLanguage: "en",
          targetLanguage: "zh",
          learningLanguages: ["zh"],
          streakDays: 5,
          longestStreak: 10,
          totalWordsLearned: 25,
          totalVideosWatched: 12,
          dailyGoalMinutes: 10,
          maxReviewsPerDay: 20,
          premium: false,
        },
      },
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const store = createTestStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchDue.mockResolvedValue([]);
  mockFetchCount.mockResolvedValue(0);
});

// ─── ReviewHub: Empty State ───

describe("ReviewHub — empty state (no saved words)", () => {
  it("renders title and empty message", async () => {
    renderWithProviders(<ReviewScreen />);

    expect(await screen.findByText("Review")).toBeTruthy();
    expect(await screen.findByText("No saved words yet")).toBeTruthy();
    expect(
      screen.getByText("Tap words in video subtitles to save them for review"),
    ).toBeTruthy();
  });

  it("does not show start button", async () => {
    renderWithProviders(<ReviewScreen />);
    await screen.findByText("No saved words yet");

    expect(screen.queryByText("Start Review")).toBeNull();
  });
});

// ─── ReviewHub: All Caught Up ───

describe("ReviewHub — all caught up (has words, none due)", () => {
  beforeEach(() => {
    mockFetchCount.mockResolvedValue(15); // has saved words
    mockFetchDue.mockResolvedValue([]); // but none due
  });

  it("shows caught up message", async () => {
    renderWithProviders(<ReviewScreen />);

    expect(await screen.findByText("All Caught Up!")).toBeTruthy();
    expect(
      screen.getByText("No cards due right now. Check back later."),
    ).toBeTruthy();
  });

  it("shows streak and saved word stats", async () => {
    renderWithProviders(<ReviewScreen />);
    await screen.findByText("All Caught Up!");

    expect(screen.getByText("5 day streak")).toBeTruthy();
    expect(screen.getByText("15 words saved")).toBeTruthy();
  });
});

// ─── ReviewHub: Cards Due ───

describe("ReviewHub — cards due", () => {
  const dueCards = [
    makeFlashcard({ id: "c1", word: "好" }),
    makeFlashcard({ id: "c2", word: "累" }),
    makeFlashcard({ id: "c3", word: "行" }),
  ];

  beforeEach(() => {
    mockFetchCount.mockResolvedValue(10);
    mockFetchDue.mockResolvedValue(dueCards);
  });

  it("shows cards ready label in hero card", async () => {
    renderWithProviders(<ReviewScreen />);

    expect(await screen.findByText("cards ready")).toBeTruthy();
  });

  it("shows motivational message for small count", async () => {
    renderWithProviders(<ReviewScreen />);

    expect(await screen.findByText("Quick session ahead")).toBeTruthy();
  });

  it("shows start review button", async () => {
    renderWithProviders(<ReviewScreen />);

    expect(await screen.findByText("Start Review")).toBeTruthy();
  });

  it("shows settings gear icon", async () => {
    renderWithProviders(<ReviewScreen />);
    await screen.findByText("Start Review");

    expect(screen.getByText("settings-outline")).toBeTruthy();
  });
});

// ─── CardViewer: Session Flow ───

describe("CardViewer — review session", () => {
  const dueCards = [
    makeFlashcard({ id: "c1", word: "好", translation: "good" }),
    makeFlashcard({ id: "c2", word: "累", pinyin: "lèi", translation: "tired" }),
  ];

  beforeEach(() => {
    mockFetchCount.mockResolvedValue(5);
    mockFetchDue.mockResolvedValue(dueCards);
  });

  it("shows card viewer after pressing Start Review", async () => {
    renderWithProviders(<ReviewScreen />);

    const startButton = await screen.findByText("Start Review");
    fireEvent.press(startButton);

    expect(await screen.findByText("Review Session")).toBeTruthy();
    expect(screen.getByText("好")).toBeTruthy();
    expect(screen.getByText("2 left")).toBeTruthy();
  });

  it("shows WORD badge on front of card", async () => {
    renderWithProviders(<ReviewScreen />);
    fireEvent.press(await screen.findByText("Start Review"));

    expect(await screen.findByText("WORD")).toBeTruthy();
  });

  it("shows flip prompt before card is flipped", async () => {
    renderWithProviders(<ReviewScreen />);
    fireEvent.press(await screen.findByText("Start Review"));

    expect(
      await screen.findByText("Tap the card to reveal the answer"),
    ).toBeTruthy();
  });

  it("shows progress bar with 0 of 2", async () => {
    renderWithProviders(<ReviewScreen />);
    fireEvent.press(await screen.findByText("Start Review"));

    expect(await screen.findByText("0 of 2 cards")).toBeTruthy();
  });
});

// ─── SessionComplete ───

describe("SessionComplete — after finishing", () => {
  beforeEach(() => {
    mockFetchCount.mockResolvedValue(1);
    mockFetchDue.mockResolvedValue([
      makeFlashcard({ id: "c1", word: "好", translation: "good" }),
    ]);
  });

  it("shows session complete after rating all cards", async () => {
    renderWithProviders(<ReviewScreen />);

    // Start session
    fireEvent.press(await screen.findByText("Start Review"));
    await screen.findByText("Review Session");

    // Flip card
    fireEvent.press(screen.getByText("好"));

    // Rate "Got it"
    await act(async () => {
      fireEvent.press(screen.getByText("Got it"));
    });

    // Should show session complete
    expect(await screen.findByText("Session Complete")).toBeTruthy();
  });

  it("shows Done button to return to hub", async () => {
    renderWithProviders(<ReviewScreen />);
    fireEvent.press(await screen.findByText("Start Review"));
    await screen.findByText("Review Session");

    fireEvent.press(screen.getByText("好"));

    await act(async () => {
      fireEvent.press(screen.getByText("Got it"));
    });

    expect(await screen.findByText("Done")).toBeTruthy();
  });

  it("returns to hub after pressing Done", async () => {
    // Reset mocks for the return to hub
    mockFetchDue.mockResolvedValue([]);

    renderWithProviders(<ReviewScreen />);
    mockFetchDue.mockResolvedValue([
      makeFlashcard({ id: "c1", word: "好", translation: "good" }),
    ]);
    fireEvent.press(await screen.findByText("Start Review"));
    await screen.findByText("Review Session");

    fireEvent.press(screen.getByText("好"));

    await act(async () => {
      fireEvent.press(screen.getByText("Got it"));
    });

    // Press Done
    fireEvent.press(await screen.findByText("Done"));

    // Should be back at hub
    expect(await screen.findByText("Review")).toBeTruthy();
  });
});

// ─── FSRS Integration ───

describe("FSRS data persistence", () => {
  beforeEach(() => {
    mockFetchCount.mockResolvedValue(1);
    mockFetchDue.mockResolvedValue([
      makeFlashcard({ id: "c1", word: "好" }),
    ]);
  });

  it("calls updateFlashcardAfterReview with all FSRS fields", async () => {
    renderWithProviders(<ReviewScreen />);
    fireEvent.press(await screen.findByText("Start Review"));
    await screen.findByText("Review Session");

    // Flip and rate
    fireEvent.press(screen.getByText("好"));
    await act(async () => {
      fireEvent.press(screen.getByText("Got it"));
    });

    expect(mockUpdateCard).toHaveBeenCalledTimes(1);
    const [cardId, fields] = mockUpdateCard.mock.calls[0];
    expect(cardId).toBe("c1");

    // Verify all FSRS fields are present
    expect(fields).toHaveProperty("state");
    expect(fields).toHaveProperty("stability");
    expect(fields).toHaveProperty("difficulty");
    expect(fields).toHaveProperty("due");
    expect(fields).toHaveProperty("last_review_at");
    expect(fields).toHaveProperty("elapsed_days");
    expect(fields).toHaveProperty("scheduled_days");
    expect(fields).toHaveProperty("reps");
    expect(fields).toHaveProperty("lapses");
    expect(fields).toHaveProperty("learning_steps");

    // After a "Good" rating on a new card, state should change from 0
    expect(fields.state).not.toBe(0);
    expect(fields.stability).toBeGreaterThan(0);
    expect(fields.reps).toBe(1);
  });

  it("calls logReview with FSRS snapshot fields", async () => {
    renderWithProviders(<ReviewScreen />);
    fireEvent.press(await screen.findByText("Start Review"));
    await screen.findByText("Review Session");

    fireEvent.press(screen.getByText("好"));
    await act(async () => {
      fireEvent.press(screen.getByText("Got it"));
    });

    expect(mockLogReview).toHaveBeenCalledTimes(1);
    const [cardId, logFields, durationMs] = mockLogReview.mock.calls[0];
    expect(cardId).toBe("c1");
    expect(typeof durationMs).toBe("number");

    // Verify FSRS log snapshot fields
    expect(logFields).toHaveProperty("rating", 3); // Good = 3
    expect(logFields).toHaveProperty("state");
    expect(logFields).toHaveProperty("stability");
    expect(logFields).toHaveProperty("difficulty");
    expect(logFields).toHaveProperty("elapsed_days");
    expect(logFields).toHaveProperty("last_elapsed_days");
    expect(logFields).toHaveProperty("scheduled_days");
    expect(logFields).toHaveProperty("learning_steps");
  });

  it("sends different FSRS values for Again vs Good ratings", async () => {
    // Test with Again
    mockFetchDue.mockResolvedValue([
      makeFlashcard({ id: "c-again", word: "难" }),
    ]);

    renderWithProviders(<ReviewScreen />);
    fireEvent.press(await screen.findByText("Start Review"));
    await screen.findByText("Review Session");

    fireEvent.press(screen.getByText("难"));
    await act(async () => {
      fireEvent.press(screen.getByText("Forgot"));
    });

    const [, againFields] = mockUpdateCard.mock.calls[0];
    const [, againLog] = mockLogReview.mock.calls[0];

    // Again rating = 1
    expect(againLog.rating).toBe(1);
    // Again produces lower stability than Good
    expect(againFields.stability).toBeLessThan(1);
  });
});
