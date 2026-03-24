/**
 * Tests for flashcard service — FSRS field mapping, Supabase calls, and data transforms.
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
  fetchDueFlashcards,
  fetchAllFlashcards,
  deleteFlashcard,
  toggleStarred,
} from "../flashcards";

// Sample DB row matching what Supabase returns (with joined relations)
const MOCK_DB_ROW = {
  id: "card-1",
  user_id: "user-123",
  vocab_word_id: "vocab-1",
  definition_id: "def-1",
  source_video_id: "video-1",
  state: 2,
  stability: 4.5,
  difficulty: 3.2,
  due: "2026-03-25T12:00:00.000Z",
  last_review_at: "2026-03-23T12:00:00.000Z",
  elapsed_days: 2,
  scheduled_days: 4,
  reps: 3,
  lapses: 1,
  learning_steps: 2,
  starred: true,
  created_at: "2026-03-20T00:00:00.000Z",
  vocab_words: { word: "好", pinyin: "hǎo", language: "zh" },
  word_definitions: {
    translation: "good",
    contextual_definition: "fine, okay",
    part_of_speech: "adjective",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
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

// ─── saveFlashcard ───

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

  it("throws when not authenticated", async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
    });
    await expect(saveFlashcard("v", "d", "s", "zh")).rejects.toThrow("Not authenticated");
  });
});

// ─── fetchDueFlashcards ───

describe("fetchDueFlashcards", () => {
  it("queries with correct filters and maps all FSRS fields", async () => {
    mockLimit.mockResolvedValueOnce({ data: [MOCK_DB_ROW], error: null });

    const result = await fetchDueFlashcards("zh", 20);

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("stability"));
    expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("starred"));
    expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("learning_steps"));
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-123");

    expect(result).toHaveLength(1);
    const card = result[0];
    // Verify all FSRS fields mapped
    expect(card.state).toBe(2);
    expect(card.stability).toBe(4.5);
    expect(card.difficulty).toBe(3.2);
    expect(card.elapsed_days).toBe(2);
    expect(card.scheduled_days).toBe(4);
    expect(card.reps).toBe(3);
    expect(card.lapses).toBe(1);
    expect(card.learning_steps).toBe(2);
    expect(card.starred).toBe(true);
    // Verify joined display data
    expect(card.word).toBe("好");
    expect(card.pinyin).toBe("hǎo");
    expect(card.translation).toBe("good");
    expect(card.language).toBe("zh");
  });

  it("returns empty array when not authenticated", async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
    });
    const result = await fetchDueFlashcards("zh", 20);
    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: { message: "fail" } });
    const result = await fetchDueFlashcards("zh", 20);
    expect(result).toEqual([]);
  });

  it("defaults nullable FSRS fields to 0/false", async () => {
    const rowWithNulls = {
      ...MOCK_DB_ROW,
      stability: null,
      difficulty: null,
      elapsed_days: null,
      scheduled_days: null,
      reps: null,
      lapses: null,
      learning_steps: null,
      starred: null,
    };
    mockLimit.mockResolvedValueOnce({ data: [rowWithNulls], error: null });

    const result = await fetchDueFlashcards("zh", 20);
    const card = result[0];

    expect(card.stability).toBe(0);
    expect(card.difficulty).toBe(0);
    expect(card.elapsed_days).toBe(0);
    expect(card.scheduled_days).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.learning_steps).toBe(0);
    expect(card.starred).toBe(false);
  });
});

// ─── fetchAllFlashcards ───

describe("fetchAllFlashcards", () => {
  it("fetches all cards ordered by created_at desc (no due filter)", async () => {
    // fetchAllFlashcards doesn't call .limit(), so the chain ends at .order()
    mockOrder.mockResolvedValueOnce({ data: [MOCK_DB_ROW], error: null });

    const result = await fetchAllFlashcards("zh");

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    // Should NOT call .lte (no due date filter)
    expect(mockLte).not.toHaveBeenCalled();

    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("好");
    expect(result[0].starred).toBe(true);
  });

  it("returns empty array when not authenticated", async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
    });
    const result = await fetchAllFlashcards("zh");
    expect(result).toEqual([]);
  });
});

// ─── updateFlashcardAfterReview ───

describe("updateFlashcardAfterReview", () => {
  it("sends all 10 FSRS fields and filters by id + user_id", async () => {
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
    // Verify both id and user_id filters (RLS compliance)
    expect(mockEq).toHaveBeenCalledWith("id", "card-123");
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-123");
  });
});

// ─── logReview ───

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

// ─── toggleStarred ───

describe("toggleStarred", () => {
  it("updates starred field with user_id filter", async () => {
    mockEq.mockReturnValueOnce({ eq: mockEq }).mockResolvedValueOnce({ error: null });

    await toggleStarred("card-123", true);

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(mockUpdate).toHaveBeenCalledWith({ starred: true });
    expect(mockEq).toHaveBeenCalledWith("id", "card-123");
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-123");
  });

  it("can unstar a card", async () => {
    mockEq.mockReturnValueOnce({ eq: mockEq }).mockResolvedValueOnce({ error: null });

    await toggleStarred("card-123", false);

    expect(mockUpdate).toHaveBeenCalledWith({ starred: false });
  });

  it("throws when not authenticated", async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
    });
    await expect(toggleStarred("card-123", true)).rejects.toThrow("Not authenticated");
  });
});

// ─── fetchFlashcardCount ───

describe("fetchFlashcardCount", () => {
  it("returns count from Supabase", async () => {
    // Chain: .select().eq().eq() — second .eq() resolves
    mockEq
      .mockReturnValueOnce({ eq: jest.fn().mockResolvedValue({ count: 42, error: null }) });

    const result = await fetchFlashcardCount("zh");

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(result).toBe(42);
  });

  it("returns 0 when not authenticated", async () => {
    (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
    });
    const result = await fetchFlashcardCount("zh");
    expect(result).toBe(0);
  });

  it("returns 0 on error", async () => {
    mockEq
      .mockReturnValueOnce({ eq: jest.fn().mockResolvedValue({ count: null, error: { message: "fail" } }) });
    const result = await fetchFlashcardCount("zh");
    expect(result).toBe(0);
  });
});

// ─── deleteFlashcard ───

describe("deleteFlashcard", () => {
  it("deletes by id", async () => {
    mockEq.mockResolvedValueOnce({ error: null });
    await deleteFlashcard("card-123");

    expect(supabase.from).toHaveBeenCalledWith("flashcards");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("id", "card-123");
  });

  it("throws on error", async () => {
    mockEq.mockResolvedValueOnce({ error: { message: "not found" } });
    await expect(deleteFlashcard("bad-id")).rejects.toEqual({ message: "not found" });
  });
});
