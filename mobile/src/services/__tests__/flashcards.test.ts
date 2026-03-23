/**
 * Tests for flashcard service — FSRS field mapping and Supabase calls.
 */

const mockUpdate = jest.fn().mockReturnThis();
const mockEq = jest.fn().mockReturnThis();
const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockSelect = jest.fn().mockReturnThis();
const mockLte = jest.fn().mockReturnThis();
const mockOrder = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockResolvedValue({ data: [], error: null });
const mockDelete = jest.fn().mockReturnThis();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "user-123" } },
      }),
    },
    from: jest.fn(() => ({
      select: mockSelect,
      eq: mockEq,
      lte: mockLte,
      order: mockOrder,
      limit: mockLimit,
      update: mockUpdate,
      insert: mockInsert,
      upsert: mockUpsert,
      delete: mockDelete,
    })),
  },
}));

import { supabase } from "../../lib/supabase";
import {
  saveFlashcard,
  updateFlashcardAfterReview,
  logReview,
  fetchFlashcardCount,
  deleteFlashcard,
} from "../flashcards";

beforeEach(() => {
  jest.clearAllMocks();
  // Reset chaining — each chained method returns the mock object
  mockUpdate.mockReturnThis();
  mockEq.mockReturnThis();
  mockSelect.mockReturnThis();
  mockLte.mockReturnThis();
  mockOrder.mockReturnThis();
  mockDelete.mockReturnThis();
  mockLimit.mockResolvedValue({ data: [], error: null });
  mockInsert.mockResolvedValue({ error: null });
  mockUpsert.mockResolvedValue({ error: null });
});

describe("saveFlashcard", () => {
  it("upserts with correct fields and conflict key", async () => {
    await saveFlashcard("vocab-1", "def-1", "video-1", "zh");

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        user_id: "user-123",
        vocab_word_id: "vocab-1",
        definition_id: "def-1",
        source_video_id: "video-1",
      },
      { onConflict: "user_id,vocab_word_id,definition_id" },
    );
  });

  it("throws when upsert fails", async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: "DB error" } });
    await expect(saveFlashcard("v", "d", "s", "zh")).rejects.toEqual({ message: "DB error" });
  });
});

describe("updateFlashcardAfterReview", () => {
  it("sends all FSRS fields to Supabase", async () => {
    const fsrsFields = {
      state: 1,
      stability: 2.3065,
      difficulty: 5.678,
      due: "2026-03-24T12:00:00.000Z",
      last_review_at: "2026-03-23T12:00:00.000Z",
      elapsed_days: 1.5,
      scheduled_days: 3,
      reps: 2,
      lapses: 0,
      learning_steps: 1,
    };

    // Make .eq return something with no error for the final call
    mockEq.mockReturnValueOnce({ eq: mockEq }).mockResolvedValueOnce({ error: null });

    await updateFlashcardAfterReview("card-123", fsrsFields);

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(mockUpdate).toHaveBeenCalledWith({
      state: 1,
      stability: 2.3065,
      difficulty: 5.678,
      due: "2026-03-24T12:00:00.000Z",
      last_review_at: "2026-03-23T12:00:00.000Z",
      elapsed_days: 1.5,
      scheduled_days: 3,
      reps: 2,
      lapses: 0,
      learning_steps: 1,
    });
  });
});

describe("logReview", () => {
  it("inserts review log with full FSRS snapshot", async () => {
    const logFields = {
      rating: 3,
      state: 0,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      last_elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
    };

    await logReview("card-123", logFields, 4500);

    expect(supabase.from).toHaveBeenCalledWith("review_logs");
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "user-123",
      flashcard_id: "card-123",
      rating: 3,
      review_duration_ms: 4500,
      state: 0,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      last_elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
    });
  });

  it("passes null for duration when not provided", async () => {
    const logFields = {
      rating: 1,
      state: 1,
      stability: 0.5,
      difficulty: 6.0,
      elapsed_days: 0,
      last_elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
    };

    await logReview("card-456", logFields);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ review_duration_ms: null }),
    );
  });
});

describe("deleteFlashcard", () => {
  it("deletes by id", async () => {
    mockEq.mockResolvedValueOnce({ error: null });
    await deleteFlashcard("card-123");

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("id", "card-123");
  });
});
