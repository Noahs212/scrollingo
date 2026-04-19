#!/usr/bin/env python3
"""
Wipe all video data from R2 + Supabase, then rerun every video in downloads/
through the fixed pipeline.

Usage:
    python3 scripts/wipe_and_rerun.py                # wipe + rerun all
    python3 scripts/wipe_and_rerun.py --wipe-only     # just wipe, no rerun
    python3 scripts/wipe_and_rerun.py --rerun-only    # skip wipe, just rerun
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# Load .env
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

import boto3
import requests

# ── Config ──
R2_ENDPOINT = os.environ["R2Endpoint"]
R2_ACCESS_KEY = os.environ["R2AccessKeyId"]
R2_SECRET_KEY = os.environ["R2SecretAccessKey"]
R2_BUCKET = os.environ["R2BucketName"]
SUPABASE_URL = os.environ["SupabaseUrl"]
SUPABASE_KEY = os.environ["SupabaseServiceKey"]

DOWNLOADS_DIR = Path(__file__).parent.parent / "downloads"
SCRIPTS_DIR = Path(__file__).parent

s3 = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name="auto",
)

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def supabase_delete(table, params=None):
    """Delete rows from a Supabase table."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.delete(url, headers=headers, params=params or {})
    if resp.status_code not in (200, 204):
        print(f"  WARNING: DELETE {table} status={resp.status_code} body={resp.text[:200]}")
    else:
        print(f"  Cleared {table}")


def wipe_r2():
    """Delete ALL objects in the R2 bucket under videos/ prefix."""
    print(f"\n{'='*60}")
    print("WIPING R2 BUCKET (videos/ prefix)")
    print("=" * 60)

    deleted = 0
    continuation_token = None

    while True:
        kwargs = {"Bucket": R2_BUCKET, "Prefix": "videos/", "MaxKeys": 1000}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        resp = s3.list_objects_v2(**kwargs)
        contents = resp.get("Contents", [])

        if not contents:
            break

        # Batch delete (up to 1000 at a time)
        objects = [{"Key": obj["Key"]} for obj in contents]
        s3.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": objects})
        deleted += len(objects)
        print(f"  Deleted {deleted} R2 objects...")

        if not resp.get("IsTruncated"):
            break
        continuation_token = resp.get("NextContinuationToken")

    print(f"  R2 wipe complete: {deleted} objects deleted\n")
    return deleted


def count_rows(table):
    """Return the row count for a table via Supabase REST HEAD request."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.get(url, headers={
        **headers,
        "Prefer": "count=exact",
        "Range-Unit": "items",
        "Range": "0-0",
    })
    content_range = resp.headers.get("Content-Range", "*/0")
    try:
        return int(content_range.split("/")[-1])
    except (ValueError, IndexError):
        return -1


def wipe_supabase():
    """Delete all video-related rows from Supabase (FK order)."""
    print("=" * 60)
    print("WIPING SUPABASE VIDEO DATA")
    print("=" * 60)

    # Delete in FK dependency order (children first)
    tables = [
        "review_logs",
        "flashcards",
        "segment_translations",
        "video_words",
        "word_definitions",
        "pipeline_jobs",
        "videos",
        # vocab_words can be kept — they're reusable across videos
    ]

    for table in tables:
        url = f"{SUPABASE_URL}/rest/v1/{table}"
        resp = requests.delete(url, headers=headers, params={"id": "neq.00000000-0000-0000-0000-000000000000"})
        if resp.status_code not in (200, 204):
            print(f"  {table}: DELETE status={resp.status_code} body={resp.text[:200]}")
        else:
            remaining = count_rows(table)
            if remaining > 0:
                print(f"  WARNING: {table} still has {remaining} rows after DELETE — RLS may be blocking")
                sys.exit(f"Wipe failed: {table} not fully cleared. Fix RLS or re-check service key.")
            print(f"  Cleared {table} (0 rows remaining)")

    print(f"  Supabase wipe complete\n")


def find_videos():
    """Find all .mp4 files in the downloads directory."""
    if not DOWNLOADS_DIR.exists():
        print(f"ERROR: Downloads directory not found: {DOWNLOADS_DIR}")
        sys.exit(1)

    videos = sorted(DOWNLOADS_DIR.glob("*.mp4"))
    print(f"Found {len(videos)} videos in {DOWNLOADS_DIR}\n")
    for i, v in enumerate(videos, 1):
        print(f"  {i:2d}. {v.name}")
    print()
    return videos


def run_pipeline(video_path, index, total):
    """Run the pipeline on a single video, capturing output."""
    print(f"\n{'='*60}")
    print(f"[{index}/{total}] Processing: {video_path.name}")
    print(f"{'='*60}")

    cmd = [
        sys.executable, str(SCRIPTS_DIR / "pipeline.py"),
        "--video", str(video_path),
    ]

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(SCRIPTS_DIR.parent),
            timeout=None,  # No timeout — OCR + LLM calls can take a very long time
        )
    except subprocess.TimeoutExpired:
        elapsed = time.time() - t0
        print(f"\n  TIMEOUT after {elapsed:.0f}s — skipping this video")
        return False

    elapsed = time.time() - t0

    # Print stdout (pipeline progress)
    if result.stdout:
        for line in result.stdout.splitlines():
            print(f"  {line}")

    if result.returncode != 0:
        print(f"\n  FAILED ({elapsed:.0f}s)")
        if result.stderr:
            # Print last 20 lines of stderr
            for line in result.stderr.splitlines()[-20:]:
                print(f"  STDERR: {line}")
        return False
    else:
        print(f"\n  SUCCESS ({elapsed:.0f}s)")
        return True


def verify_results():
    """Check Supabase for processed videos and spot-check data."""
    print(f"\n{'='*60}")
    print("VERIFICATION")
    print(f"{'='*60}")

    # Count videos
    url = f"{SUPABASE_URL}/rest/v1/videos"
    resp = requests.get(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }, params={"select": "id,title,language,status,duration_sec", "status": "eq.ready"})
    videos = resp.json() if resp.status_code == 200 else []
    print(f"\n  Videos marked ready: {len(videos)}")

    for v in videos:
        vid_id = v["id"]
        title = v.get("title", "?")[:30]
        lang = v.get("language", "?")
        dur = v.get("duration_sec", 0)

        # Count word_definitions
        wd_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/word_definitions",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            params={"video_id": f"eq.{vid_id}", "select": "id", "limit": "1"},
        )
        has_defs = len(wd_resp.json()) > 0 if wd_resp.status_code == 200 else False

        # Count segment_translations
        st_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/segment_translations",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            params={"video_id": f"eq.{vid_id}", "select": "id", "limit": "1"},
        )
        has_trans = len(st_resp.json()) > 0 if st_resp.status_code == 200 else False

        # Check R2 files exist
        r2_files = []
        for fname in ["video.mp4", "thumbnail.jpg", "bboxes.json"]:
            try:
                s3.head_object(Bucket=R2_BUCKET, Key=f"videos/{vid_id}/{fname}")
                r2_files.append(fname)
            except Exception:
                pass

        status = "OK" if has_defs and has_trans and len(r2_files) == 3 else "WARN"
        print(f"  [{status}] {title:<30} lang={lang} dur={dur}s defs={'Y' if has_defs else 'N'} trans={'Y' if has_trans else 'N'} r2={len(r2_files)}/3")

    return videos


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wipe-only", action="store_true")
    parser.add_argument("--rerun-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    if args.verify_only:
        verify_results()
        return

    if not args.rerun_only:
        wipe_r2()
        wipe_supabase()

    if args.wipe_only:
        print("Wipe complete. Use --rerun-only to process videos.")
        return

    # Find and process all videos
    videos = find_videos()
    results = {"success": [], "failed": []}

    for i, video_path in enumerate(videos, 1):
        ok = run_pipeline(video_path, i, len(videos))
        if ok:
            results["success"].append(video_path.name)
        else:
            results["failed"].append(video_path.name)

    # Summary
    print(f"\n{'='*60}")
    print("PIPELINE SUMMARY")
    print(f"{'='*60}")
    print(f"  Total:   {len(videos)}")
    print(f"  Success: {len(results['success'])}")
    print(f"  Failed:  {len(results['failed'])}")
    if results["failed"]:
        print(f"\n  Failed videos:")
        for name in results["failed"]:
            print(f"    - {name}")

    # Verify
    verify_results()


if __name__ == "__main__":
    main()
