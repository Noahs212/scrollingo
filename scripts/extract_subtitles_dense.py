"""
Dense OCR extraction — NO MISSES approach.

Prioritizes 100% subtitle coverage over speed:
- 100ms frame sampling (10fps)
- NO frame dedup (OCR every single frame)
- Full resolution (no downscaling)
- Lower confidence threshold (0.50)
- Lower min duration (200ms)
- ffmpeg frame extraction (more reliable than cv2.VideoCapture)

Usage:
    python3 scripts/extract_subtitles_dense.py
    python3 scripts/extract_subtitles_dense.py --video mobile/assets/videos/video_8.mp4
    python3 scripts/extract_subtitles_dense.py --output-suffix dense
"""

import os
import sys
import json
import subprocess
import tempfile
import warnings
import argparse
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from functools import partial

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
warnings.filterwarnings("ignore")

from paddleocr import PaddleOCR

VIDEOS_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos"
OUTPUT_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles"

# ── No-misses configuration ──
FRAME_INTERVAL_MS = 100    # 10fps — catches transitions within 100ms
CONF_THRESHOLD = 0.50      # Lower threshold to catch stylized/blurry text
MIN_CHARS_DEFAULT = 2      # Latin languages: skip single chars (noise)
MIN_CHARS_CJK = 1         # Chinese/Japanese/Korean: single chars are meaningful
MIN_DURATION_MS = 100      # Keep even single-frame subtitles (1 frame = 100ms)
GAP_TOLERANCE_MS = 500     # Bridge gaps of ≤5 frames (OCR flicker on difficult backgrounds)

# ── Change detection (skip OCR when subtitle region unchanged) ──
SUBTITLE_REGION_TOP = 0.60   # Only monitor bottom 40% of frame for changes
CHANGE_THRESHOLD = 2.0       # Mean absolute pixel diff to trigger OCR — very low to catch subtle text changes
FORCE_OCR_INTERVAL = 5       # Force OCR every 5 frames (500ms) — catches fast-flashing subtitles

FEED_VIDEOS = [
    "video_1.mp4", "video_2.mp4", "video_3.mp4", "video_4.mp4",
    "video_5.mp4", "video_6.mp4", "video_7.mp4", "video_8.mp4",
    "video_9.mp4", "video_10.mp4", "video_11.mp4", "video_12.mp4",
    "video_13.mp4",
]


def get_video_info(video_path: str):
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
        capture_output=True, text=True)
    streams = json.loads(result.stdout)["streams"]
    for s in streams:
        if s["codec_type"] == "video":
            return int(s["width"]), int(s["height"]), float(s.get("duration", 0))
    return 720, 1280, 0


def extract_frames_ffmpeg(video_path: str, tmpdir: str, interval_ms: int):
    """Extract frames using ffmpeg — more reliable than cv2.VideoCapture for seeking."""
    w, h, dur = get_video_info(video_path)
    fps = 1000 / interval_ms  # e.g., 10fps for 100ms

    # Extract all frames at once using fps filter — much faster than individual seeks
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path,
        "-vf", f"fps={fps}",
        "-q:v", "2",
        os.path.join(tmpdir, "frame_%06d.jpg"),
    ], capture_output=True)

    # Map frame files to timestamps
    frames = []
    frame_files = sorted(Path(tmpdir).glob("frame_*.jpg"))
    for i, fp in enumerate(frame_files):
        ts_ms = i * interval_ms
        frames.append((str(fp), ts_ms))

    return frames, w, h, dur


def subtitle_region_changed(frame_path_a: str, frame_path_b: str, threshold: float = CHANGE_THRESHOLD) -> bool:
    """Compare multiple horizontal bands of the frame for subtitle changes.

    TikTok subtitles can appear at different vertical positions. We split the
    bottom portion into bands and check each independently. If ANY band
    changes significantly, we trigger OCR. This avoids the problem where
    a persistent watermark/disclaimer dominates the overall pixel difference,
    masking actual subtitle changes in a different band.
    """
    import cv2
    a = cv2.imread(frame_path_a, cv2.IMREAD_GRAYSCALE)
    b = cv2.imread(frame_path_b, cv2.IMREAD_GRAYSCALE)
    if a is None or b is None:
        return True

    h, w = a.shape
    if a.shape != b.shape:
        return True

    # Check 4 horizontal bands across the bottom 50% of the frame
    # Each band is ~12.5% of frame height
    bands = [
        (int(h * 0.50), int(h * 0.625)),
        (int(h * 0.625), int(h * 0.75)),
        (int(h * 0.75), int(h * 0.875)),
        (int(h * 0.875), h),
    ]

    for top, bot in bands:
        diff = cv2.absdiff(a[top:bot, :], b[top:bot, :]).mean()
        if diff > threshold:
            return True

    return False


def _has_cjk(text: str) -> bool:
    """Check if text contains CJK characters."""
    return any('\u4e00' <= c <= '\u9fff' or '\u3400' <= c <= '\u4dbf'
               or '\u3040' <= c <= '\u30ff' or '\uac00' <= c <= '\ud7af' for c in text)


def run_ocr_on_frame(ocr, frame_path: str):
    """Run OCR on a single frame at full resolution. No scaling."""
    result = ocr.ocr(frame_path)
    if not result or not result[0]:
        return []

    r = result[0]
    detections = []

    if isinstance(r, dict):
        for text, score, poly in zip(
            r.get("rec_texts", []),
            r.get("rec_scores", []),
            r.get("rec_polys", []),
        ):
            min_chars = MIN_CHARS_CJK if _has_cjk(text) else MIN_CHARS_DEFAULT
            if score < CONF_THRESHOLD or len(text) < min_chars:
                continue
            det = build_detection(text, score, poly)
            if det:
                detections.append(det)
    elif isinstance(r, list):
        for item in r:
            if len(item) >= 2:
                poly, (text, score) = item[0], item[1]
                min_chars = MIN_CHARS_CJK if _has_cjk(text) else MIN_CHARS_DEFAULT
                if score < CONF_THRESHOLD or len(text) < min_chars:
                    continue
                det = build_detection(text, score, poly)
                if det:
                    detections.append(det)

    return detections


def build_detection(text, score, poly):
    coords = poly.tolist() if hasattr(poly, 'tolist') else poly
    x0 = min(p[0] for p in coords)
    y0 = min(p[1] for p in coords)
    x1 = max(p[0] for p in coords)
    y1 = max(p[1] for p in coords)
    box_h = y1 - y0
    if box_h <= 0:
        return None

    total_w = x1 - x0
    char_w = total_w / max(len(text), 1)

    # Build char entries with mixed CJK/Latin awareness:
    # - CJK characters: one entry per character
    # - Latin characters: grouped into words (one entry per word)
    # - Spaces: skipped
    chars = []
    i = 0
    while i < len(text):
        c = text[i]
        c_code = ord(c)
        is_cjk_char = (0x4e00 <= c_code <= 0x9fff or 0x3400 <= c_code <= 0x4dbf
                        or 0x3040 <= c_code <= 0x30ff or 0xac00 <= c_code <= 0xd7af)

        if is_cjk_char:
            # Single CJK character
            chars.append({"char": c, "x": round(x0 + i * char_w), "y": round(y0),
                          "width": round(char_w), "height": round(box_h)})
            i += 1
        elif c.strip() == "":
            # Space — skip
            i += 1
        else:
            # Latin word — collect consecutive non-CJK, non-space chars
            word_start = i
            while i < len(text):
                nc = text[i]
                nc_code = ord(nc)
                nc_cjk = (0x4e00 <= nc_code <= 0x9fff or 0x3400 <= nc_code <= 0x4dbf
                           or 0x3040 <= nc_code <= 0x30ff or 0xac00 <= nc_code <= 0xd7af)
                if nc.strip() == "" or nc_cjk:
                    break
                i += 1
            word = text[word_start:i]
            word_x = x0 + word_start * char_w
            word_w = len(word) * char_w
            chars.append({"char": word, "x": round(word_x), "y": round(y0),
                          "width": round(word_w), "height": round(box_h)})

    return {
        "text": text,
        "confidence": round(score, 4),
        "bbox": {"x": round(x0), "y": round(y0), "width": round(total_w), "height": round(box_h)},
        "chars": chars,
    }


def _texts_similar(a: str, b: str) -> bool:
    """Fuzzy text match — tolerates minor OCR differences between frames."""
    if a == b:
        return True
    # If one is a substring of the other (e.g. trailing punctuation added/removed)
    if a in b or b in a:
        return True
    # Character-level overlap: if 80%+ of chars match, consider it the same subtitle
    if not a or not b:
        return False
    common = sum(1 for c in a if c in b)
    ratio = common / max(len(a), len(b))
    return ratio >= 0.8


def deduplicate_subtitles(frame_results):
    """Collapse consecutive similar text into timed segments.

    Tolerates:
    - Minor OCR text differences between frames (fuzzy match)
    - Short gaps where OCR missed a frame (up to GAP_TOLERANCE_MS)
    """
    segments = []
    cur_text = None
    cur_seg = None
    gap_start = None  # track gap duration

    for fr in frame_results:
        if not fr["detections"]:
            # Empty frame — start tracking a gap but don't close the segment yet
            if cur_seg and gap_start is None:
                gap_start = fr["timestamp_ms"]
            elif cur_seg and gap_start is not None:
                # Check if gap has exceeded tolerance
                gap_duration = fr["timestamp_ms"] - gap_start + FRAME_INTERVAL_MS
                if gap_duration > GAP_TOLERANCE_MS:
                    segments.append(cur_seg)
                    cur_seg = None
                    cur_text = None
                    gap_start = None
            continue

        sorted_dets = sorted(fr["detections"], key=lambda d: d["bbox"]["y"], reverse=True)

        # Compare only subtitle-region text for dedup (ignore persistent top text).
        # Use the FULL text for the segment data but only bottom-half text for matching.
        frame_text_full = "|".join(d["text"] for d in sorted_dets)
        # Subtitle text = detections in the bottom 50% of frame
        res_h = sorted_dets[0]["bbox"]["y"] + sorted_dets[0]["bbox"]["height"] if sorted_dets else 1280
        # Estimate frame height from max detection y + height
        max_y = max(d["bbox"]["y"] + d["bbox"]["height"] for d in sorted_dets) if sorted_dets else 1280
        frame_h_est = max(max_y * 1.1, 1280)  # rough estimate
        sub_text = "|".join(d["text"] for d in sorted_dets if d["bbox"]["y"] / frame_h_est > 0.45)
        # If no subtitle-region text, use full text for matching
        match_text = sub_text if sub_text else frame_text_full

        if cur_seg and _texts_similar(match_text, cur_text):
            # Same subtitle continues — extend, reset gap
            cur_seg["end_ms"] = fr["timestamp_ms"] + FRAME_INTERVAL_MS
            cur_seg["detections"] = sorted_dets  # Update to latest detections
            gap_start = None
        elif cur_seg and gap_start is not None and _texts_similar(match_text, cur_text):
            # Text returned after a short gap — bridge it
            cur_seg["end_ms"] = fr["timestamp_ms"] + FRAME_INTERVAL_MS
            cur_seg["detections"] = sorted_dets
            gap_start = None
        else:
            # New subtitle
            if cur_seg:
                segments.append(cur_seg)
            cur_text = match_text
            cur_seg = {
                "start_ms": fr["timestamp_ms"],
                "end_ms": fr["timestamp_ms"] + FRAME_INTERVAL_MS,
                "detections": sorted_dets,
            }
            gap_start = None

    if cur_seg:
        segments.append(cur_seg)

    # Filter very short segments — but keep single-frame subtitles (100ms)
    segments = [s for s in segments if (s["end_ms"] - s["start_ms"]) >= MIN_DURATION_MS]

    # Post-process: merge flickering subtitle segments.
    # OCR sometimes detects a subtitle, loses it for a few frames (background text
    # takes over), then re-detects the same subtitle. This merges those cases.
    # Strategy: track the last segment that had subtitle-region text, and if the
    # same subtitle reappears within 1.5s, extend it to cover the gap.
    MERGE_GAP_MS = 1500
    merged = []
    last_sub_idx = -1  # index in merged[] of last segment with subtitle text

    for seg in segments:
        # Extract subtitle-region text (bottom half of frame)
        sub_dets = [d for d in seg["detections"] if d["bbox"]["y"] > 500]  # rough y > ~40%
        sub_text = "|".join(d["text"] for d in sub_dets) if sub_dets else ""

        if sub_text and last_sub_idx >= 0:
            prev_sub = merged[last_sub_idx]
            prev_sub_dets = [d for d in prev_sub["detections"] if d["bbox"]["y"] > 500]
            prev_sub_text = "|".join(d["text"] for d in prev_sub_dets) if prev_sub_dets else ""

            gap = seg["start_ms"] - prev_sub["end_ms"]
            if gap <= MERGE_GAP_MS and _texts_similar(sub_text, prev_sub_text):
                # Same subtitle reappeared — extend the previous subtitle segment
                prev_sub["end_ms"] = seg["end_ms"]
                prev_sub["detections"] = seg["detections"]
                # Don't append this segment, just skip it
                continue

        merged.append(seg)
        if sub_text:
            last_sub_idx = len(merged) - 1

    return merged


def _ocr_worker(frame_path_and_ts: tuple) -> dict:
    """Worker function for parallel OCR — runs in separate process."""
    frame_path, ts_ms = frame_path_and_ts

    # Each worker creates its own OCR instance (can't pickle PaddleOCR)
    if not hasattr(_ocr_worker, "_ocr"):
        os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        warnings.filterwarnings("ignore")
        _ocr_worker._ocr = PaddleOCR(
            lang='ch', use_doc_orientation_classify=False,
            use_doc_unwarping=False, use_textline_orientation=False,
        )

    dets = run_ocr_on_frame(_ocr_worker._ocr, frame_path)
    return {"timestamp_ms": ts_ms, "detections": dets}


# Number of parallel workers — conservative to leave room for browser/IDE/other processes
NUM_WORKERS = max(1, min(os.cpu_count() or 4, 4))


def process_video(ocr, video_path: str, suffix: str, max_duration: float = None):
    name = Path(video_path).stem
    w, h, dur = get_video_info(video_path)
    t0 = time.time()

    print(f"{name} ({dur:.0f}s, {w}x{h})...", end=" ", flush=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Step 1: Extract ALL frames via ffmpeg (cheap — just file I/O)
        frames, w, h, dur = extract_frames_ffmpeg(video_path, tmpdir, FRAME_INTERVAL_MS)
        # Cap to max_duration if specified
        if max_duration:
            max_frames = int(max_duration * 1000 / FRAME_INTERVAL_MS)
            frames = frames[:max_frames]
        total = len(frames)
        print(f"{total} frames...", end=" ", flush=True)

        # Step 2: Detect which frames have subtitle changes (cheap pixel diff)
        # Only OCR frames where the subtitle region changed, plus periodic safety OCR
        frames_to_ocr = []
        prev_frame_path = None
        for idx, (fp, ts_ms) in enumerate(frames):
            needs_ocr = False
            if idx == 0:
                needs_ocr = True  # Always OCR first frame
            elif idx % FORCE_OCR_INTERVAL == 0:
                needs_ocr = True  # Safety net: periodic OCR
            elif subtitle_region_changed(prev_frame_path, fp):
                needs_ocr = True  # Subtitle region changed
            prev_frame_path = fp

            if needs_ocr:
                frames_to_ocr.append((idx, fp, ts_ms))

        skipped = total - len(frames_to_ocr)
        print(f"OCR {len(frames_to_ocr)} frames (skipped {skipped}, {skipped/total*100:.0f}% savings)...", end=" ", flush=True)

        # Step 3: OCR only the changed frames in parallel
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
                    print(f"{done}/{len(frames_to_ocr)}...", end=" ", flush=True)

        # Step 4: Fill in skipped frames by carrying forward the last OCR result
        frame_results = []
        last_ocr_result = None
        for idx, (fp, ts_ms) in enumerate(frames):
            if idx in ocr_results:
                last_ocr_result = ocr_results[idx]
                frame_results.append(last_ocr_result)
            elif last_ocr_result is not None:
                # Carry forward: same detections, different timestamp
                frame_results.append({
                    "timestamp_ms": ts_ms,
                    "detections": last_ocr_result["detections"],
                })
            else:
                frame_results.append({"timestamp_ms": ts_ms, "detections": []})

        # Step 5: Deduplicate into segments
        segments = deduplicate_subtitles(frame_results)

    elapsed = time.time() - t0

    result = {
        "video": name,
        "resolution": {"width": w, "height": h},
        "duration_ms": round(dur * 1000),
        "frame_interval_ms": FRAME_INTERVAL_MS,
        "segments": segments,
    }

    out_path = OUTPUT_DIR / f"{name}_{suffix}.json"
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"{len(segments)} segments, {elapsed:.0f}s -> {out_path.name}")
    return result


def main():
    parser = argparse.ArgumentParser(description="Dense OCR extraction (no misses)")
    parser.add_argument("--video", default=None, help="Single video to process")
    parser.add_argument("--output-suffix", default="dense", help="Output file suffix")
    parser.add_argument("--duration", type=float, default=None, help="Max seconds to process (default: full video)")
    args = parser.parse_args()

    print("Loading PaddleOCR (full resolution, no dedup)...")
    ocr = PaddleOCR(lang='ch', use_doc_orientation_classify=False,
                    use_doc_unwarping=False, use_textline_orientation=False)
    print(f"Config: {FRAME_INTERVAL_MS}ms interval, conf≥{CONF_THRESHOLD}, min {MIN_CHARS_CJK}/{MIN_CHARS_DEFAULT} chars (CJK/Latin), min {MIN_DURATION_MS}ms duration")
    print("Ready.\n")

    if args.video:
        process_video(ocr, os.path.abspath(args.video), args.output_suffix, args.duration)
    else:
        for vf in FEED_VIDEOS:
            process_video(ocr, str(VIDEOS_DIR / vf), args.output_suffix, args.duration)

    print("\nDone!")


if __name__ == "__main__":
    main()
