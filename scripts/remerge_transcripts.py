"""
Re-merge transcripts for all existing videos using the updated merge_ocr_stt() logic.

For each video that has both bboxes.json and stt.json in R2:
  1. Download bboxes.json + stt.json
  2. Run merge_ocr_stt() with the new OCR-first algorithm
  3. Upload the new transcript.json (overwriting the old one)

Videos with only bboxes.json (no stt.json) are re-merged with empty STT data
so the OCR backbone still gets the new filtering/dedup logic applied.

Usage:
    python3 scripts/remerge_transcripts.py [--dry-run] [--video-id UUID]
"""

import argparse
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path

# Load .env
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

import boto3
from supabase import create_client

# Import pipeline functions
sys.path.insert(0, str(Path(__file__).parent))
import pipeline as pl

SUPABASE_URL = os.environ["SupabaseUrl"]
SUPABASE_KEY = os.environ["SupabaseServiceKey"]
R2_ENDPOINT  = os.environ["R2Endpoint"]
R2_ACCESS    = os.environ["R2AccessKeyId"]
R2_SECRET    = os.environ["R2SecretAccessKey"]
R2_BUCKET    = os.environ["R2BucketName"]
R2_CDN       = os.environ["R2BucketUrl"]


def get_r2():
    return boto3.client("s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS,
        aws_secret_access_key=R2_SECRET,
        region_name="auto")


def r2_exists(r2, key: str) -> bool:
    try:
        r2.head_object(Bucket=R2_BUCKET, Key=key)
        return True
    except Exception:
        return False


def r2_download(r2, key: str, local: str) -> bool:
    try:
        r2.download_file(R2_BUCKET, key, local)
        return True
    except Exception as e:
        print(f"    WARN: download failed for {key}: {e}")
        return False


def r2_upload_json(r2, data: dict, key: str):
    import io
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    r2.put_object(
        Bucket=R2_BUCKET,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=31536000, immutable",
    )


def _seg_text(seg: dict) -> str:
    """Extract the display text from a transcript segment."""
    dets = seg.get("detections", [])
    if dets:
        return dets[0].get("text", "").strip()
    return ""


def analyze_transcript(transcript: dict, video_id: str) -> dict:
    """Return a summary dict for reporting."""
    segs = transcript.get("segments", [])
    sources = Counter(s.get("source", "unknown") for s in segs)

    # Suspicious: very short text, duplicate consecutive, very short duration
    suspicious = []
    for i, s in enumerate(segs):
        t = _seg_text(s)
        dur = s.get("end_ms", 0) - s.get("start_ms", 0)
        if len(t) <= 1:
            suspicious.append(f"  seg[{i}] very short text: {repr(t)}")
        if i > 0 and t == _seg_text(segs[i-1]):
            suspicious.append(f"  seg[{i}] duplicate of seg[{i-1}]: {repr(t)}")
        if dur < 100:
            suspicious.append(f"  seg[{i}] very short duration {dur}ms: {repr(t)}")

    return {
        "video_id": video_id,
        "total_segments": len(segs),
        "sources": dict(sources),
        "suspicious": suspicious,
    }


def remerge_video(r2, video_id: str, dry_run: bool) -> dict | None:
    bboxes_key    = f"videos/{video_id}/bboxes.json"
    stt_key       = f"videos/{video_id}/stt.json"
    transcript_key = f"videos/{video_id}/transcript.json"

    has_bboxes    = r2_exists(r2, bboxes_key)
    has_stt       = r2_exists(r2, stt_key)
    has_transcript = r2_exists(r2, transcript_key)

    if not has_bboxes:
        print(f"  SKIP {video_id}: no bboxes.json in R2")
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        local_bboxes = os.path.join(tmpdir, "bboxes.json")
        local_stt    = os.path.join(tmpdir, "stt.json")

        if not r2_download(r2, bboxes_key, local_bboxes):
            print(f"  SKIP {video_id}: bboxes.json download failed")
            return None

        with open(local_bboxes) as f:
            ocr_data = json.load(f)

        if has_stt:
            if r2_download(r2, stt_key, local_stt):
                with open(local_stt) as f:
                    stt_raw = json.load(f)
            else:
                stt_raw = {}
        else:
            stt_raw = {}

        # stt.json may be raw whisper or already-chunked bboxes format
        # If it's bboxes format (has "segments" key), use as-is for stt_data
        # If it's whisper format (has "words"/"text"), it's already been chunked into bboxes
        # merge_ocr_stt expects: ocr_data = bboxes format, stt_data = bboxes format
        if "words" in stt_raw or "text" in stt_raw:
            # This is raw whisper — it should have been chunked before storage but wasn't
            # Use empty stt_data and rely on OCR backbone only
            print(f"  WARN {video_id}: stt.json is raw Whisper format, using OCR-only merge")
            stt_data = {"segments": [], "resolution": ocr_data.get("resolution", {})}
        else:
            stt_data = stt_raw

        new_transcript = pl.merge_ocr_stt(ocr_data, stt_data)
        analysis = analyze_transcript(new_transcript, video_id)

        if dry_run:
            print(f"  DRY-RUN {video_id}: would upload transcript.json "
                  f"({analysis['total_segments']} segs, sources={analysis['sources']})")
        else:
            r2_upload_json(r2, new_transcript, transcript_key)
            print(f"  OK {video_id}: uploaded transcript.json "
                  f"({analysis['total_segments']} segs, sources={analysis['sources']})")

        return analysis


def main():
    parser = argparse.ArgumentParser(description="Re-merge transcripts for all videos")
    parser.add_argument("--dry-run", action="store_true", help="Don't upload, just report")
    parser.add_argument("--video-id", help="Process a single video by ID")
    args = parser.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    r2 = get_r2()

    if args.video_id:
        video_ids = [args.video_id]
    else:
        rows = sb.table("videos").select("id, title, language, status") \
                 .eq("status", "ready").order("created_at").execute()
        video_ids = [r["id"] for r in rows.data]
        print(f"Found {len(video_ids)} ready videos in Supabase\n")

    results = []
    for vid_id in video_ids:
        print(f"Processing {vid_id} ...")
        analysis = remerge_video(r2, vid_id, dry_run=args.dry_run)
        if analysis:
            results.append(analysis)
        print()

    # ── Summary Report ──
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    total_segs = sum(r["total_segments"] for r in results)
    all_sources: Counter = Counter()
    for r in results:
        all_sources.update(r["sources"])

    print(f"Videos processed: {len(results)}")
    print(f"Total segments:   {total_segs}")
    print(f"Source breakdown: {dict(all_sources)}")
    print()

    print("Per-video breakdown:")
    print(f"  {'Video ID':<40} {'Segs':>5}  Sources")
    print(f"  {'-'*40} {'-'*5}  {'-'*30}")
    for r in results:
        sources_str = "  ".join(f"{k}={v}" for k, v in sorted(r["sources"].items()))
        print(f"  {r['video_id']:<40} {r['total_segments']:>5}  {sources_str}")

    # Suspicious segments
    all_suspicious = [(r["video_id"], s) for r in results for s in r["suspicious"]]
    if all_suspicious:
        print(f"\nSuspicious segments ({len(all_suspicious)} total):")
        for vid_id, note in all_suspicious:
            print(f"  {vid_id}: {note.strip()}")
    else:
        print("\nNo suspicious segments found.")


if __name__ == "__main__":
    main()
