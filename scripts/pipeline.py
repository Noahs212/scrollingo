"""
Scrollingo Video Processing Pipeline (M3)

Processes a video with burned-in Chinese subtitles:
1. Normalize to 720p with FFmpeg
2. Upload video + thumbnail to R2
3. Insert video row in Supabase (status='processing')
4. Run VideOCR (SSIM dedup) to extract subtitle bounding boxes
5. Chinese word segmentation (jieba) on OCR text
6. Generate translations + definitions via Claude Haiku 3.5 (OpenRouter)
7. Insert vocab_words, word_definitions, video_words into Supabase
8. Upload bboxes.json to R2
9. Mark video status='ready'

Usage:
    python3 scripts/pipeline.py --video ~/downloads/chinese_video.mp4 --language zh --native-lang en

Requires:
    pip install supabase jieba openai  # openai SDK works with OpenRouter
    Environment variables in .env: OpenrouterAPIKey, SupabaseUrl, SupbaseAnonKey
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
                     cdn_url: str, thumbnail_url: str) -> dict:
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
        "subtitle_source": "ocr",
        "seeded_by": "pipeline",
    }
    result = supabase.table("videos").insert(row).execute()
    print(f"  Inserted video row: {video_id}")
    return result.data[0]


# ─── Step 4: Run OCR ───

def run_ocr(video_path: str, video_id: str) -> dict:
    """Run VideOCR (SSIM dedup) to extract subtitle bounding boxes.

    This is a COPY of the validated extract_subtitles_videocr2.py logic.
    The pipeline must be standalone (deployable independently), so we can't
    import from the test script. Instead, we copy the exact same logic and
    verify equivalence via a regression test in test_pipeline.py.

    If you change OCR logic here, you MUST also update extract_subtitles_videocr2.py
    and verify the regression test still passes.
    """
    import cv2
    import numpy as np
    from paddleocr import PaddleOCR

    # ── Constants (MUST match extract_subtitles_videocr2.py) ──
    FRAME_INTERVAL_MS = 250
    OCR_SCALE = 0.5
    MIN_DURATION_MS = 750
    CONF_THRESHOLD = 0.70
    MIN_CHARS = 2
    SSIM_THRESHOLD = 0.92
    SUBTITLE_REGION_TOP = 0.5
    SUBTITLE_REGION_BOTTOM = 0.85

    try:
        from skimage.metrics import structural_similarity as ssim_func
    except ImportError:
        ssim_func = None

    def compute_ssim(img1, img2):
        if ssim_func:
            return ssim_func(img1, img2)
        diff = cv2.absdiff(img1, img2)
        return 1.0 - (np.mean(diff) / 255.0)

    def build_detection(text, score, poly, scale_back):
        if score < CONF_THRESHOLD or len(text) < MIN_CHARS:
            return None
        coords = poly.tolist() if hasattr(poly, 'tolist') else poly
        x0 = min(p[0] for p in coords) * scale_back
        y0 = min(p[1] for p in coords) * scale_back
        x1 = max(p[0] for p in coords) * scale_back
        y1 = max(p[1] for p in coords) * scale_back
        box_h = y1 - y0
        cw = (x1 - x0) / max(len(text), 1)
        return {
            "text": text, "confidence": round(score, 4),
            "bbox": {"x": round(x0), "y": round(y0), "width": round(x1 - x0), "height": round(box_h)},
            "chars": [{"char": c, "x": round(x0 + i * cw), "y": round(y0),
                       "width": round(cw), "height": round(box_h)} for i, c in enumerate(text)],
        }

    # ── Get video info ──
    probe = json.loads(subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
        capture_output=True, text=True).stdout)
    vs = [s for s in probe["streams"] if s["codec_type"] == "video"][0]
    w, h = int(vs["width"]), int(vs["height"])
    dur = float(vs.get("duration", 0))
    sW, sH = int(w * OCR_SCALE), int(h * OCR_SCALE)
    scale_back = 1.0 / OCR_SCALE

    print(f"  OCR: {w}x{h}, {dur:.0f}s, sampling at {FRAME_INTERVAL_MS}ms...")

    # ── Extract frames with SSIM dedup (same as videocr2) ──
    cap = cv2.VideoCapture(video_path)
    frames = []
    prev_sub_gray = None
    ts_ms = 0
    total_frames = 0
    unique_frames = 0

    while ts_ms < dur * 1000:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts_ms)
        ret, frame = cap.read()
        if not ret:
            ts_ms += FRAME_INTERVAL_MS
            continue

        total_frames += 1
        frame = cv2.resize(frame, (sW, sH))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        sub_region = gray[int(sH * SUBTITLE_REGION_TOP):int(sH * SUBTITLE_REGION_BOTTOM), :]

        is_unique = True
        if prev_sub_gray is not None and sub_region.shape == prev_sub_gray.shape:
            ssim_val = compute_ssim(sub_region, prev_sub_gray)
            is_unique = ssim_val < SSIM_THRESHOLD

        if is_unique:
            unique_frames += 1
        frames.append((frame, ts_ms, is_unique))
        prev_sub_gray = sub_region
        ts_ms += FRAME_INTERVAL_MS

    cap.release()
    print(f"  Frames: {total_frames} total, {unique_frames} unique, {total_frames - unique_frames} skipped")

    # ── OCR engine ──
    ocr = PaddleOCR(lang='ch', use_doc_orientation_classify=False,
                    use_doc_unwarping=False, use_textline_orientation=False)

    # ── OCR each frame (skip non-unique, carry forward last detections) ──
    frame_results = []
    last_dets = []
    for frame_img, ts_ms, is_unique in frames:
        if is_unique:
            r = ocr.ocr(frame_img)
            dets = []
            if r and r[0]:
                data = r[0]
                if isinstance(data, dict):
                    for text, score, poly in zip(data.get("rec_texts", []),
                                                  data.get("rec_scores", []),
                                                  data.get("rec_polys", [])):
                        det = build_detection(text, score, poly, scale_back)
                        if det:
                            dets.append(det)
                elif isinstance(data, list):
                    for item in data:
                        if len(item) >= 2:
                            det = build_detection(item[1][0], item[1][1], item[0], scale_back)
                            if det:
                                dets.append(det)
            last_dets = dets
        else:
            dets = last_dets

        frame_results.append({"timestamp_ms": ts_ms, "detections": dets})

    # ── Deduplicate into segments ──
    segments = []
    cur_text, cur_seg = None, None
    for fr in frame_results:
        if not fr["detections"]:
            if cur_seg:
                segments.append(cur_seg)
                cur_seg = None
                cur_text = None
            continue
        sorted_dets = sorted(fr["detections"], key=lambda d: d["bbox"]["y"], reverse=True)
        ft = "|".join(d["text"] for d in sorted_dets)
        if ft == cur_text and cur_seg:
            cur_seg["end_ms"] = fr["timestamp_ms"] + FRAME_INTERVAL_MS
        else:
            if cur_seg:
                segments.append(cur_seg)
            cur_text = ft
            cur_seg = {"start_ms": fr["timestamp_ms"],
                       "end_ms": fr["timestamp_ms"] + FRAME_INTERVAL_MS,
                       "detections": sorted_dets}
    if cur_seg:
        segments.append(cur_seg)

    segments = [s for s in segments if (s["end_ms"] - s["start_ms"]) >= MIN_DURATION_MS]

    bbox_data = {
        "video": video_id,
        "resolution": {"width": w, "height": h},
        "duration_ms": round(dur * 1000),
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

def main():
    parser = argparse.ArgumentParser(description="Process a video through the Scrollingo pipeline")
    parser.add_argument("--video", required=True, help="Path to input video file")
    parser.add_argument("--language", default=None, help="Video content language (auto-detected from OCR if not provided)")
    parser.add_argument("--native-lang", default=None, help="[DEPRECATED] Ignored — all 11 target languages are generated automatically")
    parser.add_argument("--title", default=None, help="Video title (default: filename)")
    parser.add_argument("--dry-run", action="store_true", help="Run OCR and LLM but skip Supabase/R2")
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

        # Step 4 (run OCR early so we can auto-detect title + language before DB insert)
        print("[4/8] Running OCR (VideOCR SSIM dedup)...")
        bbox_data = run_ocr(norm_path, video_id)

        # Auto-detect language from OCR text if not provided
        if not language:
            language = detect_content_language(bbox_data)
            if language:
                print(f"  Auto-detected language: {language}")
            else:
                language = "zh"  # Default fallback
                print(f"  Could not detect language, defaulting to: {language}")

        # Auto-detect title from first subtitle if not provided
        if not title:
            title = get_auto_title(bbox_data)
            print(f"  Auto-title: \"{title}\"")

        # Extract thumbnail at ~30% into the video
        thumb_path = extract_thumbnail(norm_path, tmpdir, duration_sec)

        # Step 2: Upload to R2
        print("[2/8] Uploading to R2...")
        cdn_url = upload_to_r2(norm_path, f"videos/{video_id}/video.mp4")
        thumb_url = upload_to_r2(thumb_path, f"videos/{video_id}/thumbnail.jpg")

        if not args.dry_run:
            # Step 3: Insert video row
            print("[3/8] Inserting video row...")
            insert_video_row(video_id, title, language, duration_sec, cdn_url, thumb_url)

        # Save bboxes.json locally
        bbox_path = os.path.join(tmpdir, "bboxes.json")
        with open(bbox_path, "w", encoding="utf-8") as f:
            json.dump(bbox_data, f, ensure_ascii=False, indent=2)

        # Also save to output dir for local testing
        local_bbox_path = OUTPUT_DIR / f"{Path(video_path).stem}_pipeline.json"
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(local_bbox_path, "w", encoding="utf-8") as f:
            json.dump(bbox_data, f, ensure_ascii=False, indent=2)
        print(f"  Saved locally: {local_bbox_path}")

        # Upload bboxes to R2
        upload_to_r2(bbox_path, f"videos/{video_id}/bboxes.json")

        # Step 5: Word segmentation
        print("[5/8] Segmenting words...")
        unique_words, word_occurrences = segment_words(bbox_data, language)

        # Build word → sentence map for LLM context
        word_sentences = {}
        for occ in word_occurrences:
            if occ["word"] not in word_sentences:
                word_sentences[occ["word"]] = occ["sentence"]

        # Step 6: LLM definitions — all words × all target languages
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
