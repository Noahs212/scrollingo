"""
Extract subtitle bounding boxes from video frames using PaddleOCR.
Outputs JSON files per video with character-level tap targets.

Usage:
    python3 scripts/extract_subtitles.py

Optimizations:
    - Disables doc orientation/unwarping models (not needed for video frames)
    - Extracts frames at half resolution for 3x faster OCR
    - Scales bounding boxes back to native resolution for the app
    - Samples every 1s (subtitles stay on screen 1-3s)
    - Filters: min 2 chars, min 750ms duration

Output:
    mobile/assets/subtitles/video_N.json per video
"""

import os
import json
import subprocess
import tempfile
import warnings
from pathlib import Path

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
warnings.filterwarnings("ignore")

from paddleocr import PaddleOCR

VIDEOS_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos"
OUTPUT_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles"
FRAME_INTERVAL_MS = 250  # 4fps — catches subtitle transitions within 250ms
MIN_DURATION_MS = 750
OCR_SCALE = 0.5  # Extract at half res for speed, scale boxes back up

# Feed videos in the order they appear in posts.ts LOCAL_VIDEOS
FEED_VIDEOS = [
    "video_2.mp4", "video_3.mp4", "video_4.mp4", "video_6.mp4",
    "video_8.mp4", "video_9.mp4", "video_10.mp4", "video_11.mp4",
    "video_12.mp4", "video_13.mp4",
]


def get_video_info(video_path: str) -> tuple[int, int, float]:
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


def extract_frames(video_path: str, tmpdir: str, w: int, h: int) -> list[tuple[str, int]]:
    """Extract frames at half resolution for faster OCR."""
    _, _, duration = get_video_info(video_path)
    scaled_w = int(w * OCR_SCALE)
    scaled_h = int(h * OCR_SCALE)
    frames = []
    ts_ms = 0
    while ts_ms < duration * 1000:
        fp = os.path.join(tmpdir, f"f_{ts_ms:06d}.jpg")
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(ts_ms / 1000), "-i", video_path,
             "-vframes", "1", "-vf", f"scale={scaled_w}:{scaled_h}",
             "-q:v", "2", fp],
            capture_output=True,
        )
        if os.path.exists(fp):
            frames.append((fp, ts_ms))
        ts_ms += FRAME_INTERVAL_MS
    return frames


def run_ocr_on_frame(ocr_engine, frame_path: str) -> list[dict]:
    """Run OCR and scale bounding boxes back to native resolution."""
    result = ocr_engine.ocr(frame_path)
    if not result or not result[0]:
        return []

    r = result[0]
    texts = r.get("rec_texts", [])
    scores = r.get("rec_scores", [])
    polys = r.get("rec_polys", [])
    scale_back = 1.0 / OCR_SCALE  # Scale coords back to native res

    detections = []
    for text, score, poly in zip(texts, scores, polys):
        if score < 0.7 or len(text) < 2:
            continue
        coords = poly.tolist()
        # Scale back to native resolution
        x_min = min(p[0] for p in coords) * scale_back
        y_min = min(p[1] for p in coords) * scale_back
        x_max = max(p[0] for p in coords) * scale_back
        y_max = max(p[1] for p in coords) * scale_back
        box_h = y_max - y_min

        # PaddleOCR's detection polygon on stylized Chinese subtitles captures
        # the shadow/glow region below the characters. Shift up by half the
        # box height to center the bbox on the actual character body.
        shift = box_h * 0.5
        y_min -= shift
        y_max -= shift

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


def deduplicate_subtitles(frame_results: list[dict]) -> list[dict]:
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

    # Filter short segments (incidental text from clothing/signs)
    segments = [s for s in segments if (s["end_ms"] - s["start_ms"]) >= MIN_DURATION_MS]
    return segments


def process_video(ocr_engine, video_path: str) -> dict:
    name = Path(video_path).stem
    w, h, dur = get_video_info(video_path)
    print(f"{name} ({dur:.0f}s, {w}x{h})...", end=" ", flush=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        frames = extract_frames(video_path, tmpdir, w, h)
        frame_results = []
        for fp, ts_ms in frames:
            dets = run_ocr_on_frame(ocr_engine, fp)
            frame_results.append({"timestamp_ms": ts_ms, "detections": dets})

        segments = deduplicate_subtitles(frame_results)

    result = {
        "video": name,
        "resolution": {"width": w, "height": h},
        "duration_ms": round(dur * 1000),
        "frame_interval_ms": FRAME_INTERVAL_MS,
        "segments": segments,
    }

    out_path = OUTPUT_DIR / f"{name}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"{len(segments)} segments -> {out_path.name}")
    return result


def create_placeholder(name: str):
    """Create empty subtitle JSON so the app doesn't crash on require()."""
    p = OUTPUT_DIR / f"{name}.json"
    if not p.exists():
        with open(p, "w") as f:
            json.dump({"video": name, "resolution": {"width": 720, "height": 1280},
                       "duration_ms": 0, "frame_interval_ms": FRAME_INTERVAL_MS,
                       "segments": []}, f)


def main():
    print("Loading PaddleOCR (optimized — no doc preprocessing)...")
    ocr = PaddleOCR(
        lang='ch',
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    print("Ready.\n")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Create placeholders first so app doesn't crash
    for vf in FEED_VIDEOS:
        create_placeholder(Path(vf).stem)

    # Process first video, then the rest
    for vf in FEED_VIDEOS:
        process_video(ocr, str(VIDEOS_DIR / vf))

    print("\nDone!")


if __name__ == "__main__":
    main()
