"""
Extract subtitle bounding boxes using RapidOCR (ONNX Runtime backend).

This script uses rapidocr_onnxruntime as a drop-in replacement for PaddlePaddle,
providing faster startup and smaller memory footprint.

Install:
    pip install rapidocr_onnxruntime opencv-python numpy

Usage:
    python3 scripts/extract_subtitles_rapid.py
    python3 scripts/extract_subtitles_rapid.py --output-suffix rapid

Output:
    mobile/assets/subtitles/video_N_rapid.json per video
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

warnings.filterwarnings("ignore")

try:
    import cv2
    import numpy as np
except ImportError:
    print("ERROR: opencv-python and numpy are required.")
    print("  pip install opencv-python numpy")
    sys.exit(1)

try:
    from rapidocr_onnxruntime import RapidOCR
except ImportError:
    try:
        from rapidocr_paddle import RapidOCR
        print("NOTE: Using rapidocr_paddle backend (rapidocr_onnxruntime not found)")
    except ImportError:
        print("ERROR: RapidOCR is required. Install one of:")
        print("  pip install rapidocr_onnxruntime   (preferred, ONNX Runtime backend)")
        print("  pip install rapidocr_paddle         (PaddlePaddle backend)")
        sys.exit(1)

VIDEOS_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos"
OUTPUT_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles"
FRAME_INTERVAL_MS = 250
MIN_DURATION_MS = 750
OCR_SCALE = 0.5
CONF_THRESHOLD = 0.65  # Slightly lower than PaddleOCR since RapidOCR scores differently
MIN_CHARS = 2

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


def extract_frames(video_path: str, w: int, h: int) -> list:
    """Extract frames at half resolution using OpenCV."""
    _, _, duration = get_video_info(video_path)
    scaled_w = int(w * OCR_SCALE)
    scaled_h = int(h * OCR_SCALE)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  ERROR: Could not open {video_path}")
        return []

    frames = []
    ts_ms = 0

    while ts_ms < duration * 1000:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts_ms)
        ret, frame = cap.read()
        if not ret:
            ts_ms += FRAME_INTERVAL_MS
            continue

        frame = cv2.resize(frame, (scaled_w, scaled_h))
        frames.append((frame, ts_ms))
        ts_ms += FRAME_INTERVAL_MS

    cap.release()
    return frames


def run_ocr_on_image(ocr_engine, image) -> list:
    """
    Run RapidOCR on a cv2 image and return detections with scaled bboxes.
    RapidOCR returns: (result, elapsed_time)
    result is list of [bbox, text, confidence] where bbox is [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
    """
    result, elapsed = ocr_engine(image)
    if not result:
        return []

    scale_back = 1.0 / OCR_SCALE
    detections = []

    for item in result:
        # RapidOCR format: [bbox_points, text, confidence]
        if len(item) < 3:
            continue

        poly = item[0]
        text = item[1]
        score = item[2]

        if score < CONF_THRESHOLD or len(text) < MIN_CHARS:
            continue

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

        detections.append({
            "text": text,
            "confidence": round(score, 4),
            "bbox": {"x": round(x_min), "y": round(y_min),
                     "width": round(x_max - x_min), "height": round(box_h)},
            "chars": char_boxes,
        })

    return detections


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
    frames = extract_frames(video_path, w, h)
    total_frames = len(frames)

    print(f"  Frames: {total_frames} total (no frame-level dedup, text-based dedup only)")

    frame_results = []
    for frame_img, ts_ms in frames:
        dets = run_ocr_on_image(ocr_engine, frame_img)
        frame_results.append({"timestamp_ms": ts_ms, "detections": dets})

    segments = deduplicate_subtitles(frame_results)
    elapsed = time.time() - t0

    print(f"  {len(segments)} segments, {elapsed:.1f}s elapsed")
    print(f"  Frames processed: {total_frames}, skipped: 0 (RapidOCR is fast enough for all frames)")

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
    parser = argparse.ArgumentParser(description="Extract subtitles using RapidOCR (ONNX Runtime)")
    parser.add_argument("--output-suffix", default="rapid",
                        help="Suffix for output files (default: rapid)")
    args = parser.parse_args()

    print("=== extract_subtitles_rapid.py ===")
    print("Method: RapidOCR (ONNX Runtime) + text-based dedup")
    print()
    print("Loading RapidOCR...")
    t0 = time.time()
    ocr = RapidOCR()
    load_time = time.time() - t0
    print(f"Ready. (loaded in {load_time:.1f}s)")

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
