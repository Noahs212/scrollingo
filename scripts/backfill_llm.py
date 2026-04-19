#!/usr/bin/env python3
"""
Backfill LLM data (word definitions + segment translations) for videos
that already have OCR/STT bboxes.json in R2 but are missing LLM content.

Use this when the pipeline failed or was interrupted at the LLM step and
you don't want to re-run the expensive OCR step.

Handles:
  - Videos with status='processing' and no word_definitions in Supabase
  - Video IDs present in R2 but with no Supabase row yet

Usage:
    python3 scripts/backfill_llm.py              # all incomplete videos
    python3 scripts/backfill_llm.py --video-id UUID
    python3 scripts/backfill_llm.py --dry-run    # detect language only, no writes
"""

import argparse
import datetime
import json
import os
import sys
import tempfile
from pathlib import Path

# Load .env (same approach as pipeline.py)
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

# Import pipeline functions — reuses all LLM/Supabase/R2 setup
sys.path.insert(0, str(Path(__file__).parent))
import pipeline as pipe

supabase = pipe.supabase
R2_BUCKET_NAME = pipe.R2_BUCKET_NAME
R2_BUCKET_URL = pipe.R2_BUCKET_URL


# ── R2 helpers ──────────────────────────────────────────────────────────────

def list_r2_video_ids_with_bboxes() -> set[str]:
    """Return set of video IDs that have a bboxes.json in R2."""
    r2 = pipe.get_r2_client()
    paginator = r2.get_paginator("list_objects_v2")
    ids = set()
    for page in paginator.paginate(Bucket=R2_BUCKET_NAME, Prefix="videos/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/bboxes.json"):
                parts = key.split("/")
                if len(parts) >= 3:
                    ids.add(parts[1])
    return ids


def download_bboxes(video_id: str) -> dict:
    """Download bboxes.json from R2 and return parsed content."""
    r2 = pipe.get_r2_client()
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        tmp_path = f.name
    r2.download_file(R2_BUCKET_NAME, f"videos/{video_id}/bboxes.json", tmp_path)
    data = json.loads(Path(tmp_path).read_text(encoding="utf-8"))
    os.unlink(tmp_path)
    return data


# ── Candidate discovery ──────────────────────────────────────────────────────

def find_candidates(target_video_id: str | None = None) -> list[dict]:
    """
    Find videos that need LLM backfill.
    Returns list of dicts with keys: id, title, language, status, in_supabase
    """
    # All Supabase videos
    sb_result = supabase.table("videos").select("id, title, language, status").execute()
    supabase_map = {v["id"]: v for v in sb_result.data}

    # Which video IDs already have word_definitions
    wd_result = supabase.table("word_definitions").select("video_id").execute()
    has_defs = {row["video_id"] for row in wd_result.data}

    # R2 video IDs with bboxes.json
    r2_ids_with_bboxes = list_r2_video_ids_with_bboxes()

    candidates = []
    all_ids = set(supabase_map.keys()) | r2_ids_with_bboxes

    for vid_id in all_ids:
        if target_video_id and vid_id != target_video_id:
            continue
        if vid_id not in r2_ids_with_bboxes:
            continue  # no bboxes.json → can't backfill without OCR
        if vid_id in has_defs:
            continue  # already has LLM data

        in_supabase = vid_id in supabase_map
        candidates.append({
            "id": vid_id,
            "title": supabase_map[vid_id]["title"] if in_supabase else None,
            "language": supabase_map[vid_id]["language"] if in_supabase else None,
            "status": supabase_map[vid_id]["status"] if in_supabase else None,
            "in_supabase": in_supabase,
        })

    return candidates


# ── Core backfill logic ──────────────────────────────────────────────────────

def backfill_video(video_id: str, dry_run: bool = False) -> None:
    """Run LLM steps 5–9 for one video using its existing R2 bboxes.json."""
    print(f"\n{'='*60}")
    print(f"Backfilling: {video_id}")
    print(f"{'='*60}")

    # Download bboxes.json
    print("  Downloading bboxes.json from R2...")
    bbox_data = download_bboxes(video_id)

    segments = bbox_data.get("segments", [])
    duration_sec = max(1, int(bbox_data.get("duration_ms", 10000) / 1000))
    sub_source = bbox_data.get("subtitle_source", "ocr")

    # Detect language from OCR text (no STT data available in backfill)
    language, confidence = pipe.detect_content_language(bbox_data, stt_data=None)
    if not language:
        language = "zh"
        confidence = "flagged"
        print(f"  Language: zh (fallback — unsupported or undetectable) [flagged]")
    else:
        print(f"  Language: {language} [confidence={confidence}]")

    # Auto-title from first OCR segment
    title = pipe.get_auto_title(bbox_data)
    print(f"  Title: '{title}'")
    print(f"  Segments: {len(segments)}, duration: {duration_sec}s")

    if dry_run:
        print(f"  [DRY RUN] Skipping writes.")
        return

    # Ensure video row exists in Supabase with correct language
    sb_check = supabase.table("videos").select("id, language, status").eq("id", video_id).execute()

    if not sb_check.data:
        # Video row missing — insert it
        cdn_url = f"{R2_BUCKET_URL}/videos/{video_id}/video.mp4"
        thumb_url = f"{R2_BUCKET_URL}/videos/{video_id}/thumbnail.jpg"
        print(f"  Inserting video row (not in Supabase)...")
        pipe.insert_video_row(video_id, title, language, duration_sec, cdn_url, thumb_url, sub_source, language_confidence=confidence)
    else:
        existing_vid = sb_check.data[0]
        if existing_vid["language"] != language:
            print(f"  Fixing language: {existing_vid['language']} → {language} [confidence={confidence}]")
            supabase.table("videos").update({"language": language, "language_confidence": confidence}).eq("id", video_id).execute()

    # Step 5: Word segmentation
    print("[5/9] Segmenting words...")
    unique_words, word_occurrences = pipe.segment_words(bbox_data, language)
    word_sentences = {}
    for occ in word_occurrences:
        if occ["word"] not in word_sentences:
            word_sentences[occ["word"]] = occ["sentence"]
    print(f"  {len(unique_words)} unique words, {len(word_occurrences)} occurrences")

    if not unique_words:
        print("  No words to process — marking ready.")
        pipe.mark_video_ready(video_id, datetime.datetime.now(datetime.timezone.utc).isoformat())
        return

    # Step 6: LLM definitions — parallel across all word×language combinations
    print(f"[6/9] Generating definitions ({len(unique_words)} words × 11 languages, 10 workers)...")
    all_definitions = pipe.generate_all_definitions(unique_words, word_sentences, language, max_workers=10)

    # Step 7: Segment translations — parallel across target languages
    spoken_segments = [
        {
            "start_ms": seg["start_ms"],
            "end_ms": seg["end_ms"],
            "text": seg["detections"][0]["text"],
        }
        for seg in segments
        if seg.get("detections") and seg["detections"][0].get("text", "").strip()
    ]

    all_seg_translations: dict[str, dict[int, str]] = {}
    if spoken_segments:
        print(f"[7/9] Generating segment translations ({len(spoken_segments)} segs × 11 languages, 5 workers)...")
        target_langs = [t for t in pipe.TARGET_LANGUAGES if t["code"] != language]
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {
                pool.submit(pipe.generate_segment_translations, spoken_segments, language, t["code"]): t["code"]
                for t in target_langs
            }
            for future in as_completed(futures):
                target_code = futures[future]
                trans_map = future.result()
                if trans_map:
                    all_seg_translations[target_code] = trans_map
        print(f"  Translations: {len(all_seg_translations)}/{len(target_langs)} languages")
    else:
        print("[7/9] No spoken segments — skipping translations")

    # Step 8: Insert into Supabase
    # Re-verify video row exists — LLM calls above can take 30+ minutes and the row
    # may have been cleaned up by a concurrent process or Supabase cron job.
    print("[8/9] Inserting into Supabase...")
    sb_recheck = supabase.table("videos").select("id").eq("id", video_id).execute()
    if not sb_recheck.data:
        print(f"  WARNING: Video row disappeared during LLM processing — re-inserting...")
        cdn_url = f"{R2_BUCKET_URL}/videos/{video_id}/video.mp4"
        thumb_url = f"{R2_BUCKET_URL}/videos/{video_id}/thumbnail.jpg"
        pipe.insert_video_row(video_id, title, language, duration_sec, cdn_url, thumb_url, sub_source)
    pipe.insert_vocab_and_definitions(video_id, unique_words, all_definitions, word_occurrences, language)
    if all_seg_translations:
        pipe.insert_segment_translations(video_id, spoken_segments, all_seg_translations)

    # Step 9: Mark ready
    print("[9/9] Marking video ready...")
    pipe.mark_video_ready(video_id, datetime.datetime.now(datetime.timezone.utc).isoformat())
    print(f"  Done: {video_id}")


# ── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill LLM data for videos that already have R2 bboxes.json"
    )
    parser.add_argument("--video-id", help="Process one specific video ID only")
    parser.add_argument("--dry-run", action="store_true",
                        help="Detect language and title only — no Supabase writes")
    args = parser.parse_args()

    print("Scanning for videos needing LLM backfill...")
    candidates = find_candidates(args.video_id)

    if not candidates:
        print("No videos found needing backfill (all have word_definitions or no bboxes.json in R2).")
        return

    print(f"\n{len(candidates)} video(s) to process:")
    for c in candidates:
        print(f"  {c['id']}  title={c['title'] or '(unknown)'}  lang={c['language'] or '?'}"
              f"  status={c['status'] or 'not-in-db'}")
    print()

    success = 0
    failed = 0
    for c in candidates:
        try:
            backfill_video(c["id"], dry_run=args.dry_run)
            success += 1
        except Exception as e:
            import traceback
            print(f"\n  ERROR for {c['id']}: {e}")
            traceback.print_exc()
            failed += 1
            # Continue with remaining videos

    print(f"\n{'='*60}")
    if args.dry_run:
        print(f"Dry run complete: {success} would be processed, {failed} errors")
    else:
        print(f"Backfill complete: {success} succeeded, {failed} failed")


if __name__ == "__main__":
    main()
