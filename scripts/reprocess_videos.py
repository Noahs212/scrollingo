"""
Reprocess existing videos with the unified OCR+STT pipeline.
Uploads bboxes.json, stt.json, transcript.json to R2 for existing Supabase videos.

Usage:
    python3 scripts/reprocess_videos.py --videos 1,2,5,7,8
    python3 scripts/reprocess_videos.py --all
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import warnings
from pathlib import Path

# Load env
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
warnings.filterwarnings("ignore")

import boto3
import requests
from supabase import create_client
from openai import OpenAI

from pipeline import run_ocr, extract_audio, whisper_to_bboxes, merge_ocr_stt

VIDEOS_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos"
SUBTITLES_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles"

supabase = create_client(os.environ["SupabaseUrl"], os.environ["SupabaseServiceKey"])
s3 = boto3.client("s3",
    endpoint_url=os.environ["R2Endpoint"],
    aws_access_key_id=os.environ["R2AccessKeyId"],
    aws_secret_access_key=os.environ["R2SecretAccessKey"],
)
bucket = os.environ["R2BucketName"]
r2_url = os.environ["R2BucketUrl"]
groq_key = os.environ.get("GroqAPIKey")
groq = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=groq_key) if groq_key else None


def map_videos_to_supabase():
    """Match local video_N files to Supabase video IDs by comparing bbox text."""
    result = supabase.table("videos").select("id, title, cdn_url").eq("status", "ready").execute()
    vid_map = {}

    for v in result.data:
        bbox_url = v["cdn_url"].rsplit("/", 1)[0] + "/bboxes.json"
        try:
            r2_data = requests.get(bbox_url, timeout=5).json()
        except:
            continue

        r2_texts = set()
        for seg in r2_data.get("segments", [])[:3]:
            for det in seg.get("detections", []):
                r2_texts.add(det["text"][:10])

        for num in range(1, 19):
            dense_file = SUBTITLES_DIR / f"video_{num}_dense.json"
            if not dense_file.exists():
                continue
            d = json.load(open(dense_file))
            for seg in d.get("segments", [])[:3]:
                for det in seg.get("detections", []):
                    if det["text"][:10] in r2_texts:
                        vid_map[f"video_{num}"] = v["id"]
                        break

    return vid_map


def run_stt_on_video(video_path, video_id):
    """Run Groq Whisper STT and return bboxes-format data."""
    if not groq:
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = extract_audio(video_path, tmpdir)
        if not audio_path:
            return None

        try:
            transcript = groq.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=open(audio_path, "rb"),
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"],
            )
            words = [{"word": w.word, "start": w.start, "end": w.end}
                     for w in (getattr(transcript, "words", []) or [])]
            segments = [{"text": s.text, "start": s.start, "end": s.end}
                        for s in (getattr(transcript, "segments", []) or [])]

            probe = json.loads(subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
                capture_output=True, text=True).stdout)
            vs = [s for s in probe["streams"] if s["codec_type"] == "video"][0]
            dur_ms = int(float(vs.get("duration", 0)) * 1000)

            return whisper_to_bboxes({"words": words, "segments": segments, "text": transcript.text},
                                     video_id, dur_ms)
        except Exception as e:
            print(f"    STT error: {e}")
            return None


def upload_json(data, video_id, filename):
    """Upload JSON data to R2."""
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(data, tmp, ensure_ascii=False)
    tmp.close()
    s3.upload_file(tmp.name, bucket, f"videos/{video_id}/{filename}",
                   ExtraArgs={"ContentType": "application/json"})
    os.unlink(tmp.name)


def process_video(vnum, vid_id):
    """Run unified pipeline on one video and upload results to R2."""
    video_path = str(VIDEOS_DIR / f"{vnum}.mp4")
    print(f"\n{'='*50}")
    print(f"{vnum} → {vid_id[:8]}")
    t0 = time.time()

    # Dense OCR
    print("  Running dense OCR...")
    bbox_data_ocr = run_ocr(video_path, vid_id)

    # STT
    print("  Running STT...")
    bbox_data_stt = run_stt_on_video(video_path, vid_id)
    if bbox_data_stt:
        stt_segs = len(bbox_data_stt.get("segments", []))
        print(f"    STT: {stt_segs} segments")
    else:
        print("    STT: no result")

    # Merge
    transcript_data = None
    if bbox_data_stt:
        transcript_data = merge_ocr_stt(bbox_data_ocr, bbox_data_stt)
        ocr_matched = sum(1 for s in transcript_data["segments"] if s["source"] == "ocr+stt")
        stt_only = sum(1 for s in transcript_data["segments"] if s["source"] == "stt_only")
        print(f"    Transcript: {len(transcript_data['segments'])} segs ({ocr_matched} OCR+STT, {stt_only} STT-only)")

    # Upload to R2
    upload_json(bbox_data_ocr, vid_id, "bboxes.json")
    if bbox_data_stt:
        upload_json(bbox_data_stt, vid_id, "stt.json")
    if transcript_data:
        upload_json(transcript_data, vid_id, "transcript.json")

    # Update DB
    supabase.table("videos").update({"subtitle_source": "both" if bbox_data_stt else "ocr"}).eq("id", vid_id).execute()

    elapsed = time.time() - t0
    print(f"    Done ({elapsed:.0f}s)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--videos", help="Comma-separated video numbers (e.g. 1,2,5)")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    print("Mapping local videos to Supabase IDs...")
    vid_map = map_videos_to_supabase()
    print(f"Found {len(vid_map)} mappings\n")

    if args.videos:
        nums = [int(n) for n in args.videos.split(",")]
        to_process = [(f"video_{n}", vid_map[f"video_{n}"]) for n in nums if f"video_{n}" in vid_map]
    elif args.all:
        to_process = list(vid_map.items())
    else:
        print("Specify --videos or --all")
        return

    for vnum, vid_id in to_process:
        process_video(vnum, vid_id)

    print(f"\n{'='*50}")
    print(f"All done! Processed {len(to_process)} videos.")


if __name__ == "__main__":
    main()
