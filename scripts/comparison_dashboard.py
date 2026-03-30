"""
Scrollingo A/V Comparison Dashboard

Compare OCR results, subtitle removal, and STT transcriptions across all videos.
Run: streamlit run scripts/comparison_dashboard.py
"""

import json
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import streamlit as st

st.set_page_config(page_title="Scrollingo A/V Dashboard", layout="wide")

# Compact video height via CSS
st.markdown("""
<style>
video, iframe[src*="streamlit"] { max-height: 300px !important; }
div[data-testid="stVideo"] video { max-height: 300px; }
div[data-testid="stImage"] img { max-height: 500px; }
</style>
""", unsafe_allow_html=True)

VIDEOS_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos"
SUBTITLES_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "subtitles"


# ─── Data Loading ───

@st.cache_data(ttl=10)  # Refresh every 10s to pick up new files
def get_all_videos():
    """Find all video files and their associated data."""
    videos = []
    for f in sorted(VIDEOS_DIR.glob("video_*.mp4")):
        if "_clean" in f.stem or "_noaudio" in f.stem:
            continue
        stem = f.stem
        vid = {
            "id": stem,
            "path": str(f),
            "label": stem.replace("_", " ").title(),
            "size_mb": f.stat().st_size / 1024 / 1024,
        }

        # Find subtitle data — auto-discover all video_N_*.json files
        vid["subtitle_files"] = {}
        for sub_file in SUBTITLES_DIR.glob(f"{stem}_*.json"):
            name = sub_file.stem.replace(f"{stem}_", "")
            if name:
                vid["subtitle_files"][name] = str(sub_file)
        # Also check for baseline (video_N.json with no suffix)
        baseline = SUBTITLES_DIR / f"{stem}.json"
        if baseline.exists():
            vid["subtitle_files"]["baseline"] = str(baseline)

        videos.append(vid)
    return videos


@st.cache_data(ttl=10)
def load_subtitle_data(path):
    # Include file mtime in cache key so updated files are re-read
    mtime = os.path.getmtime(path)
    with open(path) as f:
        return json.load(f)


# ─── Helpers ───

def extract_frame(video_path, time_ms):
    """Extract a single frame from a video at the given timestamp."""
    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_MSEC, time_ms)
    ok, frame = cap.read()
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    if ok:
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), fps, total_frames
    return None, fps, total_frames


def draw_bboxes_on_frame(frame_rgb, subtitle_data, time_ms, color=(52, 168, 83),
                         show_chars=True, thick=3):
    """Draw OCR bounding boxes on a frame with high visibility."""
    pil_img = Image.fromarray(frame_rgb)
    draw = ImageDraw.Draw(pil_img)
    res = subtitle_data["resolution"]
    frame_h, frame_w = frame_rgb.shape[:2]
    scale_x = frame_w / res["width"]
    scale_y = frame_h / res["height"]

    seg = None
    for s in subtitle_data["segments"]:
        if s["start_ms"] <= time_ms < s["end_ms"]:
            seg = s
            break

    texts = []
    detections_info = []
    if seg:
        for det in seg["detections"]:
            bbox = det["bbox"]
            x1 = int(bbox["x"] * scale_x)
            y1 = int(bbox["y"] * scale_y)
            x2 = int((bbox["x"] + bbox["width"]) * scale_x)
            y2 = int((bbox["y"] + bbox["height"]) * scale_y)

            # Detection bbox — thick colored outline
            draw.rectangle([x1, y1, x2, y2], outline=color, width=thick)

            # Per-character boxes
            if show_chars:
                for ch in det.get("chars", []):
                    cx1 = int(ch["x"] * scale_x)
                    cy1 = int(ch["y"] * scale_y)
                    cx2 = int((ch["x"] + ch["width"]) * scale_x)
                    cy2 = int((ch["y"] + ch["height"]) * scale_y)
                    draw.rectangle([cx1, cy1, cx2, cy2], outline=color, width=1)

            # Label with background for readability
            label = f"{det['text']} ({det['confidence']:.0%})"
            label_y = max(0, y1 - 18)
            # Dark background behind text
            text_bbox = draw.textbbox((x1, label_y), label)
            draw.rectangle([text_bbox[0]-1, text_bbox[1]-1, text_bbox[2]+1, text_bbox[3]+1],
                           fill=(0, 0, 0, 180))
            draw.text((x1, label_y), label, fill=color)

            texts.append(det["text"])
            detections_info.append({
                "text": det["text"],
                "confidence": det["confidence"],
                "x": bbox["x"], "y": bbox["y"],
                "w": bbox["width"], "h": bbox["height"],
                "y_pct": f"{bbox['y'] / res['height']:.0%}",
                "chars": len(det.get("chars", [])),
            })

    return pil_img, texts, detections_info


PREVIEW_DIR = Path(__file__).parent.parent / "mobile" / "assets" / "videos" / "ocr_previews"
PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


def render_bbox_video(video_path, subtitle_data, color, output_path, duration=10):
    """Render a video with bboxes baked in for native playback."""
    import subprocess as _sp
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    max_frames = int(duration * fps)
    res = subtitle_data["resolution"]
    sx, sy = w / res["width"], h / res["height"]

    temp = str(output_path) + ".tmp.mp4"
    writer = cv2.VideoWriter(temp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    idx = 0
    while idx < max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        t_ms = (idx / fps) * 1000
        seg = None
        for s in subtitle_data["segments"]:
            if s["start_ms"] <= t_ms < s["end_ms"]:
                seg = s
                break
        if seg:
            for det in seg["detections"]:
                bb = det["bbox"]
                x1, y1 = int(bb["x"]*sx), int(bb["y"]*sy)
                x2, y2 = int((bb["x"]+bb["width"])*sx), int((bb["y"]+bb["height"])*sy)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color[::-1], 3)
                for ch in det.get("chars", []):
                    cx1, cy1 = int(ch["x"]*sx), int(ch["y"]*sy)
                    cx2, cy2 = int((ch["x"]+ch["width"])*sx), int((ch["y"]+ch["height"])*sy)
                    cv2.rectangle(frame, (cx1, cy1), (cx2, cy2), color[::-1], 1)
                cv2.putText(frame, f"[{det['text']}] {det['confidence']:.0%}",
                            (x1, max(14, y1-4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color[::-1], 1)
        writer.write(frame)
        idx += 1
    cap.release()
    writer.release()
    _sp.run(["ffmpeg", "-y", "-i", temp, "-i", str(video_path),
             "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
             "-map", "0:v:0", "-map", "1:a:0?", "-c:a", "aac", "-movflags", "+faststart",
             "-t", str(duration), str(output_path)], capture_output=True)
    Path(temp).unlink(missing_ok=True)


# ─── UI ───

st.title("Scrollingo A/V Comparison Dashboard")

videos = get_all_videos()

section = st.sidebar.radio("View", [
    "Model Gallery",
    "OCR Deep Compare",
    "OCR Gallery",
    "STT Results",
    "Summary Table",
])


# ─── Section: Model Gallery ───

MODEL_COLORS_ALL = {
    "dense": (52, 168, 83),        # green
    "dense_opt": (0, 230, 180),    # teal
    "videocr2": (66, 133, 244),    # blue
    "pipeline": (234, 67, 53),     # red
    "baseline": (255, 152, 0),     # orange
}

if section == "Model Gallery":
    st.header("Model Gallery — All Videos at a Glance")

    # Find all available models across all videos
    all_models = set()
    for v in videos:
        all_models.update(v["subtitle_files"].keys())
    all_models = sorted(all_models)

    selected_model = st.radio("OCR Model", all_models, horizontal=True,
                               index=all_models.index("dense_opt") if "dense_opt" in all_models else 0)
    model_color = MODEL_COLORS_ALL.get(selected_model, (180, 180, 180))

    # Time control
    time_key = "gallery_time"
    if time_key not in st.session_state:
        st.session_state[time_key] = 1.0

    import time as _time

    play_key = "gallery_playing"
    speed_key = "gallery_speed"
    if play_key not in st.session_state:
        st.session_state[play_key] = False
    if speed_key not in st.session_state:
        st.session_state[speed_key] = 0.5

    ctrl = st.columns([1, 1, 1, 1, 1, 1, 1, 3])
    with ctrl[0]:
        if st.button("⏪ -1s", key="gal_b1"):
            st.session_state[play_key] = False
            st.session_state[time_key] = max(0, st.session_state[time_key] - 1.0)
    with ctrl[1]:
        if st.button("◀ -1f", key="gal_bf"):
            st.session_state[play_key] = False
            st.session_state[time_key] = max(0, st.session_state[time_key] - 0.1)
    with ctrl[2]:
        is_playing = st.session_state[play_key]
        if st.button("⏸ Pause" if is_playing else "▶ Play", key="gal_play", use_container_width=True):
            st.session_state[play_key] = not is_playing
    with ctrl[3]:
        if st.button("▶ +1f", key="gal_ff"):
            st.session_state[play_key] = False
            st.session_state[time_key] += 0.1
    with ctrl[4]:
        if st.button("⏩ +1s", key="gal_f1"):
            st.session_state[play_key] = False
            st.session_state[time_key] += 1.0
    with ctrl[5]:
        speed_opts = {"0.5x": 0.2, "1x": 0.5, "2x": 1.0}
        speed_label = st.selectbox("Speed", list(speed_opts.keys()), index=1,
                                    key="gal_speed_sel", label_visibility="collapsed")
        st.session_state[speed_key] = speed_opts[speed_label]
    with ctrl[7]:
        st.session_state[time_key] = st.slider(
            "Time", 0.0, 60.0, st.session_state[time_key], step=0.1, format="%.1fs",
            key="gal_slider", label_visibility="collapsed")

    time_ms = st.session_state[time_key] * 1000
    st.caption(f"**{st.session_state[time_key]:.1f}s** — Model: **{selected_model}**")

    # Gallery grid: 4 videos per row
    vids_with_model = [v for v in videos if selected_model in v["subtitle_files"]]
    cols_per_row = 4

    for row_start in range(0, len(vids_with_model), cols_per_row):
        row_vids = vids_with_model[row_start:row_start + cols_per_row]
        cols = st.columns(cols_per_row)
        for i, v in enumerate(row_vids):
            with cols[i]:
                sub_data = load_subtitle_data(v["subtitle_files"][selected_model])
                dur_ms = sub_data.get("duration_ms", 1)
                t = min(time_ms, dur_ms - 1)

                frame_rgb, fps, total = extract_frame(v["path"], t)
                if frame_rgb is not None:
                    img, texts, _ = draw_bboxes_on_frame(frame_rgb, sub_data, t, model_color)
                    # Compact display
                    w = 240
                    h = int(img.height * w / img.width)
                    st.image(img.resize((w, h)), use_container_width=False)

                segs = sub_data["segments"]
                covered = sum(s["end_ms"] - s["start_ms"] for s in segs)
                text_str = " | ".join(texts) if texts else "—"
                st.markdown(f"**{v['id']}** {len(segs)} segs {covered/dur_ms*100:.0f}%")
                st.caption(text_str[:60])

    # Show videos without this model
    missing = [v for v in videos if selected_model not in v["subtitle_files"]]
    if missing:
        st.caption(f"Missing {selected_model}: {', '.join(v['id'] for v in missing)}")

    # Generate playback previews for all videos with this model
    st.markdown("---")
    st.subheader("Video Playback with BBoxes")

    if st.button("Generate All Previews", key="gal_gen_all"):
        progress = st.progress(0, text="Rendering...")
        for idx, v in enumerate(vids_with_model):
            out = PREVIEW_DIR / f"{v['id']}_{selected_model}_bbox.mp4"
            if not out.exists():
                data = load_subtitle_data(v["subtitle_files"][selected_model])
                render_bbox_video(v["path"], data, model_color, out)
            progress.progress((idx + 1) / len(vids_with_model),
                              text=f"Rendered {idx + 1}/{len(vids_with_model)}")
        st.success("Done! Scroll down to watch.")

    # Show generated preview videos in grid
    preview_vids = [v for v in vids_with_model
                    if (PREVIEW_DIR / f"{v['id']}_{selected_model}_bbox.mp4").exists()]
    if preview_vids:
        for row_start in range(0, len(preview_vids), cols_per_row):
            row = preview_vids[row_start:row_start + cols_per_row]
            cols = st.columns(cols_per_row)
            for i, v in enumerate(row):
                with cols[i]:
                    st.caption(f"**{v['id']}**")
                    st.video(str(PREVIEW_DIR / f"{v['id']}_{selected_model}_bbox.mp4"))

    # Auto-advance when playing
    if st.session_state.get(play_key, False):
        step = st.session_state.get(speed_key, 0.5)
        st.session_state[time_key] += step
        st.rerun()


# ─── Section: OCR Deep Compare ───

elif section == "OCR Deep Compare":
    st.header("OCR Deep Compare")

    # Video selector
    video_options = {v["id"]: v for v in videos if v["subtitle_files"]}
    selected_vid_id = st.selectbox("Video", list(video_options.keys()))
    video = video_options[selected_vid_id]

    # Available models for this video
    available_models = list(video["subtitle_files"].keys())

    # Model toggles with colored checkboxes
    st.markdown("**Models** (toggle to show/hide)")
    toggle_cols = st.columns(len(available_models))
    enabled_models = {}
    for i, model in enumerate(available_models):
        color = MODEL_COLORS_ALL.get(model, (180, 180, 180))
        with toggle_cols[i]:
            enabled_models[model] = st.checkbox(
                f"🟢 {model}" if color == (52, 168, 83) else
                f"🔵 {model}" if color == (66, 133, 244) else
                f"🔴 {model}" if color == (234, 67, 53) else
                f"🟠 {model}",
                value=True, key=f"toggle_{selected_vid_id}_{model}")

    active_models = [m for m, on in enabled_models.items() if on]

    # --- Generate bbox overlay videos for native playback ---
    if st.button("Generate Playback Previews", key="gen_previews"):
        with st.spinner("Rendering bbox overlay videos..."):
            for model in active_models:
                color = MODEL_COLORS_ALL.get(model, (180, 180, 180))
                out = PREVIEW_DIR / f"{selected_vid_id}_{model}_bbox.mp4"
                if not out.exists():
                    data = load_subtitle_data(video["subtitle_files"][model])
                    render_bbox_video(video["path"], data, color, out)
            st.success("Done! Scroll down to watch.")

    # Show generated preview videos side by side
    preview_models = [m for m in active_models
                      if (PREVIEW_DIR / f"{selected_vid_id}_{m}_bbox.mp4").exists()]
    if preview_models:
        st.subheader("Playback with BBoxes")
        vid_cols = st.columns(min(len(preview_models) + 1, 4))
        with vid_cols[0]:
            st.caption("**Original**")
            st.video(video["path"])
        for i, model in enumerate(preview_models):
            with vid_cols[(i + 1) % min(len(preview_models) + 1, 4)]:
                color = MODEL_COLORS_ALL.get(model, (180,180,180))
                color_hex = "#{:02x}{:02x}{:02x}".format(*color)
                st.markdown(f"<span style='color:{color_hex};font-weight:bold'>{model}</span>",
                            unsafe_allow_html=True)
                st.video(str(PREVIEW_DIR / f"{selected_vid_id}_{model}_bbox.mp4"))

    st.markdown("---")
    st.subheader("Frame-by-Frame Inspector")

    # Load all enabled model data
    model_data = {}
    for m in active_models:
        model_data[m] = load_subtitle_data(video["subtitle_files"][m])

    # Get video info
    first_data = list(model_data.values())[0] if model_data else None
    duration_ms = first_data["duration_ms"] if first_data else 10000
    duration_sec = duration_ms / 1000

    # Frame-by-frame controls + play
    import time as _time

    time_key = f"deep_{selected_vid_id}_time"
    play_key = f"deep_{selected_vid_id}_playing"
    speed_key = f"deep_{selected_vid_id}_speed"
    if time_key not in st.session_state:
        st.session_state[time_key] = 0.5
    if play_key not in st.session_state:
        st.session_state[play_key] = False
    if speed_key not in st.session_state:
        st.session_state[speed_key] = 0.1  # seconds per step

    # Transport controls row 1: play + speed
    ctrl_row1 = st.columns([1, 1, 2])
    with ctrl_row1[0]:
        is_playing = st.session_state[play_key]
        if st.button("⏸ Pause" if is_playing else "▶ Play", key="deep_play", use_container_width=True):
            st.session_state[play_key] = not is_playing
    with ctrl_row1[1]:
        # Each rerun takes ~0.5-1s overhead (frame extract + draw + streamlit rerender)
        # So step size must account for that — 1x means advance by ~1s worth of video per rerun
        speed_options = {"0.25x": 0.1, "0.5x": 0.25, "1x": 0.5, "2x": 1.0, "5x": 2.5}
        speed_label = st.select_slider("Playback Speed", options=list(speed_options.keys()),
                                        value="1x", key="deep_speed_label")
        st.session_state[speed_key] = speed_options[speed_label]
    with ctrl_row1[2]:
        st.session_state[time_key] = st.slider(
            "Time", 0.0, duration_sec, st.session_state[time_key],
            step=0.033, format="%.3fs", key=f"deep_slider_{selected_vid_id}",
            label_visibility="collapsed")

    # Transport controls row 2: frame stepping
    ctrl_row2 = st.columns([1, 1, 1, 1, 1, 1, 2])
    with ctrl_row2[0]:
        if st.button("⏪ -1s", key="deep_b1"):
            st.session_state[play_key] = False
            st.session_state[time_key] = max(0, st.session_state[time_key] - 1.0)
    with ctrl_row2[1]:
        if st.button("◀◀ -5f", key="deep_b5"):
            st.session_state[play_key] = False
            st.session_state[time_key] = max(0, st.session_state[time_key] - 5 * 0.033)
    with ctrl_row2[2]:
        if st.button("◀ -1f", key="deep_b1f"):
            st.session_state[play_key] = False
            st.session_state[time_key] = max(0, st.session_state[time_key] - 0.033)
    with ctrl_row2[3]:
        if st.button("▶ +1f", key="deep_f1f"):
            st.session_state[play_key] = False
            st.session_state[time_key] = min(duration_sec, st.session_state[time_key] + 0.033)
    with ctrl_row2[4]:
        if st.button("▶▶ +5f", key="deep_f5"):
            st.session_state[play_key] = False
            st.session_state[time_key] = min(duration_sec, st.session_state[time_key] + 5 * 0.033)
    with ctrl_row2[5]:
        if st.button("⏩ +1s", key="deep_f1"):
            st.session_state[play_key] = False
            st.session_state[time_key] = min(duration_sec, st.session_state[time_key] + 1.0)
    with ctrl_row2[6]:
        st.caption(f"**{st.session_state[time_key]:.3f}s** ({st.session_state[time_key] * 1000:.0f}ms)")

    time_ms = st.session_state[time_key] * 1000

    # Extract frame once
    frame_rgb, fps, total_frames = extract_frame(video["path"], time_ms)

    if frame_rgb is not None:
        # Show side-by-side: one image per enabled model + original
        num_views = len(active_models) + 1  # +1 for original
        img_cols = st.columns(min(num_views, 4))

        # Original (no bboxes)
        with img_cols[0]:
            st.caption("**Original**")
            orig_img = Image.fromarray(frame_rgb)
            w = 320
            h = int(orig_img.height * w / orig_img.width)
            st.image(orig_img.resize((w, h)), use_container_width=False)

        # Each model with bboxes overlaid
        for idx, model in enumerate(active_models):
            col_idx = (idx + 1) % min(num_views, 4)
            with img_cols[col_idx]:
                color = MODEL_COLORS_ALL.get(model, (180, 180, 180))
                img, texts, det_info = draw_bboxes_on_frame(frame_rgb.copy(), model_data[model], time_ms, color)
                w = 320
                h = int(img.height * w / img.width)
                st.image(img.resize((w, h)), use_container_width=False)
                color_hex = "#{:02x}{:02x}{:02x}".format(*color)
                st.markdown(f"<span style='color:{color_hex};font-weight:bold'>{model}</span>",
                            unsafe_allow_html=True)
                if texts:
                    st.caption(" | ".join(texts))
                else:
                    st.caption("—")

        # Combined overlay: all models on one frame
        st.markdown("---")
        st.subheader("All Models Combined")
        combined_img = Image.fromarray(frame_rgb.copy())
        combined_draw = ImageDraw.Draw(combined_img)
        all_det_rows = []

        for model in active_models:
            color = MODEL_COLORS_ALL.get(model, (180, 180, 180))
            data = model_data[model]
            res = data["resolution"]
            frame_h, frame_w = frame_rgb.shape[:2]
            sx = frame_w / res["width"]
            sy = frame_h / res["height"]

            seg = None
            for s in data["segments"]:
                if s["start_ms"] <= time_ms < s["end_ms"]:
                    seg = s
                    break
            if seg:
                for det in seg["detections"]:
                    bbox = det["bbox"]
                    x1 = int(bbox["x"] * sx)
                    y1 = int(bbox["y"] * sy)
                    x2 = int((bbox["x"] + bbox["width"]) * sx)
                    y2 = int((bbox["y"] + bbox["height"]) * sy)
                    # Thick box with char-level boxes
                    combined_draw.rectangle([x1, y1, x2, y2], outline=color, width=3)
                    for ch in det.get("chars", []):
                        cx1 = int(ch["x"] * sx)
                        cy1 = int(ch["y"] * sy)
                        cx2 = int((ch["x"] + ch["width"]) * sx)
                        cy2 = int((ch["y"] + ch["height"]) * sy)
                        combined_draw.rectangle([cx1, cy1, cx2, cy2], outline=color, width=1)
                    # Label with background
                    label = f"[{model}] {det['text']}"
                    label_y = max(0, y1 - 16)
                    tb = combined_draw.textbbox((x1, label_y), label)
                    combined_draw.rectangle([tb[0]-1, tb[1]-1, tb[2]+1, tb[3]+1], fill=(0, 0, 0, 200))
                    combined_draw.text((x1, label_y), label, fill=color)

                    all_det_rows.append({
                        "Model": model,
                        "Text": det["text"],
                        "Conf": f"{det['confidence']:.1%}",
                        "Position": f"({bbox['x']}, {bbox['y']})",
                        "Size": f"{bbox['width']}×{bbox['height']}",
                        "Y%": f"{bbox['y']/res['height']:.0%}",
                        "Chars": len(det.get("chars", [])),
                        "Segment": f"{seg['start_ms']}-{seg['end_ms']}ms",
                    })

        w = 600
        h = int(combined_img.height * w / combined_img.width)
        st.image(combined_img.resize((w, h)), use_container_width=False)

        # Legend
        legend_cols = st.columns(len(active_models))
        for i, model in enumerate(active_models):
            color = MODEL_COLORS_ALL.get(model, (180, 180, 180))
            color_hex = "#{:02x}{:02x}{:02x}".format(*color)
            legend_cols[i].markdown(
                f"<span style='color:{color_hex};font-weight:bold'>■ {model}</span>",
                unsafe_allow_html=True)

        # Detailed position + text table (markdown to avoid pyarrow)
        if all_det_rows:
            st.subheader("Detection Details")
            header = "| Model | Text | Conf | Position | Size | Y% | Chars | Segment |"
            sep = "|-------|------|------|----------|------|----|-------|---------|"
            rows_md = [header, sep]
            for r in all_det_rows:
                rows_md.append(f"| {r['Model']} | {r['Text']} | {r['Conf']} | {r['Position']} | {r['Size']} | {r['Y%']} | {r['Chars']} | {r['Segment']} |")
            st.markdown("\n".join(rows_md))
        else:
            st.info("No detections at this timestamp")

    # Timeline per model
    st.markdown("---")
    st.subheader("Timelines")
    for model in active_models:
        data = model_data[model]
        segments = data["segments"]
        dur = data["duration_ms"]
        covered = sum(s["end_ms"] - s["start_ms"] for s in segments)
        color = MODEL_COLORS_ALL.get(model, (180, 180, 180))
        color_norm = tuple(c / 255 for c in color)

        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches

        fig, ax = plt.subplots(figsize=(12, 0.4))
        for s in segments:
            start = s["start_ms"] / dur
            width = (s["end_ms"] - s["start_ms"]) / dur
            ax.add_patch(mpatches.FancyBboxPatch(
                (start, 0.1), width, 0.8, facecolor=color_norm, alpha=0.7))
        ax.axvline(time_ms / dur, color="white", linewidth=2)
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.set_yticks([])
        ax.set_facecolor("#1a1a1a")
        fig.patch.set_facecolor("#1a1a1a")
        ax.set_xticks([i / 10 for i in range(11)])
        ax.set_xticklabels([f"{dur/1000*i/10:.0f}s" for i in range(11)], fontsize=7, color="white")
        ax.tick_params(colors="white")
        color_hex = "#{:02x}{:02x}{:02x}".format(*color)
        ax.set_title(f"{model} — {len(segments)} segs, {covered/dur*100:.0f}%",
                      fontsize=10, color=color_hex, loc="left")
        fig.tight_layout()
        st.pyplot(fig)
        plt.close()

    # Auto-advance when playing
    if st.session_state.get(play_key, False):
        step = st.session_state.get(speed_key, 0.1)
        new_time = st.session_state[time_key] + step
        if new_time >= duration_sec:
            st.session_state[play_key] = False
            st.session_state[time_key] = 0.0
        else:
            st.session_state[time_key] = new_time
        st.rerun()


# ─── Section: OCR Gallery ───

elif section == "OCR Gallery":
    st.header("OCR Detection — All Videos")

    MODEL_COLORS = {
        "dense": (52, 168, 83),
        "videocr2": (66, 133, 244),
        "pipeline": (234, 67, 53),
        "baseline": (255, 152, 0),
    }

    # Global OCR model selector
    all_models = set()
    for v in videos:
        all_models.update(v["subtitle_files"].keys())
    selected_model = st.selectbox("OCR Model", sorted(all_models), index=0)
    model_color = MODEL_COLORS.get(selected_model, (200, 200, 200))

    # Global time control with frame stepping
    st.markdown("**Time control** (applies to all videos)")
    time_key = "ocr_time_sec"
    if time_key not in st.session_state:
        st.session_state[time_key] = 1.0

    btn_cols = st.columns([1, 1, 1, 1, 1, 3])
    with btn_cols[0]:
        if st.button("⏪ -1s", key="ocr_back1"):
            st.session_state[time_key] = max(0, st.session_state[time_key] - 1.0)
    with btn_cols[1]:
        if st.button("◀ -frame", key="ocr_backf"):
            st.session_state[time_key] = max(0, st.session_state[time_key] - 0.033)
    with btn_cols[2]:
        if st.button("▶ +frame", key="ocr_fwdf"):
            st.session_state[time_key] += 0.033
    with btn_cols[3]:
        if st.button("⏩ +1s", key="ocr_fwd1"):
            st.session_state[time_key] += 1.0
    with btn_cols[5]:
        st.session_state[time_key] = st.slider(
            "Seek", 0.0, 300.0, st.session_state[time_key], step=0.033, format="%.2fs",
            key="ocr_slider", label_visibility="collapsed")

    time_ms = st.session_state[time_key] * 1000
    st.caption(f"Current time: **{st.session_state[time_key]:.2f}s** ({time_ms:.0f}ms)")

    # Gallery: 3 videos per row
    cols_per_row = 3
    vids_with_sub = [v for v in videos if selected_model in v["subtitle_files"]]

    for row_start in range(0, len(vids_with_sub), cols_per_row):
        row_vids = vids_with_sub[row_start:row_start + cols_per_row]
        cols = st.columns(cols_per_row)
        for i, v in enumerate(row_vids):
            with cols[i]:
                sub_data = load_subtitle_data(v["subtitle_files"][selected_model])
                dur_ms = sub_data.get("duration_ms", 1)

                # Clamp time to this video's duration
                t = min(time_ms, dur_ms - 1)
                frame_rgb, fps, total = extract_frame(v["path"], t)

                if frame_rgb is not None:
                    img, texts, _ = draw_bboxes_on_frame(frame_rgb, sub_data, t, model_color)
                    # Resize for compact display
                    display_w = 280
                    display_h = int(img.height * display_w / img.width)
                    st.image(img.resize((display_w, display_h)), use_container_width=False)

                text_str = " | ".join(texts) if texts else "—"
                segs = sub_data["segments"]
                covered = sum(s["end_ms"] - s["start_ms"] for s in segs)
                st.markdown(f"**{v['id']}** — {len(segs)} segs, {covered/dur_ms*100:.0f}%")
                st.caption(f"{text_str}")


# ─── Section: STT Results ───

elif section == "STT Results":
    st.header("STT Transcriptions — All Videos")

    stt_vids = []
    for v in videos:
        pf = v["subtitle_files"].get("pipeline")
        if pf:
            data = load_subtitle_data(pf)
            if data.get("subtitle_source") == "stt":
                stt_vids.append((v, data))

    if not stt_vids:
        st.info("No STT-processed videos found. Run the pipeline with --force-stt")
    else:
        cols_per_row = 3
        for row_start in range(0, len(stt_vids), cols_per_row):
            row = stt_vids[row_start:row_start + cols_per_row]
            cols = st.columns(cols_per_row)
            for i, (v, data) in enumerate(row):
                with cols[i]:
                    st.markdown(f"**{v['id']}** — {len(data['segments'])} segments")
                    st.video(v["path"])
                    full_text = ""
                    for seg in data["segments"]:
                        for det in seg["detections"]:
                            full_text += det["text"] + " "
                    st.text_area("Transcript", full_text.strip(), height=80,
                                 key=f"stt_{v['id']}")


# ─── Section: Summary Table ───

elif section == "Summary Table":
    st.header("All Videos Summary")

    rows = []
    for v in videos:
        row = {
            "Video": v["id"],
            "Size (MB)": round(v["size_mb"], 1),
        }

        # Best subtitle data
        for source_name in ("dense", "videocr2", "pipeline", "baseline"):
            if source_name in v["subtitle_files"]:
                data = load_subtitle_data(v["subtitle_files"][source_name])
                segs = data.get("segments", [])
                dur = data.get("duration_ms", 1)
                covered = sum(s["end_ms"] - s["start_ms"] for s in segs)
                row["OCR Source"] = source_name
                row["Segments"] = len(segs)
                row["Coverage %"] = round(covered / dur * 100, 1) if dur else 0
                row["Sub Source"] = data.get("subtitle_source", "ocr")
                break
        else:
            row["OCR Source"] = "-"
            row["Segments"] = 0
            row["Coverage %"] = 0
            row["Sub Source"] = "-"

        rows.append(row)

    if rows:
        header = "| " + " | ".join(rows[0].keys()) + " |"
        sep = "| " + " | ".join(["---"] * len(rows[0])) + " |"
        md = [header, sep]
        for r in rows:
            md.append("| " + " | ".join(str(v) for v in r.values()) + " |")
        st.markdown("\n".join(md))

