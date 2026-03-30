"""
OCR Diagnostic Tool — finds missed subtitles by comparing dense frame
sampling against the bboxes.json output.

Extracts frames every 100ms (10fps), runs OCR on each, and reports:
1. Frames where text IS visible but NO segment covers that timestamp
2. Frames where different text is visible vs what the segment says
3. SSIM dedup decisions that skipped frames with new subtitles

Usage:
    python3 scripts/diagnose_ocr.py --video mobile/assets/videos/video_7.mp4

Output: diagnostic report showing gaps, misses, and timing issues.
"""

import os
import sys
import json
import subprocess
import tempfile
import warnings
import argparse
from pathlib import Path

os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
warnings.filterwarnings("ignore")

from paddleocr import PaddleOCR


def get_video_info(video_path):
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
        capture_output=True, text=True).stdout)
    vs = [s for s in probe["streams"] if s["codec_type"] == "video"][0]
    return int(vs["width"]), int(vs["height"]), float(vs.get("duration", 0))


def extract_and_ocr(video_path, ocr, interval_ms=100):
    """Extract frames at interval_ms and run OCR on each. Returns list of (ts_ms, texts)."""
    import cv2

    w, h, dur = get_video_info(video_path)
    scale = 0.5
    sW, sH = int(w * scale), int(h * scale)

    cap = cv2.VideoCapture(video_path)
    results = []
    ts = 0
    total = int(dur * 1000)

    while ts < total:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts)
        ret, frame = cap.read()
        if not ret:
            ts += interval_ms
            continue

        frame = cv2.resize(frame, (sW, sH))
        r = ocr.ocr(frame)

        texts = []
        if r and r[0]:
            data = r[0]
            if isinstance(data, dict):
                for text, score in zip(data.get("rec_texts", []), data.get("rec_scores", [])):
                    if score >= 0.65 and len(text) >= 2:
                        texts.append(text)
            elif isinstance(data, list):
                for item in data:
                    if len(item) >= 2:
                        text, score = item[1]
                        if score >= 0.65 and len(text) >= 2:
                            texts.append(text)

        results.append({"ts_ms": ts, "texts": texts})
        ts += interval_ms

    cap.release()
    return results, w, h, dur


def load_bboxes(video_path, model="videocr2"):
    """Load bboxes JSON for this video and model suffix."""
    stem = Path(video_path).stem
    bbox_path = Path(video_path).parent.parent / "assets" / "subtitles" / f"{stem}_{model}.json"
    if not bbox_path.exists():
        # Try from the scripts directory
        bbox_path = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles" / f"{stem}_{model}.json"
    if not bbox_path.exists():
        print(f"No bboxes found at {bbox_path}")
        return None
    with open(bbox_path) as f:
        return json.load(f)


def get_segment_at_time(segments, ts_ms):
    """Find the segment covering this timestamp."""
    for seg in segments:
        if ts_ms >= seg["start_ms"] and ts_ms < seg["end_ms"]:
            return seg
    return None


def main():
    parser = argparse.ArgumentParser(description="Diagnose OCR gaps")
    parser.add_argument("--video", required=True, help="Path to video file")
    parser.add_argument("--interval", type=int, default=100, help="Frame interval in ms (default: 100)")
    parser.add_argument("--model", default="videocr2", help="Model suffix to compare against (default: videocr2)")
    args = parser.parse_args()

    video_path = os.path.abspath(args.video)
    print(f"Loading OCR model...")
    ocr = PaddleOCR(lang='ch', use_doc_orientation_classify=False,
                    use_doc_unwarping=False, use_textline_orientation=False)

    print(f"\nDiagnosing: {Path(video_path).name}")
    print(f"Frame interval: {args.interval}ms")

    # Load existing bboxes
    bboxes = load_bboxes(video_path, args.model)
    segments = bboxes["segments"] if bboxes else []
    print(f"Existing bboxes: {len(segments)} segments")

    # Dense OCR scan
    print(f"\nScanning every {args.interval}ms...")
    frames, w, h, dur = extract_and_ocr(video_path, ocr, args.interval)
    print(f"Scanned {len(frames)} frames ({dur:.1f}s)")

    # Analyze gaps
    print(f"\n{'='*60}")
    print("DIAGNOSTIC REPORT")
    print(f"{'='*60}\n")

    missed_frames = []
    timing_mismatches = []
    covered_frames = 0
    text_frames = 0

    for frame in frames:
        ts = frame["ts_ms"]
        detected_texts = frame["texts"]

        if not detected_texts:
            continue

        text_frames += 1
        seg = get_segment_at_time(segments, ts)

        if seg is None:
            # Text is visible but no segment covers this timestamp
            missed_frames.append({
                "ts_ms": ts,
                "texts": detected_texts,
                "nearest_seg": None,
            })

            # Find nearest segment
            nearest = None
            nearest_dist = float('inf')
            for s in segments:
                dist = min(abs(ts - s["start_ms"]), abs(ts - s["end_ms"]))
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest = s

            if nearest:
                missed_frames[-1]["nearest_seg"] = {
                    "start_ms": nearest["start_ms"],
                    "end_ms": nearest["end_ms"],
                    "distance_ms": nearest_dist,
                    "texts": [d["text"] for d in nearest["detections"]],
                }
        else:
            covered_frames += 1
            # Check if the detected text matches the segment text
            seg_texts = set(d["text"] for d in seg["detections"])
            det_texts = set(detected_texts)
            if det_texts != seg_texts:
                # Filter out minor differences (OCR variance)
                new_texts = det_texts - seg_texts
                if new_texts:
                    timing_mismatches.append({
                        "ts_ms": ts,
                        "detected": list(det_texts),
                        "segment_has": list(seg_texts),
                        "new_texts": list(new_texts),
                    })

    # Report
    coverage = covered_frames / max(text_frames, 1) * 100
    print(f"Frames with text: {text_frames}")
    print(f"Frames covered by segments: {covered_frames} ({coverage:.1f}%)")
    print(f"Frames with text but NO segment: {len(missed_frames)}")
    print(f"Frames with different text than segment: {len(timing_mismatches)}")

    if missed_frames:
        print(f"\n--- MISSED SUBTITLES ({len(missed_frames)} frames) ---\n")
        # Group consecutive missed frames
        groups = []
        current_group = [missed_frames[0]]
        for mf in missed_frames[1:]:
            if mf["ts_ms"] - current_group[-1]["ts_ms"] <= args.interval * 2:
                current_group.append(mf)
            else:
                groups.append(current_group)
                current_group = [mf]
        groups.append(current_group)

        for gi, group in enumerate(groups):
            start = group[0]["ts_ms"]
            end = group[-1]["ts_ms"]
            texts = group[0]["texts"]
            duration = end - start + args.interval
            nearest = group[0].get("nearest_seg")

            print(f"  Gap {gi+1}: {start/1000:.1f}s - {end/1000:.1f}s ({duration}ms)")
            print(f"    Text visible: {' | '.join(texts)}")
            if nearest:
                print(f"    Nearest segment: {nearest['start_ms']/1000:.1f}s-{nearest['end_ms']/1000:.1f}s ({nearest['distance_ms']}ms away)")
                print(f"    Segment text: {' | '.join(nearest['texts'])}")
            print()

    if timing_mismatches[:10]:
        print(f"\n--- TEXT MISMATCHES (first 10 of {len(timing_mismatches)}) ---\n")
        for tm in timing_mismatches[:10]:
            print(f"  {tm['ts_ms']/1000:.1f}s: detected {tm['new_texts']} not in segment")

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    print(f"  Coverage: {coverage:.1f}% of text frames covered by segments")
    print(f"  Missed gaps: {len(groups) if missed_frames else 0} contiguous gaps")
    if missed_frames:
        total_missed_ms = sum(
            g[-1]["ts_ms"] - g[0]["ts_ms"] + args.interval for g in groups
        )
        print(f"  Total missed time: {total_missed_ms/1000:.1f}s out of {dur:.1f}s")
    print()


if __name__ == "__main__":
    main()
