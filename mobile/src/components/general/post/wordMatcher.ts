/**
 * Word matching utility — finds the best WordDefinition match for a tapped
 * character position in subtitle text.
 *
 * Handles the core mismatch: OCR/STT detections are unsegmented text strings
 * (e.g., "喝酒有害健康") but video_words contains jieba-segmented words
 * (e.g., ["喝酒", "有害", "健康"]).
 *
 * Matching strategy (in priority order):
 * 1. Find a wordDef whose display_text is a substring of fullText at a position
 *    containing charIndex, WITH time overlap (±3s)
 * 2. Same but WITHOUT time constraint (fallback for seeks/pauses)
 * 3. Find a wordDef whose display_text contains the tapped character
 *    (handles single-char taps on multi-char words)
 */

import { WordDefinition } from "../../../../types";

/**
 * Strip punctuation and whitespace for matching.
 * Keeps CJK characters, letters, and numbers only.
 */
function normalize(text: string): string {
  return text.replace(/[\s\u3000\uff0c\u3002\uff1f\uff01\u201c\u201d\u2018\u2019\u300a\u300b\u3010\u3011.,!?'"()\-:;]/g, "");
}

interface MatchResult {
  match: WordDefinition;
  /** Start index of the matched word within fullText */
  wordStart: number;
}

export function findWordMatch(
  wordDefs: WordDefinition[] | undefined,
  fullText: string,
  charIndex: number,
  currentTimeMs: number,
  tappedWord?: string,
): MatchResult | null {
  if (!wordDefs || wordDefs.length === 0) return null;

  const TIME_WINDOW_MS = 3000;
  const normalizedFull = normalize(fullText);

  // Build a char-index mapping: normalizedFull[i] → original fullText index
  // This lets us match normalized positions back to original positions
  const normalToOriginal: number[] = [];
  let ni = 0;
  for (let oi = 0; oi < fullText.length; oi++) {
    if (ni < normalizedFull.length && normalizedFull[ni] === fullText[oi]) {
      normalToOriginal.push(oi);
      ni++;
    }
  }

  // Map the tapped charIndex to normalized index
  let normalizedCharIndex = charIndex;
  for (let i = 0; i < normalToOriginal.length; i++) {
    if (normalToOriginal[i] >= charIndex) {
      normalizedCharIndex = i;
      break;
    }
  }

  // Strategy 1: Collect ALL position-matching candidates, pick best by time proximity
  const candidates: { wd: WordDefinition; origStart: number; timeDist: number }[] = [];

  for (const wd of wordDefs) {
    const normalizedWord = normalize(wd.display_text);
    if (!normalizedWord) continue;

    let searchFrom = 0;
    while (searchFrom <= normalizedFull.length) {
      const pos = normalizedFull.indexOf(normalizedWord, searchFrom);
      if (pos < 0) break;

      if (normalizedCharIndex >= pos && normalizedCharIndex < pos + normalizedWord.length) {
        const origStart = pos < normalToOriginal.length ? normalToOriginal[pos] : pos;
        // Time distance: how far is currentTimeMs from this word's time range?
        const midMs = (wd.start_ms + wd.end_ms) / 2;
        const timeDist = Math.abs(currentTimeMs - midMs);
        candidates.push({ wd, origStart, timeDist });
      }
      searchFrom = pos + 1;
    }
  }

  // Pick the candidate with the closest time match
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.timeDist - b.timeDist);
    return { match: candidates[0].wd, wordStart: candidates[0].origStart };
  }

  // Strategy 3: If tappedWord is a single character (CJK tap from STT overlay),
  // find a wordDef that contains this character
  if (tappedWord && tappedWord.length === 1) {
    for (const timeCheck of [true, false]) {
      for (const wd of wordDefs) {
        if (wd.display_text.includes(tappedWord)) {
          if (!timeCheck || (currentTimeMs >= wd.start_ms - TIME_WINDOW_MS && currentTimeMs < wd.end_ms + TIME_WINDOW_MS)) {
            // Find where this word appears in fullText
            const pos = fullText.indexOf(wd.display_text);
            return { match: wd, wordStart: pos >= 0 ? pos : charIndex };
          }
        }
      }
    }
  }

  return null;
}
