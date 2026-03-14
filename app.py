import json
import os
import re

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
    "Mobile/15E148 Safari/604.1"
)

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def _extract_aweme_id(url):
    """Extract the numeric aweme_id from a Douyin URL."""
    match = re.search(r"/video/(\d+)", url)
    if match:
        return match.group(1)
    match = re.search(r"modal_id=(\d+)", url)
    if match:
        return match.group(1)
    return None


def _resolve_short_url(short_url):
    """Follow redirects on v.douyin.com short links to get the real URL."""
    try:
        resp = requests.get(
            short_url,
            headers={"User-Agent": MOBILE_UA, "Referer": "https://www.douyin.com/"},
            allow_redirects=True,
            timeout=15,
        )
        return resp.url
    except requests.RequestException:
        return None


def _fetch_video_info(aweme_id):
    """Fetch video info via the iesdouyin.com share page (bypasses anti-crawler JS)."""
    url = f"https://www.iesdouyin.com/share/video/{aweme_id}/"
    headers = {"User-Agent": MOBILE_UA}

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        return None, f"Failed to fetch share page: {e}"

    # Extract _ROUTER_DATA JSON from the page
    match = re.search(r"_ROUTER_DATA\s*=\s*({.+?})\s*</script>", resp.text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            item_list = _deep_find(data, "item_list")
            if item_list and len(item_list) > 0:
                return _extract_from_share_item(item_list[0], aweme_id), None
        except (json.JSONDecodeError, TypeError):
            pass

    return None, "Could not extract video info from share page"


def _deep_find(obj, target_key):
    """Recursively search a dict/list for a key and return its value."""
    if isinstance(obj, dict):
        if target_key in obj:
            return obj[target_key]
        for v in obj.values():
            result = _deep_find(v, target_key)
            if result is not None:
                return result
    elif isinstance(obj, list):
        for item in obj:
            result = _deep_find(item, target_key)
            if result is not None:
                return result
    return None


def _extract_from_share_item(item, aweme_id):
    """Extract structured info from an iesdouyin share page item."""
    video = item.get("video", {})
    author = item.get("author", {})
    stats = item.get("statistics", {})

    # Get video play URL (without watermark: replace /playwm/ with /play/)
    video_url = None
    play_addr = video.get("play_addr", {})
    if isinstance(play_addr, dict):
        urls = play_addr.get("url_list", [])
        if urls:
            video_url = urls[0].replace("/playwm/", "/play/")

    if video_url and not video_url.startswith("http"):
        video_url = "https:" + video_url

    # Get cover/thumbnail
    cover_url = None
    cover = video.get("cover", {})
    if isinstance(cover, dict):
        urls = cover.get("url_list", [])
        if urls:
            cover_url = urls[0]

    duration = video.get("duration", 0)
    if duration and duration > 1000:
        duration = duration // 1000  # Convert ms to seconds

    return {
        "aweme_id": item.get("aweme_id") or aweme_id,
        "title": item.get("desc", "Untitled"),
        "author": author.get("nickname", "Unknown"),
        "author_id": author.get("unique_id") or author.get("uid", ""),
        "duration": duration,
        "thumbnail": cover_url,
        "video_url": video_url,
        "likes": stats.get("digg_count", 0),
        "comments": stats.get("comment_count", 0),
        "shares": stats.get("share_count", 0),
    }


def _sanitize_filename(name, max_len=50):
    """Remove unsafe characters and truncate for use as a filename."""
    name = re.sub(r'[\\/:*?"<>|\n\r\t]', "", name)
    name = name.strip(". ")
    return name[:max_len] if name else "video"


# ── Routes ────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/parse", methods=["POST"])
def parse_url():
    """Parse a Douyin URL and return video info."""
    body = request.get_json(force=True)
    raw_url = (body.get("url") or "").strip()

    if not raw_url:
        return jsonify({"error": "No URL provided"}), 400

    # Extract URL from share text (users sometimes paste the full share message)
    url_match = re.search(r"https?://[^\s]+", raw_url)
    if url_match:
        raw_url = url_match.group(0)

    # Resolve short link if needed
    if "v.douyin.com" in raw_url or "vm.douyin.com" in raw_url:
        resolved = _resolve_short_url(raw_url)
        if not resolved:
            return jsonify({"error": "Failed to resolve short link"}), 400
        raw_url = resolved

    aweme_id = _extract_aweme_id(raw_url)
    if not aweme_id:
        return jsonify({"error": "Could not extract video ID from URL"}), 400

    info, err = _fetch_video_info(aweme_id)
    if not info:
        return jsonify({"error": err or "Failed to get video info"}), 400

    return jsonify(info)


@app.route("/api/download", methods=["POST"])
def download_video():
    """Download a video to the downloads directory."""
    body = request.get_json(force=True)
    video_url = body.get("video_url")
    title = body.get("title", "video")
    author = body.get("author", "unknown")
    aweme_id = body.get("aweme_id", "")

    if not video_url:
        return jsonify({"error": "No video URL provided"}), 400

    safe_author = _sanitize_filename(author, 20)
    safe_title = _sanitize_filename(title, 40)
    filename = f"{safe_author}_{safe_title}_{aweme_id}.mp4"
    filepath = os.path.join(DOWNLOADS_DIR, filename)

    if os.path.exists(filepath):
        return jsonify({"status": "exists", "filename": filename})

    headers = {
        "User-Agent": MOBILE_UA,
    }

    try:
        resp = requests.get(video_url, headers=headers, stream=True, timeout=60)
        resp.raise_for_status()

        with open(filepath, "wb") as f:
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if chunk:
                    f.write(chunk)
    except requests.RequestException as e:
        # Clean up partial file
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({"error": f"Download failed: {e}"}), 500

    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    return jsonify({
        "status": "ok",
        "filename": filename,
        "size_mb": round(size_mb, 2),
    })


@app.route("/api/downloads", methods=["GET"])
def list_downloads():
    """List all downloaded videos."""
    files = []
    for name in sorted(os.listdir(DOWNLOADS_DIR)):
        if not name.endswith(".mp4"):
            continue
        path = os.path.join(DOWNLOADS_DIR, name)
        size_mb = os.path.getsize(path) / (1024 * 1024)
        files.append({"filename": name, "size_mb": round(size_mb, 2)})
    return jsonify(files)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
