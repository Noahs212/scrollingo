/**
 * Tests for word matching utility — the core logic that maps a tapped
 * character position in subtitle text to a WordDefinition.
 *
 * Key scenarios:
 * - CJK unsegmented text (OCR: "喝酒有害健康") with jieba words (["喝酒", "有害", "健康"])
 * - Single CJK character tap (STT) matching multi-char jieba word
 * - Punctuation in OCR text vs clean pipeline words
 * - Time window matching (±3s)
 * - Duplicate words in same sentence
 */

import { findWordMatch } from "../wordMatcher";

function makeDef(overrides = {}) {
  return {
    word_index: 0,
    display_text: "好",
    start_ms: 1000,
    end_ms: 3000,
    word: "好",
    pinyin: "hǎo",
    translation: "good",
    contextual_definition: "fine",
    part_of_speech: "adj",
    vocab_word_id: "v1",
    definition_id: "d1",
    ...overrides,
  };
}

describe("findWordMatch — CJK segmented words in unsegmented OCR text", () => {
  const wordDefs = [
    makeDef({ word_index: 0, display_text: "喝酒", word: "喝酒", start_ms: 1000, end_ms: 3000 }),
    makeDef({ word_index: 1, display_text: "有害", word: "有害", start_ms: 1000, end_ms: 3000 }),
    makeDef({ word_index: 2, display_text: "健康", word: "健康", start_ms: 1000, end_ms: 3000 }),
  ];
  const fullText = "喝酒有害健康";

  it("matches first word when tapping char 0", () => {
    const result = findWordMatch(wordDefs, fullText, 0, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("喝酒");
    expect(result?.wordStart).toBe(0);
  });

  it("matches first word when tapping char 1", () => {
    const result = findWordMatch(wordDefs, fullText, 1, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("喝酒");
  });

  it("matches second word when tapping char 2", () => {
    const result = findWordMatch(wordDefs, fullText, 2, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("有害");
    expect(result?.wordStart).toBe(2);
  });

  it("matches third word when tapping char 4", () => {
    const result = findWordMatch(wordDefs, fullText, 4, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("健康");
    expect(result?.wordStart).toBe(4);
  });

  it("matches last char (index 5) to third word", () => {
    const result = findWordMatch(wordDefs, fullText, 5, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("健康");
  });
});

describe("findWordMatch — single CJK char tap (STT overlay)", () => {
  const wordDefs = [
    makeDef({ display_text: "天天", word: "天天", start_ms: 1000, end_ms: 3000 }),
    makeDef({ display_text: "好", word: "好", start_ms: 1000, end_ms: 3000 }),
  ];
  const fullText = "天天好";

  it("matches '天天' when tapping single '天' character at index 0", () => {
    const result = findWordMatch(wordDefs, fullText, 0, 2000, "天");
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("天天");
  });

  it("matches '天天' when tapping second '天' at index 1", () => {
    const result = findWordMatch(wordDefs, fullText, 1, 2000, "天");
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("天天");
  });

  it("matches '好' when tapping '好' at index 2", () => {
    const result = findWordMatch(wordDefs, fullText, 2, 2000, "好");
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("好");
  });
});

describe("findWordMatch — punctuation normalization", () => {
  const wordDefs = [
    makeDef({ display_text: "你好", word: "你好", start_ms: 0, end_ms: 5000 }),
    makeDef({ display_text: "世界", word: "世界", start_ms: 0, end_ms: 5000 }),
  ];

  it("matches through Chinese punctuation (comma)", () => {
    const result = findWordMatch(wordDefs, "你好，世界", 3, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("世界");
  });

  it("matches through Chinese period", () => {
    const result = findWordMatch(wordDefs, "你好。世界", 0, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("你好");
  });

  it("matches through spaces", () => {
    const result = findWordMatch(wordDefs, "你好 世界", 3, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("世界");
  });
});

describe("findWordMatch — time window", () => {
  const wordDefs = [
    makeDef({ display_text: "好", start_ms: 5000, end_ms: 7000 }),
  ];

  it("matches within ±3s time window", () => {
    // 3s before start_ms
    expect(findWordMatch(wordDefs, "好", 0, 2000)).not.toBeNull();
    // At start
    expect(findWordMatch(wordDefs, "好", 0, 5000)).not.toBeNull();
    // At end
    expect(findWordMatch(wordDefs, "好", 0, 7000)).not.toBeNull();
    // 3s after end
    expect(findWordMatch(wordDefs, "好", 0, 9999)).not.toBeNull();
  });

  it("falls back to no-time match when outside window", () => {
    // Way outside time window — should still match via fallback
    const result = findWordMatch(wordDefs, "好", 0, 99000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("好");
  });
});

describe("findWordMatch — duplicate words in sentence", () => {
  const wordDefs = [
    makeDef({ word_index: 0, display_text: "自己", start_ms: 0, end_ms: 2000, translation: "oneself (1st)" }),
    makeDef({ word_index: 5, display_text: "自己", start_ms: 3000, end_ms: 5000, translation: "oneself (2nd)" }),
  ];

  it("matches first occurrence at charIndex 0", () => {
    const result = findWordMatch(wordDefs, "自己一个人自己", 0, 1000);
    expect(result).not.toBeNull();
    expect(result?.wordStart).toBe(0);
    expect(result?.match.translation).toBe("oneself (1st)");
  });

  it("matches second occurrence at charIndex 5", () => {
    const result = findWordMatch(wordDefs, "自己一个人自己", 5, 4000);
    expect(result).not.toBeNull();
    expect(result?.wordStart).toBe(5);
    expect(result?.match.translation).toBe("oneself (2nd)");
  });
});

describe("findWordMatch — edge cases", () => {
  it("returns null for empty wordDefs", () => {
    expect(findWordMatch([], "好", 0, 1000)).toBeNull();
    expect(findWordMatch(undefined, "好", 0, 1000)).toBeNull();
  });

  it("returns null when no word matches the position", () => {
    const wordDefs = [makeDef({ display_text: "好" })];
    expect(findWordMatch(wordDefs, "坏", 0, 1000)).toBeNull();
  });

  it("handles English words split by spaces", () => {
    const wordDefs = [
      makeDef({ display_text: "hello", start_ms: 0, end_ms: 5000 }),
      makeDef({ display_text: "world", start_ms: 0, end_ms: 5000 }),
    ];
    const result = findWordMatch(wordDefs, "hello world", 6, 2000);
    expect(result).not.toBeNull();
    expect(result?.match.display_text).toBe("world");
  });
});
