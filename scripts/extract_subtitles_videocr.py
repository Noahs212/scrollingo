"""
Extract subtitle bounding boxes using videocr-PaddleOCR's pixel-diff dedup approach.

This script uses videocr-PaddleOCR's frame extraction and pixel-diff deduplication
logic, combined with our own PaddleOCR bbox extraction pipeline.

Install:
    pip install git+https://github.com/devmaxxing/videocr-PaddleOCR.git

Usage:
    python3 scripts/extract_subtitles_videocr.py
    python3 scripts/extract_subtitles_videocr.py --output-suffix videocr

Output:
    mobile/assets/subtitles/video_N_videocr.json per video
"""

import os
import sys
import json
import subprocess
import tempfile
import time
import warnings
import argparse
from pathlib import Path

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
warnings.filterwarnings("ignore")

# Check dependencies before importing
try:
    import cv2
    import numpy as np
except ImportError:
    print("ERROR: opencv-python and numpy are required.")
    print("  pip install opencv-python numpy")
    sys.exit(1)

try:
    from paddleocr import PaddleOCR
except ImportError:
    print("ERROR: PaddleOCR is required.")
    print("  pip install paddleocr")
    sys.exit(1)

try:
    import videocr  # noqa: F401
except ImportError:
    print("ERROR: videocr-PaddleOCR is required.")
    print("  pip install git+https://github.com/devmaxxing/videocr-PaddleOCR.git")
    sys.exit(1)

VIDEOS_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos"
OUTPUT_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles"
FRAME_INTERVAL_MS = 250
MIN_DURATION_MS = 750
OCR_SCALE = 0.5
CONF_THRESHOLD = 0.70
MIN_CHARS = 2
# Pixel-diff threshold for dedup (0-255 grayscale mean absolute diff)
PIXEL_DIFF_THRESHOLD = 10

FEED_VIDEOS = [
    "video_2.mp4", "video_3.mp4", "video_4.mp4", "video_6.mp4",
    "video_8.mp4", "video_9.mp4", "video_10.mp4", "video_11.mp4",
    "video_12.mp4", "video_13.mp4",
]


def get_video_info(video_path: str) -> tuple:
    """Get (width, height, duration_sec) from ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
        capture_output=True, text=True,
    )
    streams = json.loads(result.stdout)["streams"]
    for s in streams:
        if s["codec_type"] == "video":
            return int(s["width"]), int(s["height"]), float(s.get("duration", 0))
    return 720, 1280, 0


def extract_frames_with_pixeldiff_dedup(video_path: str, w: int, h: int) -> list:
    """
    Extract frames at half resolution and apply videocr-style pixel-diff dedup.
    Returns list of (frame_image, timestamp_ms, is_unique) tuples.
    Uses cv2.absdiff on grayscale frames — same approach as videocr-PaddleOCR.
    """
    _, _, duration = get_video_info(video_path)
    scaled_w = int(w * OCR_SCALE)
    scaled_h = int(h * OCR_SCALE)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  ERROR: Could not open {video_path}")
        return []

    frames = []
    prev_gray = None
    ts_ms = 0

    while ts_ms < duration * 1000:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts_ms)
        ret, frame = cap.read()
        if not ret:
            ts_ms += FRAME_INTERVAL_MS
            continue

        frame = cv2.resize(frame, (scaled_w, scaled_h))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        is_unique = True
        if prev_gray is not None:
            # videocr-style pixel diff: mean of absolute difference
            diff = cv2.absdiff(gray, prev_gray)
            mean_diff = np.mean(diff)
            is_unique = mean_diff > PIXEL_DIFF_THRESHOLD

        frames.append((frame, ts_ms, is_unique))
        prev_gray = gray
        ts_ms += FRAME_INTERVAL_MS

    cap.release()
    return frames


def run_ocr_on_image(ocr_engine, image, is_paddle3x: bool) -> list:
    """Run OCR on a cv2 image and return detections with scaled bboxes."""
    result = ocr_engine.ocr(image)
    if not result or not result[0]:
        return []

    r = result[0]
    scale_back = 1.0 / OCR_SCALE
    detections = []

    # Handle PaddleOCR 3.x dict format
    if isinstance(r, dict):
        texts = r.get("rec_texts", [])
        scores = r.get("rec_scores", [])
        polys = r.get("rec_polys", [])
        for text, score, poly in zip(texts, scores, polys):
            det = _build_detection(text, score, poly, scale_back)
            if det:
                detections.append(det)
    # Handle PaddleOCR 2.x list format: [[[bbox_points], (text, confidence)], ...]
    elif isinstance(r, list):
        for item in r:
            if len(item) >= 2:
                poly = item[0]
                text, score = item[1]
                det = _build_detection(text, score, poly, scale_back)
                if det:
                    detections.append(det)

    return detections


def _build_detection(text: str, score: float, poly, scale_back: float) -> dict | None:
    """Build a detection dict from OCR output, applying bbox shift and char targets."""
    if score < CONF_THRESHOLD or len(text) < MIN_CHARS:
        return None

    if hasattr(poly, 'tolist'):
        coords = poly.tolist()
    else:
        coords = poly

    x_min = min(p[0] for p in coords) * scale_back
    y_min = min(p[1] for p in coords) * scale_back
    x_max = max(p[0] for p in coords) * scale_back
    y_max = max(p[1] for p in coords) * scale_back
    box_h = y_max - y_min

    # No vertical shift — OCR polygon aligns with characters at half-res

    chars = list(text)
    char_w = (x_max - x_min) / max(len(chars), 1)
    char_boxes = [{
        "char": c,
        "x": round(x_min + i * char_w),
        "y": round(y_min),
        "width": round(char_w),
        "height": round(box_h),
    } for i, c in enumerate(chars)]

    return {
        "text": text,
        "confidence": round(score, 4),
        "bbox": {"x": round(x_min), "y": round(y_min),
                 "width": round(x_max - x_min), "height": round(box_h)},
        "chars": char_boxes,
    }


def deduplicate_subtitles(frame_results: list) -> list:
    """Collapse consecutive identical text into timed segments."""
    segments = []
    current_text = None
    current_segment = None

    for fr in frame_results:
        if not fr["detections"]:
            if current_segment:
                segments.append(current_segment)
                current_segment = None
                current_text = None
            continue

        sorted_dets = sorted(fr["detections"], key=lambda d: d["bbox"]["y"], reverse=True)
        frame_text = "|".join(d["text"] for d in sorted_dets)

        if frame_text == current_text and current_segment:
            current_segment["end_ms"] = fr["timestamp_ms"] + FRAME_INTERVAL_MS
        else:
            if current_segment:
                segments.append(current_segment)
            current_text = frame_text
            current_segment = {
                "start_ms": fr["timestamp_ms"],
                "end_ms": fr["timestamp_ms"] + FRAME_INTERVAL_MS,
                "detections": sorted_dets,
            }

    if current_segment:
        segments.append(current_segment)

    segments = [s for s in segments if (s["end_ms"] - s["start_ms"]) >= MIN_DURATION_MS]
    return segments


def process_video(ocr_engine, video_path: str, suffix: str) -> dict:
    name = Path(video_path).stem
    w, h, dur = get_video_info(video_path)
    print(f"\n{name} ({dur:.0f}s, {w}x{h})...")

    t0 = time.time()
    frames = extract_frames_with_pixeldiff_dedup(video_path, w, h)
    total_frames = len(frames)
    unique_frames = [f for f in frames if f[2]]
    skipped = total_frames - len(unique_frames)

    print(f"  Frames: {total_frames} total, {len(unique_frames)} unique, {skipped} skipped (pixel-diff dedup)")

    # Detect PaddleOCR version
    is_paddle3x = True  # Will be determined by first result

    # Run OCR only on unique frames, carry forward last detections for dupes
    frame_results = []
    last_detections = []
    unique_set = set(id(f) for f in unique_frames)

    for frame_img, ts_ms, is_unique in frames:
        if is_unique:
            dets = run_ocr_on_image(ocr_engine, frame_img, is_paddle3x)
            last_detections = dets
        else:
            dets = last_detections
        frame_results.append({"timestamp_ms": ts_ms, "detections": dets})

    segments = deduplicate_subtitles(frame_results)
    elapsed = time.time() - t0

    print(f"  {len(segments)} segments, {elapsed:.1f}s elapsed")

    result = {
        "video": name,
        "resolution": {"width": w, "height": h},
        "duration_ms": round(dur * 1000),
        "frame_interval_ms": FRAME_INTERVAL_MS,
        "segments": segments,
    }

    out_name = f"{name}_{suffix}.json" if suffix else f"{name}.json"
    out_path = OUTPUT_DIR / out_name
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"  -> {out_path.name}")
    return result


def main():
    parser = argparse.ArgumentParser(description="Extract subtitles using videocr-PaddleOCR pixel-diff dedup")
    parser.add_argument("--output-suffix", default="videocr",
                        help="Suffix for output files (default: videocr)")
    args = parser.parse_args()

    print("=== extract_subtitles_videocr.py ===")
    print("Method: PaddleOCR + videocr-style pixel-diff frame dedup")
    print()
    print("Loading PaddleOCR (optimized -- no doc preprocessing)...")
    ocr = PaddleOCR(
        lang='ch',
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    print("Ready.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    total_start = time.time()
    for vf in FEED_VIDEOS:
        vpath = str(VIDEOS_DIR / vf)
        if not os.path.exists(vpath):
            print(f"\nWARNING: {vf} not found, skipping")
            continue
        process_video(ocr, vpath, args.output_suffix)

    total_elapsed = time.time() - total_start
    print(f"\nDone! Total time: {total_elapsed:.1f}s")


if __name__ == "__main__":
    main()
