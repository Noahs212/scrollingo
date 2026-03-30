"""
Scrollingo Video Processing Pipeline (M3 + M3.5)

Processes a video through one of two subtitle paths:
  OCR path:  For videos with burned-in subtitles (Douyin, TikTok reposts)
  STT path:  For videos without burned-in subtitles (original content, interviews)

Steps:
1. Normalize to 720p with FFmpeg
2. Auto-detect subtitle source (OCR or STT) — sample frames for text
3. OCR: Run VideOCR (SSIM dedup) to extract bounding boxes
   STT: Extract audio → Groq Whisper → word-level timestamps
4. Upload video + thumbnail + bboxes.json to R2
5. Word segmentation (jieba for Chinese)
6. Generate translations + definitions via Claude Haiku 3.5 (OpenRouter)
7. Insert vocab_words, word_definitions, video_words into Supabase
8. Mark video status='ready'

Usage:
    python3 scripts/pipeline.py --video ~/downloads/chinese_video.mp4
    python3 scripts/pipeline.py --video ~/downloads/english_video.mp4 --force-stt
    python3 scripts/pipeline.py --video ~/downloads/chinese_video.mp4 --force-ocr

Requires:
    pip install supabase jieba openai  # openai SDK works with OpenRouter + Groq
    Environment variables in .env: OpenrouterAPIKey, SupabaseUrl, SupbaseAnonKey
    Optional: GroqAPIKey (required only for STT path)
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import warnings
from pathlib import Path

# Load .env
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip())

# Validate required env vars
OPENROUTER_KEY = os.environ.get("OpenrouterAPIKey")
SUPABASE_URL = os.environ.get("SupabaseUrl")
SUPABASE_KEY = os.environ.get("SupabaseServiceKey")
R2_BUCKET_URL = os.environ.get("R2BucketUrl", "")
R2_ENDPOINT = os.environ.get("R2Endpoint", "")
R2_ACCESS_KEY = os.environ.get("R2AccessKeyId", "")
R2_SECRET_KEY = os.environ.get("R2SecretAccessKey", "")
R2_BUCKET_NAME = os.environ.get("R2BucketName", "scrollingo-media")

if not OPENROUTER_KEY:
    print("ERROR: OpenrouterAPIKey not found in .env")
    sys.exit(1)
if not SUPABASE_KEY:
    print("ERROR: SupabaseServiceKey is required (pipeline needs to bypass RLS)")
    sys.exit(1)
if not SUPABASE_URL:
    print("ERROR: SupabaseUrl not found in .env")
    sys.exit(1)

# Suppress PaddleOCR model download warnings only
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
warnings.filterwarnings("ignore", module="paddleocr")
warnings.filterwarnings("ignore", module="paddle")

from supabase import create_client
from openai import OpenAI
import boto3
from pypinyin import pinyin, Style

# Initialize clients
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
llm = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=OPENROUTER_KEY)
GROQ_KEY = os.environ.get("GroqAPIKey")
groq = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=GROQ_KEY) if GROQ_KEY else None

def get_pinyin(word: str, language: str) -> str | None:
    """Generate pinyin with tone marks for a Chinese word. Returns None for non-Chinese."""
    if language != "zh":
        return None
    result = pinyin(word, style=Style.TONE)
    return " ".join([item[0] for item in result])


VIDEOS_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos"
OUTPUT_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles"

LLM_MODEL = "anthropic/claude-3.5-haiku"


# ─── Step 1: Normalize Video ───

def normalize_video(input_path: str, output_dir: str) -> tuple[str, int]:
    """Normalize video to 720p progressive MP4. Returns (output_path, duration_sec)."""
    output_path = os.path.join(output_dir, "video.mp4")

    # Get duration first
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", input_path],
        capture_output=True, text=True,
    ).stdout)
    vs = [s for s in probe["streams"] if s["codec_type"] == "video"][0]
    duration_sec = int(float(vs.get("duration", 0)))
    width, height = int(vs["width"]), int(vs["height"])

    # Only re-encode if not already 720x1280
    if width == 720 and height == 1280:
        shutil.copy2(input_path, output_path)
        print(f"  Video already 720x1280, copied as-is ({duration_sec}s)")
    else:
        subprocess.run([
            "ffmpeg", "-y", "-i", input_path,
            "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-profile:v", "main",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-t", "60",
            output_path,
        ], capture_output=True)
        print(f"  Normalized to 720x1280 ({duration_sec}s)")

    return output_path, duration_sec


def extract_thumbnail(video_path: str, output_dir: str, duration_sec: int) -> str:
    """Extract thumbnail at ~30% into the video — usually a more interesting frame than the first second."""
    thumb_path = os.path.join(output_dir, "thumbnail.jpg")
    seek_sec = max(1, int(duration_sec * 0.3))
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path, "-ss", str(seek_sec),
        "-vframes", "1", "-q:v", "2", thumb_path,
    ], capture_output=True)
    return thumb_path


# ─── Step 1b: Extract Audio ───

def extract_audio(video_path: str, output_dir: str) -> str | None:
    """Extract audio track from video. Returns path to mp3, or None if no audio."""
    # Check for audio stream
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
        capture_output=True, text=True,
    ).stdout)
    audio_streams = [s for s in probe.get("streams", []) if s["codec_type"] == "audio"]
    if not audio_streams:
        print("  No audio stream found in video")
        return None

    audio_path = os.path.join(output_dir, "audio.mp3")
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "libmp3lame", "-q:a", "4", audio_path,
    ], capture_output=True)
    return audio_path


# ─── Auto-detect Subtitle Source ───

def detect_subtitle_source(video_path: str, duration_sec: int) -> str:
    """Sample 3 frames and run OCR to detect if video has burned-in subtitles.

    Returns 'ocr' if ≥2 frames have text, 'stt' otherwise.
    """
    import cv2
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(lang="ch", use_doc_orientation_classify=False,
                    use_doc_unwarping=False, use_textline_orientation=False)

    cap = cv2.VideoCapture(video_path)
    text_frames = 0

    for pct in (0.25, 0.50, 0.75):
        seek_ms = int(duration_sec * 1000 * pct)
        cap.set(cv2.CAP_PROP_POS_MSEC, seek_ms)
        ok, frame = cap.read()
        if not ok:
            continue

        result = ocr.ocr(frame, cls=False)
        if result and result[0]:
            detections = [r for r in result[0] if r[1][1] >= 0.60 and len(r[1][0].strip()) >= 2]
            if detections:
                text_frames += 1

    cap.release()
    source = "ocr" if text_frames >= 2 else "stt"
    print(f"  Auto-detected subtitle source: {source} ({text_frames}/3 frames with text)")
    return source


# ─── STT: Groq Whisper ───

def run_stt(audio_path: str, language: str | None = None) -> dict:
    """Send audio to Groq Whisper Turbo and get word-level timestamps."""
    if not groq:
        print("ERROR: GroqAPIKey not found in .env — required for STT path")
        sys.exit(1)

    kwargs = {
        "model": "whisper-large-v3-turbo",
        "file": open(audio_path, "rb"),
        "response_format": "verbose_json",
        "timestamp_granularities": ["word", "segment"],
    }
    if language:
        # Whisper uses ISO 639-1 codes
        kwargs["language"] = language

    print("  Calling Groq Whisper Turbo...")
    transcript = groq.audio.transcriptions.create(**kwargs)
    raw_words = getattr(transcript, "words", []) or []
    raw_segments = getattr(transcript, "segments", []) or []
    # Convert Pydantic objects to dicts
    words = [{"word": w.word, "start": w.start, "end": w.end} for w in raw_words]
    segments = [{"text": s.text, "start": s.start, "end": s.end} for s in raw_segments]
    print(f"  Got {len(words)} words, {len(segments)} segments")
    return {"words": words, "segments": segments, "text": transcript.text}


def whisper_to_bboxes(whisper_result: dict, video_id: str, duration_ms: int,
                      resolution: dict = None) -> dict:
    """Convert Whisper output to the same bboxes.json format as OCR.

    Generates synthetic character positions centered at the bottom of the frame.
    """
    if resolution is None:
        resolution = {"width": 720, "height": 1280}

    vw, vh = resolution["width"], resolution["height"]
    # Subtitle position: centered, at ~82% of frame height
    sub_y = int(vh * 0.82)
    sub_h = int(vh * 0.05)
    max_text_width = int(vw * 0.85)

    segments = []
    for seg in whisper_result.get("segments", []):
        text = seg.get("text", "").strip()
        if not text:
            continue

        start_ms = int(seg["start"] * 1000)
        end_ms = int(seg["end"] * 1000)

        # Build character-level bboxes (evenly spaced)
        char_width = min(max_text_width // max(len(text), 1), int(vw * 0.06))
        total_width = char_width * len(text)
        start_x = (vw - total_width) // 2

        chars = []
        for i, ch in enumerate(text):
            chars.append({
                "char": ch,
                "x": start_x + i * char_width,
                "y": sub_y,
                "width": char_width,
                "height": sub_h,
            })

        det_bbox = {
            "x": start_x,
            "y": sub_y,
            "width": total_width,
            "height": sub_h,
        }

        segments.append({
            "start_ms": start_ms,
            "end_ms": end_ms,
            "detections": [{
                "text": text,
                "confidence": 1.0,
                "bbox": det_bbox,
                "chars": chars,
            }],
        })

    return {
        "video": video_id,
        "resolution": resolution,
        "duration_ms": duration_ms,
        "subtitle_source": "stt",
        "segments": segments,
    }


# ─── STT Segment Chunking ───

CJK_CHAR_LIMIT = 20     # max CJK chars per chunk (2 lines × ~10 chars in 211px at 20px)
LATIN_CHAR_LIMIT = 35    # max Latin chars per chunk (2 lines × ~17 chars)
PAUSE_THRESHOLD_S = 0.3  # 300ms gap = natural speech pause

_PUNCT_SPLIT = re.compile(r'(?<=[。！？，、.!?,;])\s*')


def _is_cjk_dominant(text: str) -> bool:
    cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff' or '\u3400' <= c <= '\u4dbf')
    return cjk > len(text) * 0.3


def _char_limit(text: str) -> int:
    return CJK_CHAR_LIMIT if _is_cjk_dominant(text) else LATIN_CHAR_LIMIT


def _get_words_for_segment(seg_start_s: float, seg_end_s: float, whisper_words: list) -> list:
    """Find Whisper word timestamps that fall within a segment's time range."""
    return [w for w in whisper_words
            if w["start"] >= seg_start_s - 0.05 and w["end"] <= seg_end_s + 0.05]


def _split_at_punctuation(text: str) -> list[str]:
    """Split text at sentence-ending punctuation."""
    parts = _PUNCT_SPLIT.split(text)
    return [p for p in parts if p.strip()]


def _find_pause_split(text: str, seg_words: list) -> int | None:
    """Find the character index where the longest speech pause (>300ms) occurs.

    Maps Whisper word boundaries back to character positions in the text.
    Returns the character index to split at, or None if no pause found.
    """
    if len(seg_words) < 2:
        return None

    best_gap = 0
    best_char_idx = None
    char_pos = 0

    for i in range(len(seg_words) - 1):
        # Advance char_pos past this word
        word_text = seg_words[i]["word"]
        word_idx = text.find(word_text, char_pos)
        if word_idx >= 0:
            char_pos = word_idx + len(word_text)

        gap = seg_words[i + 1]["start"] - seg_words[i]["end"]
        if gap > PAUSE_THRESHOLD_S and gap > best_gap:
            best_gap = gap
            best_char_idx = char_pos

    return best_char_idx


def _hard_split(text: str, limit: int) -> tuple[str, str]:
    """Force split at a word boundary within the character limit."""
    if _is_cjk_dominant(text):
        # CJK: use jieba for word boundaries
        import jieba
        words = list(jieba.cut(text))
        first_part = ""
        for w in words:
            if len(first_part) + len(w) > limit:
                break
            first_part += w
        if not first_part:
            first_part = text[:limit]  # Absolute fallback
        return first_part, text[len(first_part):]
    else:
        # Latin: split at last space before limit
        cut = text[:limit]
        last_space = cut.rfind(" ")
        if last_space > 0:
            return text[:last_space], text[last_space + 1:]
        return text[:limit], text[limit:]


def _interpolate_timestamps(text: str, chunk_text: str, chunk_start_char: int,
                            seg_start_ms: int, seg_end_ms: int) -> tuple[int, int]:
    """Linearly interpolate timestamps for a chunk based on character position."""
    total_len = max(len(text), 1)
    chunk_end_char = chunk_start_char + len(chunk_text)
    start_ms = seg_start_ms + int((chunk_start_char / total_len) * (seg_end_ms - seg_start_ms))
    end_ms = seg_start_ms + int((chunk_end_char / total_len) * (seg_end_ms - seg_start_ms))
    return start_ms, end_ms


def _build_stt_segment(text: str, start_ms: int, end_ms: int, resolution: dict) -> dict:
    """Build a segment dict with synthetic bbox/chars (same format as whisper_to_bboxes)."""
    vw, vh = resolution.get("width", 720), resolution.get("height", 1280)
    char_w = min(int(vw * 0.85) // max(len(text), 1), int(vw * 0.06))
    total_w = char_w * len(text)
    start_x = (vw - total_w) // 2
    sub_y = int(vh * 0.82)
    sub_h = int(vh * 0.05)

    # Build chars — word-level for Latin, char-level for CJK
    chars = []
    i = 0
    while i < len(text):
        c = text[i]
        c_code = ord(c)
        is_cjk = (0x4e00 <= c_code <= 0x9fff or 0x3400 <= c_code <= 0x4dbf
                   or 0x3040 <= c_code <= 0x30ff or 0xac00 <= c_code <= 0xd7af)
        if is_cjk:
            chars.append({"char": c, "x": start_x + i * char_w, "y": sub_y,
                          "width": char_w, "height": sub_h})
            i += 1
        elif c.strip() == "":
            i += 1
        else:
            word_start = i
            while i < len(text) and text[i].strip() and not (0x4e00 <= ord(text[i]) <= 0x9fff):
                i += 1
            word = text[word_start:i]
            chars.append({"char": word, "x": start_x + word_start * char_w, "y": sub_y,
                          "width": len(word) * char_w, "height": sub_h})

    return {
        "start_ms": start_ms,
        "end_ms": end_ms,
        "detections": [{
            "text": text,
            "confidence": 1.0,
            "bbox": {"x": start_x, "y": sub_y, "width": total_w, "height": sub_h},
            "chars": chars,
        }],
    }


def _recursive_chunk(text: str, limit: int, seg_words: list,
                     seg_start_ms: int, seg_end_ms: int, resolution: dict) -> list[dict]:
    """Recursively split text into chunks that fit the character limit."""
    text = text.strip()
    if not text:
        return []

    if len(text) <= limit:
        return [_build_stt_segment(text, seg_start_ms, seg_end_ms, resolution)]

    # Tier A: Try punctuation split
    parts = _split_at_punctuation(text)
    if len(parts) > 1:
        chunks = []
        char_offset = 0
        for part in parts:
            start_ms, end_ms = _interpolate_timestamps(text, part, char_offset, seg_start_ms, seg_end_ms)
            # Find words for this sub-part
            sub_words = _get_words_for_segment(start_ms / 1000, end_ms / 1000, seg_words)
            chunks.extend(_recursive_chunk(part, limit, sub_words, start_ms, end_ms, resolution))
            char_offset += len(part)
        return chunks

    # Tier B: Try speech pause split
    pause_idx = _find_pause_split(text, seg_words)
    if pause_idx and 0 < pause_idx < len(text):
        first = text[:pause_idx].strip()
        second = text[pause_idx:].strip()
        if first and second:
            first_start, first_end = _interpolate_timestamps(text, first, 0, seg_start_ms, seg_end_ms)
            second_start, second_end = _interpolate_timestamps(text, second, pause_idx, seg_start_ms, seg_end_ms)
            sub_words_1 = _get_words_for_segment(first_start / 1000, first_end / 1000, seg_words)
            sub_words_2 = _get_words_for_segment(second_start / 1000, second_end / 1000, seg_words)
            return (_recursive_chunk(first, limit, sub_words_1, first_start, first_end, resolution) +
                    _recursive_chunk(second, limit, sub_words_2, second_start, second_end, resolution))

    # Tier C: Hard split at word boundary
    first, second = _hard_split(text, limit)
    first_start, first_end = _interpolate_timestamps(text, first, 0, seg_start_ms, seg_end_ms)
    second_start, second_end = _interpolate_timestamps(text, second, len(first), seg_start_ms, seg_end_ms)
    return ([_build_stt_segment(first, first_start, first_end, resolution)] +
            _recursive_chunk(second, limit, seg_words, second_start, second_end, resolution))


def chunk_stt_segments(bbox_data: dict, whisper_result: dict) -> dict:
    """Split oversized STT segments into display-friendly chunks.

    Uses a 3-tier strategy: punctuation → speech pauses → hard word boundary split.
    Preserves Whisper word-level timestamps for accurate timing.
    """
    whisper_words = whisper_result.get("words", [])
    resolution = bbox_data.get("resolution", {"width": 720, "height": 1280})
    new_segments = []

    for seg in bbox_data.get("segments", []):
        dets = seg.get("detections", [])
        if not dets:
            new_segments.append(seg)
            continue

        text = dets[0]["text"].strip()
        limit = _char_limit(text)

        if len(text) <= limit:
            new_segments.append(seg)
            continue

        seg_start_ms = seg["start_ms"]
        seg_end_ms = seg["end_ms"]
        seg_words = _get_words_for_segment(seg_start_ms / 1000, seg_end_ms / 1000, whisper_words)

        chunks = _recursive_chunk(text, limit, seg_words, seg_start_ms, seg_end_ms, resolution)
        new_segments.extend(chunks)

    result = dict(bbox_data)
    result["segments"] = new_segments
    return result


def _text_similarity(a: str, b: str) -> float:
    """Character-level Jaccard similarity between two strings."""
    if not a or not b:
        return 0.0
    set_a = set(a.strip())
    set_b = set(b.strip())
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def merge_ocr_stt(ocr_data: dict, stt_data: dict,
                  time_tolerance_ms: int = 500) -> dict:
    """Merge OCR content with STT timing into a unified transcript.

    Rules:
    - OCR content wins (more accurate text recognition)
    - STT timing wins (word-level alignment to speech)
    - ≥50% char overlap = same subtitle → use OCR text + STT timing
    - <50% overlap = title/watermark → exclude from transcript
    - STT segments with no OCR match → gap fill (use STT text)

    Returns transcript data with only spoken subtitles.
    """
    ocr_segments = ocr_data.get("segments", [])
    stt_segments = stt_data.get("segments", [])
    resolution = ocr_data.get("resolution", {"width": 720, "height": 1280})
    res_h = resolution.get("height", 1280)

    # Find persistent OCR text (appears in >70% of segments) — likely watermarks
    text_counts: dict[str, int] = {}
    for seg in ocr_segments:
        seen = set()
        for det in seg.get("detections", []):
            t = det["text"].strip()
            if t and t not in seen:
                text_counts[t] = text_counts.get(t, 0) + 1
                seen.add(t)
    total_segs = max(len(ocr_segments), 1)
    persistent_texts = {t for t, c in text_counts.items() if c / total_segs >= 0.7}

    transcript_segments = []

    for stt_seg in stt_segments:
        stt_text = ""
        for det in stt_seg.get("detections", []):
            stt_text += det.get("text", "")
        stt_text = stt_text.strip()
        if not stt_text:
            continue

        stt_start = stt_seg["start_ms"]
        stt_end = stt_seg["end_ms"]

        # Find overlapping OCR detections (within time tolerance)
        best_ocr_text = None
        best_sim = 0.0

        for ocr_seg in ocr_segments:
            # Check time overlap
            if (ocr_seg["end_ms"] + time_tolerance_ms < stt_start or
                    ocr_seg["start_ms"] - time_tolerance_ms > stt_end):
                continue

            # Check each detection in this OCR segment
            for det in ocr_seg.get("detections", []):
                det_text = det["text"].strip()

                # Skip persistent text (watermarks/disclaimers)
                if det_text in persistent_texts:
                    continue

                # Skip text in top 40% of frame (likely titles, not spoken subtitles)
                if det["bbox"]["y"] / res_h < 0.40:
                    continue

                sim = _text_similarity(det_text, stt_text)
                if sim > best_sim:
                    best_sim = sim
                    best_ocr_text = det_text

        if best_sim >= 0.5 and best_ocr_text:
            # Matched: OCR content + STT timing
            text = best_ocr_text
            source = "ocr+stt"
        else:
            # No OCR match: STT gap fill
            text = stt_text
            source = "stt_only"

        # Build detection in the same format as OCR bboxes.json
        # Centered at bottom of frame for display
        vw, vh = resolution.get("width", 720), resolution.get("height", 1280)
        char_w = min(int(vw * 0.85) // max(len(text), 1), int(vw * 0.06))
        total_w = char_w * len(text)
        start_x = (vw - total_w) // 2
        sub_y = int(vh * 0.82)
        sub_h = int(vh * 0.05)

        # Build chars — word-level for Latin, char-level for CJK
        chars = []
        i = 0
        while i < len(text):
            c = text[i]
            c_code = ord(c)
            is_cjk = (0x4e00 <= c_code <= 0x9fff or 0x3400 <= c_code <= 0x4dbf
                       or 0x3040 <= c_code <= 0x30ff or 0xac00 <= c_code <= 0xd7af)
            if is_cjk:
                chars.append({"char": c, "x": start_x + i * char_w, "y": sub_y,
                              "width": char_w, "height": sub_h})
                i += 1
            elif c.strip() == "":
                i += 1
            else:
                word_start = i
                while i < len(text) and text[i].strip() and not (0x4e00 <= ord(text[i]) <= 0x9fff):
                    i += 1
                word = text[word_start:i]
                chars.append({"char": word, "x": start_x + word_start * char_w, "y": sub_y,
                              "width": len(word) * char_w, "height": sub_h})

        transcript_segments.append({
            "start_ms": stt_start,
            "end_ms": stt_end,
            "source": source,
            "spoken": True,
            "detections": [{
                "text": text,
                "confidence": 1.0,
                "bbox": {"x": start_x, "y": sub_y, "width": total_w, "height": sub_h},
                "chars": chars,
            }],
        })

    # Sort by start time
    transcript_segments.sort(key=lambda s: s["start_ms"])

    return {
        "video": ocr_data.get("video", ""),
        "resolution": resolution,
        "duration_ms": ocr_data.get("duration_ms", 0),
        "subtitle_source": "both",
        "segments": transcript_segments,
    }


def get_auto_title(bbox_data: dict) -> str:
    """Use the first subtitle caption as the video title."""
    for seg in bbox_data.get("segments", []):
        for det in seg.get("detections", []):
            text = det.get("text", "").strip()
            if len(text) >= 2:
                return text
    return "Untitled"


# ─── Step 2: Upload to R2 ───

def get_r2_client():
    """Create boto3 S3 client for Cloudflare R2."""
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )


def upload_to_r2(local_path: str, r2_key: str) -> str:
    """Upload a file to R2 and return the public CDN URL."""
    if not R2_ENDPOINT or not R2_ACCESS_KEY:
        print(f"  [R2 SKIP] No R2 credentials — would upload {r2_key}")
        return f"https://r2-placeholder.dev/{r2_key}"

    # Determine content type
    ext = os.path.splitext(local_path)[1].lower()
    content_types = {
        ".mp4": "video/mp4",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".json": "application/json",
        ".mp3": "audio/mpeg",
    }
    content_type = content_types.get(ext, "application/octet-stream")

    r2 = get_r2_client()
    r2.upload_file(
        local_path,
        R2_BUCKET_NAME,
        r2_key,
        ExtraArgs={
            "ContentType": content_type,
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )

    public_url = f"{R2_BUCKET_URL}/{r2_key}"
    print(f"  Uploaded → {public_url}")
    return public_url


# ─── Step 3: Insert Video Row ───

def insert_video_row(video_id: str, title: str, language: str, duration_sec: int,
                     cdn_url: str, thumbnail_url: str, subtitle_source: str = "ocr") -> dict:
    """Insert a row into the videos table."""
    row = {
        "id": video_id,
        "title": title,
        "language": language,
        "duration_sec": duration_sec,
        "r2_video_key": f"videos/{video_id}/video.mp4",
        "cdn_url": cdn_url,
        "thumbnail_url": thumbnail_url,
        "status": "processing",
        "subtitle_source": subtitle_source,
        "seeded_by": "pipeline",
    }
    result = supabase.table("videos").insert(row).execute()
    print(f"  Inserted video row: {video_id}")
    return result.data[0]


# ─── Step 4: Run OCR ───

def run_ocr(video_path: str, video_id: str) -> dict:
    """Run dense OCR extraction — our best configuration.

    Uses the optimized dense approach from extract_subtitles_dense.py:
    - Full resolution (no scaling)
    - 100ms frame interval with change detection (threshold=2.0)
    - Force OCR every 5 frames (500ms safety net)
    - CJK single char support, Latin min 2 chars
    - Fuzzy dedup with 500ms gap bridging
    - Post-process merge for flickering subtitles (1.5s window)
    - Mixed CJK/Latin word-level char boxes
    """
    # Import the dense extraction module directly
    sys.path.insert(0, str(Path(__file__).parent))
    from extract_subtitles_dense import (
        get_video_info, extract_frames_ffmpeg, subtitle_region_changed,
        run_ocr_on_frame, build_detection as dense_build_detection,
        deduplicate_subtitles, _ocr_worker,
        FRAME_INTERVAL_MS, CONF_THRESHOLD, CHANGE_THRESHOLD,
        FORCE_OCR_INTERVAL, NUM_WORKERS,
    )
    from concurrent.futures import ProcessPoolExecutor, as_completed

    w, h, dur = get_video_info(video_path)
    print(f"  Dense OCR: {w}x{h}, {dur:.0f}s, {FRAME_INTERVAL_MS}ms interval, threshold={CHANGE_THRESHOLD}...")

    with tempfile.TemporaryDirectory() as ocr_tmpdir:
        # Extract all frames
        frames, w, h, dur = extract_frames_ffmpeg(video_path, ocr_tmpdir, FRAME_INTERVAL_MS)
        total = len(frames)

        # Change detection — skip frames where subtitle region unchanged
        frames_to_ocr = []
        prev_fp = None
        for idx, (fp, ts_ms) in enumerate(frames):
            needs_ocr = (idx == 0 or
                         idx % FORCE_OCR_INTERVAL == 0 or
                         (prev_fp and subtitle_region_changed(prev_fp, fp)))
            prev_fp = fp
            if needs_ocr:
                frames_to_ocr.append((idx, fp, ts_ms))

        skipped = total - len(frames_to_ocr)
        print(f"  {total} frames, OCR {len(frames_to_ocr)} (skipped {skipped}, {skipped*100//max(total,1)}% savings)")

        # OCR changed frames in parallel
        ocr_results = {}
        with ProcessPoolExecutor(max_workers=NUM_WORKERS) as executor:
            future_to_idx = {}
            for idx, fp, ts_ms in frames_to_ocr:
                future = executor.submit(_ocr_worker, (fp, ts_ms))
                future_to_idx[future] = idx
            done = 0
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                ocr_results[idx] = future.result()
                done += 1
                if done % 50 == 0:
                    print(f"    {done}/{len(frames_to_ocr)}...", end=" ", flush=True)

        # Fill skipped frames by carrying forward
        frame_results = []
        last_result = None
        for idx, (fp, ts_ms) in enumerate(frames):
            if idx in ocr_results:
                last_result = ocr_results[idx]
                frame_results.append(last_result)
            elif last_result:
                frame_results.append({"timestamp_ms": ts_ms, "detections": last_result["detections"]})
            else:
                frame_results.append({"timestamp_ms": ts_ms, "detections": []})

        # Deduplicate with fuzzy matching + gap bridging + flicker merge
        segments = deduplicate_subtitles(frame_results)

    bbox_data = {
        "video": video_id,
        "resolution": {"width": w, "height": h},
        "duration_ms": round(dur * 1000),
        "subtitle_source": "ocr",
        "frame_interval_ms": FRAME_INTERVAL_MS,
        "segments": segments,
    }

    print(f"  OCR complete: {len(segments)} segments")
    return bbox_data


# ─── Step 4b: Auto-detect Content Language ───

# Languages we support as content/source languages
SUPPORTED_SOURCE_LANGUAGES = {"zh", "en", "ja", "fr", "es"}

def detect_content_language(bbox_data: dict) -> str | None:
    """
    Auto-detect the content language from OCR text.
    Uses langdetect on the concatenated subtitle text.
    Returns ISO 639-1 code or None if detection fails.
    """
    try:
        from langdetect import detect, DetectorFactory
        # Make detection deterministic
        DetectorFactory.seed = 0

        # Gather all detected text
        all_text = []
        for seg in bbox_data.get("segments", []):
            for det in seg.get("detections", []):
                text = det.get("text", "").strip()
                if len(text) >= 2:
                    all_text.append(text)

        if not all_text:
            return None

        combined = " ".join(all_text)
        detected = detect(combined)

        # langdetect returns 'zh-cn' or 'zh-tw' for Chinese
        if detected.startswith("zh"):
            detected = "zh"

        if detected in SUPPORTED_SOURCE_LANGUAGES:
            return detected

        print(f"  WARNING: Detected language '{detected}' is not a supported source language")
        return detected

    except Exception as e:
        print(f"  WARNING: Language detection failed: {e}")
        return None


# ─── Step 5: Word Segmentation ───

def segment_words(bbox_data: dict, language: str) -> tuple[list[str], list[dict]]:
    """Extract unique words from OCR text using jieba for Chinese."""
    import jieba

    # Filter out punctuation and whitespace-only tokens
    PUNCT_RE = re.compile(r'^[\s\W\d]+$', re.UNICODE)

    all_words = set()
    word_occurrences = []

    for seg in bbox_data["segments"]:
        for det in seg["detections"]:
            text = det["text"]
            if language == "zh":
                words = list(jieba.cut(text))
            else:
                words = text.split()

            for word in words:
                word = word.strip()
                if not word or PUNCT_RE.match(word):
                    continue
                all_words.add(word)
                word_occurrences.append({
                    "word": word,
                    "start_ms": seg["start_ms"],
                    "end_ms": seg["end_ms"],
                    "display_text": word,
                    "sentence": text,
                })

    print(f"  Segmentation: {len(all_words)} unique words, {len(word_occurrences)} occurrences")
    return list(all_words), word_occurrences


# ─── Step 6: LLM Definitions ───

# Target languages for definitions (user's native language options)
TARGET_LANGUAGES = [
    {"code": "en", "name": "English"},
    {"code": "es", "name": "Spanish"},
    {"code": "zh", "name": "Chinese"},
    {"code": "ja", "name": "Japanese"},
    {"code": "ko", "name": "Korean"},
    {"code": "hi", "name": "Hindi"},
    {"code": "fr", "name": "French"},
    {"code": "de", "name": "German"},
    {"code": "pt", "name": "Portuguese"},
    {"code": "ar", "name": "Arabic"},
    {"code": "it", "name": "Italian"},
    {"code": "ru", "name": "Russian"},
]

# Localized prompt labels per target language
LOCALIZED_LABELS = {
    "en": {"translate": "Translate", "word": "word", "into": "into", "context": "as used in this context",
           "translation": "Translation", "definition": "Contextual Definition", "pos": "Part of Speech",
           "important": "IMPORTANT: Only output the translated WORD, not the whole sentence.",
           "format": "Format your response exactly as follows:"},
    "zh": {"translate": "翻译", "word": "词", "into": "翻译成", "context": "在此语境中使用",
           "translation": "翻译", "definition": "语境释义", "pos": "词性",
           "important": "重要：只输出翻译后的词，不要输出整个句子。",
           "format": "请按以下格式回答："},
    "ja": {"translate": "翻訳", "word": "単語", "into": "に翻訳", "context": "この文脈で使用",
           "translation": "翻訳", "definition": "文脈的定義", "pos": "品詞",
           "important": "重要：翻訳された単語のみを出力してください。文全体ではありません。",
           "format": "次の形式で回答してください："},
    "ko": {"translate": "번역", "word": "단어", "into": "로 번역", "context": "이 맥락에서 사용됨",
           "translation": "번역", "definition": "맥락적 정의", "pos": "품사",
           "important": "중요: 번역된 단어만 출력하세요. 전체 문장이 아닙니다.",
           "format": "다음 형식으로 응답하세요:"},
    "es": {"translate": "Traducir", "word": "palabra", "into": "al", "context": "tal como se usa en este contexto",
           "translation": "Traducción", "definition": "Definición contextual", "pos": "Categoría gramatical",
           "important": "IMPORTANTE: Solo escribe la PALABRA traducida, no la oración completa.",
           "format": "Formatea tu respuesta exactamente así:"},
    "fr": {"translate": "Traduire", "word": "mot", "into": "en", "context": "tel qu'utilisé dans ce contexte",
           "translation": "Traduction", "definition": "Définition contextuelle", "pos": "Partie du discours",
           "important": "IMPORTANT : N'écrivez que le MOT traduit, pas la phrase entière.",
           "format": "Formatez votre réponse exactement comme suit :"},
    "de": {"translate": "Übersetzen", "word": "Wort", "into": "ins", "context": "wie in diesem Kontext verwendet",
           "translation": "Übersetzung", "definition": "Kontextuelle Definition", "pos": "Wortart",
           "important": "WICHTIG: Geben Sie nur das übersetzte WORT aus, nicht den ganzen Satz.",
           "format": "Formatieren Sie Ihre Antwort genau wie folgt:"},
    "pt": {"translate": "Traduzir", "word": "palavra", "into": "para", "context": "conforme usado neste contexto",
           "translation": "Tradução", "definition": "Definição contextual", "pos": "Classe gramatical",
           "important": "IMPORTANTE: Escreva apenas a PALAVRA traduzida, não a frase inteira.",
           "format": "Formate sua resposta exatamente assim:"},
    "ar": {"translate": "ترجم", "word": "كلمة", "into": "إلى", "context": "كما تُستخدم في هذا السياق",
           "translation": "الترجمة", "definition": "التعريف السياقي", "pos": "نوع الكلمة",
           "important": "مهم: اكتب الكلمة المترجمة فقط، وليس الجملة كاملة.",
           "format": "قم بتنسيق إجابتك بالضبط كما يلي:"},
    "it": {"translate": "Traduci", "word": "parola", "into": "in", "context": "come usato in questo contesto",
           "translation": "Traduzione", "definition": "Definizione contestuale", "pos": "Parte del discorso",
           "important": "IMPORTANTE: Scrivi solo la PAROLA tradotta, non l'intera frase.",
           "format": "Formatta la tua risposta esattamente come segue:"},
    "ru": {"translate": "Переведите", "word": "слово", "into": "на", "context": "как используется в этом контексте",
           "translation": "Перевод", "definition": "Контекстуальное определение", "pos": "Часть речи",
           "important": "ВАЖНО: Напишите только переведённое СЛОВО, а не всё предложение.",
           "format": "Отформатируйте ответ точно так:"},
    "hi": {"translate": "अनुवाद करें", "word": "शब्द", "into": "में", "context": "इस संदर्भ में प्रयुक्त",
           "translation": "अनुवाद", "definition": "प्रासंगिक परिभाषा", "pos": "शब्द भेद",
           "important": "महत्वपूर्ण: केवल अनुवादित शब्द लिखें, पूरा वाक्य नहीं।",
           "format": "अपना उत्तर ठीक इस प्रकार लिखें:"},
}


def get_source_lang_name(code: str) -> str:
    for lang in TARGET_LANGUAGES:
        if lang["code"] == code:
            return lang["name"]
    return code


def generate_definition_for_word(
    word: str, sentence: str, source_lang: str, target_lang: str,
) -> dict:
    """Generate translation + definition for one word in one target language."""
    source_name = get_source_lang_name(source_lang)
    target_name = get_source_lang_name(target_lang)
    labels = LOCALIZED_LABELS.get(target_lang, LOCALIZED_LABELS["en"])

    prompt = (
        f"{labels['translate']} {source_name} {labels['word']} \"{word}\" "
        f"{labels['into']} {target_name} {labels['context']}: \"{sentence}\"\n\n"
        f"{labels['format']}\n"
        f"{labels['translation']}: <{target_name}>\n"
        f"{labels['definition']}: <{target_name}>\n"
        f"{labels['pos']}: <noun/verb/adjective/etc.>\n\n"
        f"{labels['important']}"
    )

    try:
        response = llm.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": f"You are a professional translator. Provide precise, contextual translations into {target_name}."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=200,
        )
        content = response.choices[0].message.content.strip()

        # Parse the structured response
        translation = ""
        contextual_def = ""
        part_of_speech = ""

        for line in content.split("\n"):
            line = line.strip()
            # Match localized or English labels
            trans_label = labels["translation"]
            def_label = labels["definition"]
            pos_label = labels["pos"]

            if line.startswith(f"{trans_label}:") or line.startswith("Translation:"):
                translation = line.split(":", 1)[1].strip()
            elif line.startswith(f"{def_label}:") or line.startswith("Contextual Definition:"):
                contextual_def = line.split(":", 1)[1].strip()
            elif line.startswith(f"{pos_label}:") or line.startswith("Part of Speech:"):
                part_of_speech = line.split(":", 1)[1].strip()

        return {
            "translation": translation,
            "contextual_definition": contextual_def,
            "part_of_speech": part_of_speech,
        }
    except Exception as e:
        print(f"    WARNING: LLM error for '{word}' → {target_lang}: {e}")
        return {"translation": "", "contextual_definition": "", "part_of_speech": ""}


def generate_all_definitions(
    words: list[str],
    word_sentences: dict[str, str],
    source_lang: str,
) -> dict[str, dict[str, dict]]:
    """
    Generate translations for all words × all target languages (excluding self-translation).
    Returns: {word: {target_lang: {translation, contextual_definition, part_of_speech}}}
    """
    if not words:
        return {}

    # Build word → sentence map for context
    target_langs = [t for t in TARGET_LANGUAGES if t["code"] != source_lang]

    total_calls = len(words) * len(target_langs)
    print(f"  Generating definitions: {len(words)} words × {len(target_langs)} languages = {total_calls} LLM calls")

    all_defs: dict[str, dict[str, dict]] = {}
    call_count = 0

    for word in words:
        sentence = word_sentences.get(word, word)
        all_defs[word] = {}

        for target in target_langs:
            result = generate_definition_for_word(word, sentence, source_lang, target["code"])
            all_defs[word][target["code"]] = result
            call_count += 1

            if call_count % 10 == 0:
                print(f"    Progress: {call_count}/{total_calls} calls")

            # Rate limit: ~2 calls/sec to stay under OpenRouter limits
            time.sleep(0.5)

    print(f"  Definitions complete: {call_count} LLM calls")
    return all_defs


# ─── Step 7: Insert into Supabase ───

def insert_vocab_and_definitions(
    video_id: str, words: list[str], all_definitions: dict[str, dict[str, dict]],
    word_occurrences: list[dict], language: str,
):
    """Insert vocab_words, word_definitions (all languages), and video_words into Supabase."""

    # Batch upsert vocab_words — single call instead of N+1 queries
    rows = [{"word": w, "language": language, "pinyin": get_pinyin(w, language)} for w in words]
    word_id_map = {}
    for i in range(0, len(rows), 50):
        batch = rows[i:i + 50]
        result = supabase.table("vocab_words").upsert(
            batch, on_conflict="word,language"
        ).execute()
        for r in result.data:
            word_id_map[r["word"]] = r["id"]

    print(f"  Inserted/found {len(word_id_map)} vocab_words")

    # Build word → sentence map
    word_sentences = {}
    for occ in word_occurrences:
        if occ["word"] not in word_sentences:
            word_sentences[occ["word"]] = occ["sentence"]

    # Insert word_definitions — one row per word × target language
    def_rows = []
    for word, lang_defs in all_definitions.items():
        if word not in word_id_map:
            continue
        sentence = word_sentences.get(word, "")

        for target_lang, defn in lang_defs.items():
            def_rows.append({
                "vocab_word_id": word_id_map[word],
                "video_id": video_id,
                "target_language": target_lang,
                "translation": defn["translation"],
                "contextual_definition": defn["contextual_definition"],
                "part_of_speech": defn.get("part_of_speech", ""),
                "source_sentence": sentence,
                "llm_provider": LLM_MODEL,
            })

    if def_rows:
        for i in range(0, len(def_rows), 50):
            supabase.table("word_definitions").insert(def_rows[i:i + 50]).execute()
    print(f"  Inserted {len(def_rows)} word_definitions ({len(all_definitions)} words × {len(def_rows) // max(len(all_definitions), 1)} languages)")

    # Insert video_words
    vw_rows = []
    for idx, occ in enumerate(word_occurrences):
        word = occ["word"]
        if word not in word_id_map:
            continue
        vw_rows.append({
            "video_id": video_id,
            "vocab_word_id": word_id_map[word],
            "start_ms": occ["start_ms"],
            "end_ms": occ["end_ms"],
            "word_index": idx,
            "display_text": occ["display_text"],
        })

    if vw_rows:
        for i in range(0, len(vw_rows), 50):
            supabase.table("video_words").insert(vw_rows[i:i + 50]).execute()
    print(f"  Inserted {len(vw_rows)} video_words")


# ─── Step 8: Mark Ready ───

def mark_video_ready(video_id: str, started_at: str):
    """Update video status to 'ready' and insert pipeline_jobs completion."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    supabase.table("videos").update({
        "status": "ready",
        "processed_at": now,
    }).eq("id", video_id).execute()

    supabase.table("pipeline_jobs").insert({
        "video_id": video_id,
        "status": "ready",
        "started_at": started_at,
        "completed_at": now,
    }).execute()

    print(f"  Video marked as ready")


# ─── Main ───

def reuse_existing_definitions(words: list[str], language: str) -> dict[str, dict[str, dict]]:
    """Look up existing word_definitions from Supabase instead of calling the LLM.

    For each word, finds its vocab_word_id, then copies all existing definitions
    from any prior video that used the same word.
    """
    all_definitions = {}
    target_langs = [t["code"] for t in TARGET_LANGUAGES if t["code"] != language]

    for word in words:
        # Find the vocab_word
        result = supabase.table("vocab_words").select("id").eq("word", word).eq("language", language).limit(1).execute()
        if not result.data:
            continue
        vocab_id = result.data[0]["id"]

        # Get existing definitions (from any video)
        defs_result = (
            supabase.table("word_definitions")
            .select("target_language, translation, contextual_definition, part_of_speech")
            .eq("vocab_word_id", vocab_id)
            .execute()
        )
        if not defs_result.data:
            continue

        # Dedupe by target_language (take first found)
        lang_defs = {}
        for d in defs_result.data:
            tl = d["target_language"]
            if tl not in lang_defs:
                lang_defs[tl] = {
                    "translation": d["translation"],
                    "contextual_definition": d["contextual_definition"],
                    "part_of_speech": d.get("part_of_speech", ""),
                }

        if lang_defs:
            all_definitions[word] = lang_defs

    found = len(all_definitions)
    total_defs = sum(len(v) for v in all_definitions.values())
    print(f"  Reused definitions for {found}/{len(words)} words ({total_defs} definition rows)")
    return all_definitions


def main():
    parser = argparse.ArgumentParser(description="Process a video through the Scrollingo pipeline")
    parser.add_argument("--video", required=True, help="Path to input video file")
    parser.add_argument("--language", default=None, help="Video content language (auto-detected from OCR if not provided)")
    parser.add_argument("--native-lang", default=None, help="[DEPRECATED] Ignored — all 11 target languages are generated automatically")
    parser.add_argument("--title", default=None, help="Video title (default: filename)")
    parser.add_argument("--dry-run", action="store_true", help="Run OCR and LLM but skip Supabase/R2")
    parser.add_argument("--reuse-definitions", action="store_true", help="Skip LLM calls — copy existing definitions from Supabase for matching words")
    parser.add_argument("--skip-ocr", action="store_true", help="Skip OCR (use only STT)")
    parser.add_argument("--skip-stt", action="store_true", help="Skip STT (use only OCR)")
    args = parser.parse_args()

    video_path = os.path.abspath(args.video)
    if not os.path.exists(video_path):
        print(f"ERROR: Video not found: {video_path}")
        sys.exit(1)

    video_id = str(uuid.uuid4())
    title = args.title  # May be None — will auto-detect from OCR
    language = args.language  # May be None — will auto-detect from OCR

    print(f"\n{'=' * 60}")
    print(f"Processing: {Path(video_path).name}")
    print(f"  Video ID: {video_id}")
    print(f"  Language: {language or 'auto-detect'}")
    print(f"  LLM: {LLM_MODEL} via OpenRouter")
    print(f"{'=' * 60}\n")

    t_start = time.time()

    with tempfile.TemporaryDirectory() as tmpdir:
        # Step 1: Normalize
        print("[1/8] Normalizing video...")
        norm_path, duration_sec = normalize_video(video_path, tmpdir)

        # Step 2: Run OCR (always — detect burned-in text positions)
        print("[2/8] Running OCR...")
        bbox_data_ocr = run_ocr(norm_path, video_id)

        # Step 3: Run STT (always — extract audio transcript with word timing)
        bbox_data_stt = None
        print("[3/8] Running STT (Groq Whisper)...")
        audio_path = extract_audio(norm_path, tmpdir)
        if audio_path and groq:
            try:
                whisper_result = run_stt(audio_path, language)
                duration_ms = duration_sec * 1000
                bbox_data_stt = whisper_to_bboxes(whisper_result, video_id, duration_ms)
                bbox_data_stt = chunk_stt_segments(bbox_data_stt, whisper_result)
                upload_to_r2(audio_path, f"videos/{video_id}/audio.mp3")
            except Exception as e:
                print(f"  STT failed: {e} — continuing with OCR only")
        elif not groq:
            print("  No GroqAPIKey — skipping STT")
        else:
            print("  No audio stream — skipping STT")

        # Use OCR data as primary (has bbox positions for tap targets)
        # Use STT data for the visible subtitle drawer
        bbox_data = bbox_data_ocr
        sub_source = "both" if bbox_data_stt else "ocr"

        # Auto-detect language from subtitle text if not provided
        # Prefer STT text (more accurate) over OCR text
        if not language:
            source = bbox_data_stt or bbox_data_ocr
            language = detect_content_language(source)
            if language:
                print(f"  Auto-detected language: {language}")
            else:
                language = "zh"  # Default fallback
                print(f"  Could not detect language, defaulting to: {language}")

        # Auto-detect title from first subtitle if not provided
        if not title:
            source = bbox_data_stt or bbox_data_ocr
            title = get_auto_title(source)
            print(f"  Auto-title: \"{title}\"")

        # Extract thumbnail at ~30% into the video
        thumb_path = extract_thumbnail(norm_path, tmpdir, duration_sec)

        # Step 4: Upload to R2
        print("[4/8] Uploading to R2...")
        cdn_url = upload_to_r2(norm_path, f"videos/{video_id}/video.mp4")
        thumb_url = upload_to_r2(thumb_path, f"videos/{video_id}/thumbnail.jpg")

        if not args.dry_run:
            # Insert video row
            print("  Inserting video row...")
            insert_video_row(video_id, title, language, duration_sec, cdn_url, thumb_url, sub_source)

        # Save + upload OCR bboxes.json (for tap targets over burned-in text)
        bbox_path = os.path.join(tmpdir, "bboxes.json")
        with open(bbox_path, "w", encoding="utf-8") as f:
            json.dump(bbox_data_ocr, f, ensure_ascii=False, indent=2)
        upload_to_r2(bbox_path, f"videos/{video_id}/bboxes.json")

        # Save + upload STT stt.json (debugging)
        if bbox_data_stt:
            stt_path = os.path.join(tmpdir, "stt.json")
            with open(stt_path, "w", encoding="utf-8") as f:
                json.dump(bbox_data_stt, f, ensure_ascii=False, indent=2)
            upload_to_r2(stt_path, f"videos/{video_id}/stt.json")

        # Merge OCR + STT into unified transcript
        if bbox_data_stt:
            print("  Merging OCR + STT transcript...")
            transcript_data = merge_ocr_stt(bbox_data_ocr, bbox_data_stt)
            transcript_path = os.path.join(tmpdir, "transcript.json")
            with open(transcript_path, "w", encoding="utf-8") as f:
                json.dump(transcript_data, f, ensure_ascii=False, indent=2)
            upload_to_r2(transcript_path, f"videos/{video_id}/transcript.json")
            merged_count = len(transcript_data["segments"])
            ocr_matched = sum(1 for s in transcript_data["segments"] if s["source"] == "ocr+stt")
            stt_only = sum(1 for s in transcript_data["segments"] if s["source"] == "stt_only")
            print(f"  Transcript: {merged_count} segments ({ocr_matched} OCR+STT, {stt_only} STT-only)")

        # Save locally for testing
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        local_bbox_path = OUTPUT_DIR / f"{Path(video_path).stem}_pipeline.json"
        with open(local_bbox_path, "w", encoding="utf-8") as f:
            json.dump(bbox_data_ocr, f, ensure_ascii=False, indent=2)
        if bbox_data_stt:
            local_stt_path = OUTPUT_DIR / f"{Path(video_path).stem}_stt.json"
            with open(local_stt_path, "w", encoding="utf-8") as f:
                json.dump(bbox_data_stt, f, ensure_ascii=False, indent=2)
            local_transcript_path = OUTPUT_DIR / f"{Path(video_path).stem}_transcript.json"
            with open(local_transcript_path, "w", encoding="utf-8") as f:
                json.dump(transcript_data, f, ensure_ascii=False, indent=2)
        print(f"  Saved locally: {local_bbox_path}")

        # Step 5: Word segmentation — prefer STT (better word boundaries) over OCR
        print("[5/8] Segmenting words...")
        seg_source = bbox_data_stt if bbox_data_stt else bbox_data_ocr
        unique_words, word_occurrences = segment_words(seg_source, language)

        # Build word → sentence map for LLM context
        word_sentences = {}
        for occ in word_occurrences:
            if occ["word"] not in word_sentences:
                word_sentences[occ["word"]] = occ["sentence"]

        # Step 6: LLM definitions — all words × all target languages
        if args.reuse_definitions:
            print("[6/8] Reusing existing definitions from Supabase...")
            all_definitions = reuse_existing_definitions(unique_words, language)
            missing = [w for w in unique_words if w not in all_definitions or not all_definitions[w]]
            if missing:
                print(f"  {len(missing)} words have no existing definitions: {missing[:5]}{'...' if len(missing) > 5 else ''}")
        else:
            print("[6/8] Generating definitions via Claude Haiku 3.5...")
            all_definitions = generate_all_definitions(unique_words, word_sentences, language)

        if not args.dry_run:
            started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
            try:
                # Step 7: Insert into Supabase
                print("[7/8] Inserting into Supabase...")
                insert_vocab_and_definitions(
                    video_id, unique_words, all_definitions,
                    word_occurrences, language,
                )

                # Step 8: Mark ready
                print("[8/8] Marking video ready...")
                mark_video_ready(video_id, started_at)
            except Exception as e:
                print(f"\n  ERROR during Supabase insert: {e}")
                print("  Cleaning up — deleting partial video data...")
                try:
                    supabase.table("video_words").delete().eq("video_id", video_id).execute()
                    supabase.table("word_definitions").delete().eq("video_id", video_id).execute()
                    supabase.table("videos").delete().eq("id", video_id).execute()
                    print("  Cleanup complete — video row and related data removed")
                except Exception as cleanup_err:
                    print(f"  WARNING: Cleanup failed: {cleanup_err}")
                    print(f"  Manual cleanup needed for video_id: {video_id}")
                raise
        else:
            print("[7/8] [DRY RUN] Skipping Supabase inserts")
            print("[8/8] [DRY RUN] Skipping status update")

    elapsed = time.time() - t_start
    print(f"\n{'=' * 60}")
    print(f"Done! {elapsed:.1f}s total")
    print(f"  Video ID: {video_id}")
    print(f"  Title: {title}")
    num_langs = len([t for t in TARGET_LANGUAGES if t["code"] != language])
    print(f"  Words: {len(unique_words)}")
    print(f"  Definitions: {len(unique_words)} words × {num_langs} languages = {len(unique_words) * num_langs}")
    print(f"  Segments: {len(bbox_data['segments'])}")
    if args.dry_run:
        print(f"  [DRY RUN] No data written to Supabase/R2")
    print(f"{'=' * 60}\n")


def backfill_pinyin():
    """Backfill pinyin for all Chinese vocab_words that currently have pinyin=NULL."""
    print("\n=== Backfilling pinyin for Chinese vocab_words ===\n")

    # Fetch all zh words with NULL pinyin
    result = (
        supabase.table("vocab_words")
        .select("id, word")
        .eq("language", "zh")
        .is_("pinyin", "null")
        .execute()
    )
    rows = result.data
    print(f"  Found {len(rows)} words needing pinyin\n")

    if not rows:
        print("  Nothing to backfill!")
        return

    updated = 0
    for i, row in enumerate(rows):
        py = get_pinyin(row["word"], "zh")
        if py:
            supabase.table("vocab_words").update(
                {"pinyin": py}
            ).eq("id", row["id"]).execute()
            updated += 1

        if (i + 1) % 50 == 0:
            print(f"    Progress: {i + 1}/{len(rows)}")

    print(f"\n  Backfill complete: updated {updated}/{len(rows)} words")

    # Verify a sample
    sample = (
        supabase.table("vocab_words")
        .select("word, pinyin")
        .eq("language", "zh")
        .not_.is_("pinyin", "null")
        .limit(5)
        .execute()
    )
    if sample.data:
        print("\n  Sample results:")
        for s in sample.data:
            print(f"    {s['word']} → {s['pinyin']}")
    print()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--backfill-pinyin":
        backfill_pinyin()
    else:
        main()
