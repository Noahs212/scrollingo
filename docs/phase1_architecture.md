# Scrollingo — Phase 1 Architecture

> Video Distribution + Social + Language Learning UI
> React Native + Expo | Go Monolith | Supabase | Cloudflare R2
> Target: 0-10K MAU | ~$31/mo

---

## 1. Requirements

### 1.1 Phase Roadmap

| Phase | Focus | When |
|-------|-------|------|
| **Phase 1** | Video distribution, social features, language learning UI | Now |
| **Phase 1.5** | Content recommendation (scored feed, quizzes) | After Phase 1 is stable |
| **Phase 2** | User uploads, scale to 100K MAU | 10K+ MAU |
| **Phase 3** | ML recommendations, A/B testing, moderation | 100K+ MAU |

### 1.2 Phase 1 Functional Requirements

**Video Feed**
- R1: Full-screen vertical scroll video feed (TikTok-style)
- R2: Videos play automatically on scroll, pause when off-screen
- R3: Feed is chronological, filtered by user's active learning language
- R4: No user uploads — team seeds ~100 curated videos/month via admin CLI
- R5: Videos are 720p progressive MP4 served from Cloudflare R2 CDN

**Social**
- R6: Like, comment, and bookmark videos (persisted to server)
- R7: User profiles with avatar, stats (followers, following, streak)
- R8: Auth via Supabase (email/password + Google/Apple OAuth)
- R9: Direct messages (inherited from kirkwat/tiktok base repo)

**Subtitles & Word Interaction**
- R10: Tappable subtitle overlay synced to video playback — every word is individually tappable
- R11: Tap any word → bottom sheet with translation, contextual definition, part of speech, pronunciation
- R12: Lookup direction is always: video language → user's native language
- R13: Two subtitle sources: (a) STT-generated from audio, (b) OCR-extracted from burned-in subtitles in the video frames
- R14: OCR subtitle extraction for content sourced from other platforms with hardcoded/burned-in subtitles
- R15: Pipeline auto-detects subtitle source: if video has burned-in text → OCR first, otherwise → STT from audio
- R16: Both subtitle sources produce the same normalized word-timestamp format for the tappable overlay

**Flashcards & Vocab**
- R17: Save any word as a flashcard (from word tap or subtitle context)
- R18: Flashcard review with FSRS (Free Spaced Repetition Scheduler) algorithm via `ts-fsrs`
- R19: ~~Flashcards work offline (MMKV persistence, sync on reconnect)~~ → Deferred to Phase 2
- R20: On-device TTS for instant word pronunciation (expo-speech, free)
- R21: ~~High-quality pre-generated TTS audio from R2~~ → Deferred to Phase 2 (on-device expo-speech sufficient)

**Language System**
- R22: User sets one native language + one or more learning languages
- R23: Learning languages (Phase 1): English, Chinese
- R24: Native languages (definitions target): English, Spanish, Chinese, Japanese, Korean, Hindi, French, German, Portuguese, Arabic, Italian, Russian (12 total)
- R25: English and Chinese can be both learning AND native
- R26: ~~Offline bilingual dictionaries (SQLite)~~ → Removed (LLM definitions sufficient)
- R27: ~~Chinese dictionaries handle simplified/traditional + pinyin~~ → Removed (pipeline handles pinyin)
- R28: LLM contextual definitions for every word in every video, per native language
- R29: ~~Dictionary adapter factory~~ → Removed (LLM definitions serve all lookup needs)

**Progress**
- R30: Daily streak tracking with streak badges
- R31: Stats dashboard: words learned, videos watched, cards reviewed
- R32: Daily activity sync to server

**Content Pipeline (Backend)**
- R33: Admin CLI uploads video → triggers AI pipeline
- R34: Pipeline: detect subtitle source (OCR or STT) → Translation → Contextual Definitions (LLM) → store in R2
- R35: OCR via PaddleOCR PP-OCRv5 (VideOCR SSIM dedup) for videos with burned-in subtitles; STT via Groq Whisper for videos with audio only (M3.5)
- R36: ~~Pre-generated TTS for all ~100K words~~ → Deferred to Phase 2 (on-device expo-speech for now)
- R37: Videos marked "ready" after pipeline completes; Supabase Realtime notifies clients

### 1.3 Phase 1.5 Requirements (Deferred)

- R38: Feed scoring algorithm (Krashen's i+1 difficulty matching)
- R39: Personalized feed using recency, popularity, difficulty match, novelty
- R40: Mid-scroll quiz cards interleaved in feed
- R41: Quiz generation from user's learned vocabulary

### 1.4 Non-Functional Requirements

- N1: Monthly infrastructure cost ≤ $85 at 10K MAU
- N2: App binary < 50 MB (dictionaries downloaded on-demand, not bundled)
- N3: Video time-to-first-frame < 200ms (prefetch next 2 videos while current plays)
- N3a: Thumbnail placeholder shown instantly while video buffers (eliminates black flash on swipe)
- N3b: Design for TikTok-style swiping: users skip 15-20 videos (within 1-3s each) before fully watching one
- N4: ~~Flashcard review works fully offline~~ → Deferred to Phase 2 (requires MMKV)
- N5: ~~Dictionary lookup < 100ms (local SQLite)~~ → Removed (definitions pre-loaded from Supabase per video)

---

## 2. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Mobile** | React Native + Expo SDK 55 (TypeScript) | kirkwat/tiktok base repo, largest ecosystem |
| **Base Repo** | kirkwat/tiktok | Auth, feed, likes, comments, profiles, DMs built |
| **State** | Redux Toolkit + React Query v5 | Redux for global state (5 slices), React Query for server cache |
| **Video** | expo-video (native AVPlayer/ExoPlayer) | Native players, `contentFit="contain"`, `useEvent` for time sync |
| **Offline Storage** | react-native-mmkv (flashcards, M6), expo-sqlite (dictionaries, M8) | Fast KV store + SQL for structured lookups |
| **Navigation** | React Navigation v6 (material-bottom-tabs + native-stack) | Inherited from base, no migration needed |
| **Pipeline** | Python script (`scripts/pipeline.py`) | OCR + LLM + R2 upload. Go backend is M10 (future) |
| **OCR** | PaddleOCR PP-OCRv5 via VideOCR (SSIM dedup) | Best Chinese accuracy, free, bounding box output |
| **Database** | Supabase Pro (PostgreSQL + Auth + Realtime) | $25/mo, auth for 100K MAU included |
| **Storage/CDN** | Cloudflare R2 (`scrollingo-media` bucket) | Free egress, free CDN |
| **STT** | Groq Whisper Turbo (M3.5, deferred) | $0.000667/min — only for videos without burned-in subs |
| **Definitions** | Claude Haiku 3.5 via OpenRouter | ~$1/mo for 100 videos × 11 target languages, localized prompts |
| **TTS** | Pre-generated (Google Neural2) + expo-speech | $22.40 one-time for 2 langs, $0 ongoing |
| **Monitoring** | Axiom + Sentry + Grafana Cloud | All free tier |

> **Current state (M3 complete):** App talks directly to Supabase via `@supabase/supabase-js` + PostgREST + RLS. The Go backend does not exist yet — it will be built in M10 to centralize API logic and rate limiting. Pipeline runs locally via Python.

### Key Dependencies (Actual — from package.json)
```json
{
  "expo": "^55",
  "expo-video": "~55.0.10",
  "react": "19.2.0",
  "react-native": "0.83.2",
  "@supabase/supabase-js": "^2.99.1",
  "@reduxjs/toolkit": "^2",
  "@tanstack/react-query": "^5",
  "react-native-reanimated": "4.2.1",
  "@gorhom/bottom-sheet": "^5",
  "react-native-paper": "^5.13.0",
  "@expo/vector-icons": "^15.1.1",
  "ts-fsrs": "^5"
}
```

### Pipeline Dependencies (Python)
```
paddleocr, paddlepaddle    # OCR (PP-OCRv5)
scikit-image               # SSIM frame dedup
jieba                      # Chinese word segmentation
openai                     # OpenRouter SDK (Claude Haiku 3.5)
supabase                   # Database client (service role key)
boto3                      # R2 uploads
langdetect                 # Content language auto-detection
```

---

## 3. Mobile App

### 3.1 Folder Structure (Actual)
```
mobile/src/
├── navigation/
│   ├── main/index.tsx              # Root stack navigator (auth gate + onboarding gate)
│   ├── home/index.tsx              # Material bottom tabs (feed, discover, review, inbox, me)
│   └── feed/index.tsx              # Feed top tabs + context provider
├── screens/
│   ├── feed/index.tsx              # Video feed (FlatList, vertical paging)
│   ├── auth/index.tsx              # Login/signup
│   ├── onboarding/index.tsx        # 3-step: native lang, learning lang, daily goal
│   ├── profile/index.tsx           # Own + other user profiles
│   ├── profile/edit/index.tsx      # Edit profile fields
│   ├── settings/index.tsx          # Language, daily goal, developer menu
│   ├── review/index.tsx            # Flashcard review (empty state, M6)
│   ├── search/index.tsx            # Discover (placeholder, M7)
│   ├── devOcrCompare/index.tsx     # Developer: OCR model comparison tool
│   └── chat/                       # DMs (inherited, placeholder)
├── components/
│   ├── general/post/
│   │   ├── index.tsx               # PostSingle: video player + tap targets
│   │   ├── overlay/index.tsx       # Action buttons, username, description
│   │   └── subtitleOverlay/index.tsx # Invisible OCR tap targets over burned-in text
│   ├── profile/
│   │   ├── header/index.tsx        # Avatar, stats, follow button, language badges
│   │   ├── navBar/index.tsx        # Profile top bar with slide-out menu
│   │   └── postList/index.tsx      # Grid of user's videos
│   └── modal/comment/index.tsx     # Comment modal (mock, M7)
├── redux/
│   └── slices/
│       ├── authSlice.ts            # Auth state + user profile
│       ├── languageSlice.ts        # Native/learning/active language + onboarding gate
│       ├── postSlice.ts            # User posts (will become feed in M4)
│       ├── modalSlice.ts           # Comment modal state
│       └── chatSlice.ts            # Chat state (inherited)
├── services/
│   ├── posts.ts                    # Feed data (MOCK — local videos + seed users)
│   ├── subtitles.ts                # OCR bbox loader (local JSON, M4 → R2 fetch)
│   ├── user.ts                     # Supabase user profiles, follow/unfollow
│   ├── language.ts                 # Language prefs, Supabase sync
│   └── auth.ts                     # OAuth (Google/Apple) + email auth
├── hooks/
│   ├── useUser.ts                  # React Query: fetch user by ID
│   ├── useFollowing.ts             # React Query: follow state
│   ├── useFollowingMutation.ts     # Mutation: follow/unfollow
│   └── useCurrentUserId.ts         # Get current user from Redux
├── lib/
│   └── supabase.ts                 # Supabase client (expo-secure-store auth)
└── assets/
    ├── videos/                     # Local test videos (video_2.mp4 - video_13.mp4)
    └── subtitles/                  # Pre-extracted OCR bboxes (4 models × 10 videos)

scripts/
├── pipeline.py                     # M3: Full video processing pipeline
├── extract_subtitles.py            # Baseline PaddleOCR extraction
├── extract_subtitles_videocr.py    # videocr (pixel-diff dedup)
├── extract_subtitles_videocr2.py   # VideOCR (SSIM dedup) ← SELECTED
├── extract_subtitles_rapid.py      # RapidOCR (ONNX Runtime)
└── test_pipeline.py                # 48 pipeline tests (pytest)
```

### 3.2 Video Feed

**Playback Optimization for TikTok-style Swiping**

TikTok users swipe through 15-20 videos (1-3s each) before fully watching one. Two things are critical:

1. **Thumbnail placeholders**: Show `thumbnail_url` as `<Image>` behind `<VideoView>`. User sees the frame instantly while the video player buffers. Eliminates the black flash between swipes.

2. **Prefetch next 2 videos**: While the user watches video N, pre-initialize players for N+1 and N+2 so they're already buffering. When the user swipes, the next video's first frame is already decoded. Target: <200ms time-to-first-frame.

3. **Cursor pagination**: Fetch 10-15 video metadata records per page. Trigger next page fetch when user is 3-5 videos from the end. Lightweight — only URLs, counts, and IDs.

4. **Bandwidth awareness** (Phase 2): Each skipped video wastes ~2-3MB (3s of 8MB/30s). Over 20 swipes = 40-60MB waste. Acceptable for Phase 1; Phase 2 adds 480p initial quality with upgrade after 3s watch time.

```typescript
import { useVideoPlayer, VideoView } from 'expo-video';

const VideoCard = ({ video, isActive, prefetchUrls }: {
  video: Video; isActive: boolean; prefetchUrls: string[];
}) => {
  const player = useVideoPlayer(video.cdn_url, (p) => { p.loop = true; });

  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive]);

  return (
    <View style={styles.fullScreen}>
      {/* Thumbnail placeholder — visible instantly, behind the video */}
      <Image source={{ uri: video.thumbnail_url }} style={StyleSheet.absoluteFill} />
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      <SubtitleOverlay
        words={video.subtitles}
        currentTime={player.currentTime}
        onWordTap={(word) => { player.pause(); openWordPopup(word); }}
      />
    </View>
  );
};
```

### 3.3 FSRS Algorithm (Free Spaced Repetition Scheduler)

We use the `ts-fsrs` npm package — a modern replacement for SM-2 with better retention modeling. FSRS tracks per-card state (new/learning/review/relearning), stability, and difficulty. Implementations exist in all languages (Python, Go, Swift, Kotlin).

```typescript
import { fsrs, Card, Rating } from 'ts-fsrs';

const scheduler = fsrs();

// On review: pass card + rating → get updated scheduling
const card: Card = { /* state, step, stability, difficulty, due, last_review */ };
const result = scheduler.repeat(card, new Date());
const updated = result[Rating.Good]; // or Again/Hard/Easy
// updated.card has new state, stability, difficulty, due
// updated.log has review metadata
```

Four ratings: Again (1) = forgot, Hard (2) = tough, Good (3) = got it, Easy (4) = easy.

Re-queue logic: if new `due` is within 20 minutes, card stays in the session queue.

---

## 4. Language & Dictionary System

### 4.1 Supported Languages

| Type | Languages | Count |
|------|-----------|-------|
| **Learning** (content) | English, Chinese | 2 |
| **Native** (definitions) | en, es, zh, ja, ko, hi, fr, de, pt, ar, it, ru | 12 |

> English and Chinese serve as both learning AND native languages.

### 4.2 User Language Model
```typescript
interface LanguageState {
  nativeLanguage: string;           // "es" — definitions rendered in this
  learningLanguages: string[];      // ["en", "zh"] — content languages
  activeLearningLanguage: string;   // "en" — filters the feed
}
```
Stored in Redux (`languageSlice`) + synced to `users.native_language` / `users.learning_languages` / `users.target_language` on Supabase.

### 4.3 Lookup Direction
Always: **video language → user's native language**. The app never guesses direction.
```
English video + Spanish native → en-es dictionary
Chinese video + English native → zh-en dictionary (with pinyin)
```

### 4.4 Offline Dictionaries (SQLite)

**Standard bilingual** (e.g. `en-es.sqlite3`):
```sql
CREATE TABLE translations (
    written_rep TEXT PRIMARY KEY,
    trans_list  TEXT NOT NULL        -- Pipe-separated: "hola|buenos días"
);
```

**Chinese source** (e.g. `zh-en.sqlite3`):
```sql
CREATE TABLE entries (
    simplified  TEXT NOT NULL,
    traditional TEXT,
    pinyin      TEXT NOT NULL,       -- nǐ hǎo
    definition  TEXT NOT NULL,
    PRIMARY KEY (simplified, pinyin)
);
```

**Monolingual POS** (e.g. `en.sqlite3`):
```sql
CREATE TABLE pos (word TEXT PRIMARY KEY, part_of_speech TEXT NOT NULL);
```

### 4.5 Dictionary Adapter Factory
```typescript
function createAdapter(sourceLang: string, targetLang: string): DictionaryAdapter {
  const pair = `${sourceLang}-${targetLang}`;
  let base: DictionaryAdapter;
  if (CHINESE_SOURCE_PAIRS.has(pair))          base = new ChineseSourceAdapter(pair);
  else if (pair === "en-zh")                   base = new EnglishToChineseAdapter();
  else if (hasOfflinePair(sourceLang, targetLang)) base = new SimpleDictAdapter(pair);
  else                                         base = new RemoteApiAdapter(sourceLang, targetLang);
  return new LlmWrapperAdapter(base, sourceLang, targetLang); // Merge with cached LLM definitions
}
```

### 4.6 LLM Contextual Definitions
Generated per word, per video, per target language during the pipeline. Each word gets 11 separate LLM calls (one per target language, skipping self-translation). Prompts are localized into the target language for better output quality.

```
System: "You are a professional translator. Provide precise, contextual translations into {targetName}."
User: (localized into target language)
  Translate the {sourceName} word "{word}" into {targetName} as used in this context: "{sentence}"
  Translation: <word>
  Contextual Definition: <explanation>
  Part of Speech: <noun/verb/etc.>
```

For Chinese targets, labels are 翻译/语境释义/词性. For Japanese, 翻訳/文脈的定義/品詞. Etc.

Results stored in `word_definitions` table (one row per word × target language × video). The app queries by `(video_id, target_language = user.native_language)` — no runtime LLM calls.

### 4.7 Auto-Download
On language change, app downloads: bilingual dictionary (learning→native) + monolingual POS database. ~30-50 MB per setup.

### 4.8 Bundled Level Databases (Phase 1.5/2)
Shipped in app binary for difficulty assessment. Deferred — difficulty scales vary by language:
- `cefr-en.sqlite3` — English words tagged A1-C2 (CEFR)
- `hsk-zh.sqlite3` — Chinese words tagged HSK 1-6
- `jlpt-ja.sqlite3` — Japanese words tagged N5-N1 (JLPT)

> Proficiency is NOT a single field — it's per-language. A user might be HSK 3 in Chinese and B2 in English. Phase 2 will add a `user_proficiencies` table keyed on `(user_id, language)` with language-specific scales.

---

## 5. Go Backend

### 5.1 Server
- fly.io shared-cpu-2x, 512MB RAM, ~$5/mo
- chi router, ~500-1,500 concurrent connections

### 5.2 API Endpoints
```
Health
  GET    /health

Auth (Supabase JWT verification)
  POST   /api/v1/auth/profile
  GET    /api/v1/auth/me
  DELETE /api/v1/auth/me               # GDPR account deletion

Feed
  GET    /api/v1/feed                  # Chronological, keyset cursor
         ?cursor=<timestamp:id>&limit=20&language=en
  GET    /api/v1/feed/explore          # Editorial picks

Videos
  GET    /api/v1/videos/:id
  GET    /api/v1/videos/:id/subtitles?lang=es
  GET    /api/v1/videos/:id/comments
  POST   /api/v1/videos/:id/comments
  POST   /api/v1/videos/:id/view       # Buffered, flushed every 60s
  PUT    /api/v1/videos/:id/like
  DELETE /api/v1/videos/:id/like
  PUT    /api/v1/videos/:id/bookmark
  DELETE /api/v1/videos/:id/bookmark

Flashcards
  GET    /api/v1/flashcards/due?limit=20
  POST   /api/v1/flashcards
  DELETE /api/v1/flashcards/:id
  PUT    /api/v1/flashcards/:id/review
  POST   /api/v1/flashcards/sync       # Bulk offline sync
  GET    /api/v1/flashcards/decks

Dictionary
  GET    /api/v1/dictionary/:word?from=en&to=es
  GET    /api/v1/dictionary/:word/tts

Progress
  GET    /api/v1/progress
  POST   /api/v1/progress/daily
  GET    /api/v1/progress/streak

Admin (API key + IP allowlist)
  POST   /internal/admin/videos
  GET    /internal/admin/pipeline/status
  POST   /internal/admin/tts/seed-cache
```

### 5.3 Rate Limiting
| Group | Limit |
|-------|-------|
| Auth | 5/min per IP |
| Feed / Dictionary | 60/min per user |
| Flashcard sync | 10/min per user |
| Video interactions | 30/min per user |
| Admin | 10/min per key |

### 5.4 AI Pipeline (Python — `scripts/pipeline.py`)

> The Go backend (M10) will eventually port this. Currently runs as a local Python script.

```bash
# Auto-detect language from OCR text, auto-title from first subtitle:
python3 scripts/pipeline.py --video ~/downloads/chinese_video.mp4

# Or specify explicitly:
python3 scripts/pipeline.py --video video.mp4 --language zh --title "My Title"
```

**Pipeline flow (for videos with burned-in subtitles):**

1. **Normalize** video to 720p with FFmpeg (scale + pad + faststart)
2. **OCR** — VideOCR (SSIM dedup) extracts subtitle text + bounding boxes at 250ms intervals, half-res for speed
3. **Auto-detect language** from OCR text (langdetect) if `--language` not provided
4. **Auto-detect title** from first subtitle caption if `--title` not provided
5. **Upload** video.mp4 + thumbnail.jpg + bboxes.json to R2 via boto3
6. **Insert video row** in Supabase (status='processing', cdn_url, language)
7. **Segment words** — jieba for Chinese, whitespace for others, filter punctuation
8. **Generate definitions** — Claude Haiku 3.5 via OpenRouter, one call per word × 11 target languages, localized prompts per target language
9. **Insert into Supabase** — vocab_words (batch upsert), word_definitions (all languages), video_words (timestamps)
10. **Mark ready** — update video status, insert pipeline_jobs with timestamps

**Error handling:** If Supabase insert fails partway, the pipeline cleans up (deletes partial video data) and raises the error.

**OCR model:** VideOCR uses PaddleOCR PP-OCRv5 with SSIM-based frame dedup — compares only the subtitle region (bottom 50-85% of frame) to skip frames where subtitles haven't changed. Selected after comparing 4 models (PaddleOCR baseline, videocr pixel-diff, VideOCR SSIM, RapidOCR ONNX) in the developer comparison tool.

**STT path (M3.5, deferred):** For videos without burned-in subtitles, Groq Whisper will transcribe audio. Not yet implemented — all current content has burned-in Chinese subtitles.

### 5.5 Feed Query (Phase 1)
```sql
SELECT v.id, v.title, v.cdn_url, v.thumbnail_url, v.language,
       v.difficulty, v.duration_sec, v.view_count, v.like_count, v.created_at
FROM videos v
LEFT JOIN user_views uv ON uv.video_id = v.id AND uv.user_id = $1
WHERE v.language = $2 AND v.status = 'ready' AND uv.video_id IS NULL
  AND ($3::TIMESTAMPTZ IS NULL OR v.created_at < $3)
ORDER BY v.created_at DESC
LIMIT $4;
```

### 5.6 Caching
| What | Where | TTL |
|------|-------|-----|
| Feed pages | Go sync.Map | 60s |
| Dictionary lookups | Go sync.Map | 24h |
| JWKS keys | Go sync.Map | 1h |
| TTS/videos/subtitles/bboxes | R2 + CDN | Immutable |
| Flashcards | Client MMKV | Sync on open |
| Next 2 videos | Client expo-video prefetch | Until swipe past |
| Thumbnails | Client Image cache | Platform default |
| Bbox JSON per video | Client (fetch once from R2) | Until app restart |

---

## 6. Database Schema (Supabase PostgreSQL)

> Full schema with DDL, indexes, design decisions, and data flows: **[database_design.md](database_design.md)**

### Tables (15)

| Table | Purpose |
|-------|---------|
| `users` | Profile, language prefs (native + learning), streak, stats, max_reviews_per_day |
| `videos` | Video metadata, language, status, CDN URLs |
| `vocab_words` | Canonical word entries per language (populated by pipeline) |
| `word_definitions` | LLM contextual definitions per (word, target_lang, video context) — 11 languages per word |
| `video_words` | Links words to timestamps in a video (word_index, start_ms, end_ms) |
| `flashcards` | User's saved words with FSRS SRS state (state, step, stability, difficulty, due) |
| `review_logs` | Per-review analytics (rating, duration, timestamp) |
| `user_views` | Watch tracking (completion %, view count) |
| `user_likes` | Liked videos |
| `user_bookmarks` | Bookmarked videos |
| `user_follows` | Follow relationships (follower_id, following_id) |
| `comments` | Video comments (max 500 chars) |
| `daily_progress` | Daily activity stats for streak tracking |
| `pipeline_jobs` | AI pipeline status per video (pending → ready/failed) |

### Key Design Decisions
- **Normalized definitions**: `vocab_words` + `word_definitions` instead of JSONB blobs in subtitles — same word across videos shares definitions, flashcards reference by FK
- **Flashcard references**: Cards store FKs to vocab_words + word_definitions + FSRS state. Client MMKV caches display data for offline
- **FSRS algorithm**: `ts-fsrs` package — modern replacement for SM-2 with per-card stability/difficulty tracking
- **Review logs**: Per-review analytics for future FSRS parameter optimization
- **No decks**: Single implicit deck per user in Phase 1
- **Contextual**: Same word gets different definitions per sentence context ("bank" = river bank vs financial bank)

<!--
Previous inline schema removed — see database_design.md for full DDL.
Old tables removed: subtitles (replaced by video_words), dictionary (replaced by vocab_words), tts_cache (TTS is pre-generated, tracked in vocab_words.tts_url)
-->

```sql
-- Removed inline schema. See docs/database_design.md for full DDL.
```

---

## 7. Storage (Cloudflare R2)

```
scrollingo-media/
├── videos/{video_id}/
│   ├── video.mp4                  # 720p progressive MP4
│   ├── audio.mp3                  # Extracted for STT
│   ├── thumbnail.jpg
│   ├── bboxes.json                # OCR bounding boxes for tappable subtitle overlay
│   └── subs/
│       ├── en.vtt                 # Subtitles + definitions per native language
│       ├── es.vtt
│       └── zh.vtt
├── tts/{language}/{sha256}.mp3    # Pre-generated word pronunciations
├── dictionaries/
│   ├── en-es.sqlite3              # Bilingual dictionaries (~10-20 MB each)
│   ├── zh-en.sqlite3
│   ├── en.sqlite3                 # Monolingual POS
│   └── ...
└── avatars/{user_id}.jpg
```

### bboxes.json — OCR Bounding Box Data

Per-character tap target positions extracted by VideOCR (SSIM dedup) pipeline. Stored in R2 alongside each video — static after pipeline processing, fetched once by the app and cached locally.

```json
{
  "video": "video_id",
  "resolution": {"width": 720, "height": 1280},
  "duration_ms": 11633,
  "frame_interval_ms": 250,
  "segments": [{
    "start_ms": 1000, "end_ms": 3000,
    "detections": [{
      "text": "你好",
      "confidence": 0.99,
      "bbox": {"x": 200, "y": 900, "width": 300, "height": 80},
      "chars": [
        {"char": "你", "x": 200, "y": 900, "width": 150, "height": 80},
        {"char": "好", "x": 350, "y": 900, "width": 150, "height": 80}
      ]
    }]
  }]
}
```

The app's `SubtitleTapOverlay` component transforms these pixel coordinates to screen coordinates (accounting for `contentFit="contain"` scaling/centering) and renders invisible `Pressable` tap targets over each character. A pre-computed lookup table indexed by 50ms buckets provides O(1) segment matching synced to `expo-video`'s native `timeUpdate` event.

**Why R2 and not Supabase:** The bbox JSON is static per video (computed once), potentially large (50-300KB), and doesn't need SQL querying — just fetched whole. Same pattern as WebVTT subtitle files and TTS audio.

**Cache-Control**: Videos/TTS/subtitles/bboxes: `immutable, max-age=31536000`. Dictionaries: `max-age=604800`. Avatars: `max-age=3600`.

---

## 8. TTS Strategy

Languages have ~100K words. Pronunciation is immutable. **Pre-generate everything once.**

| Item | Cost |
|------|------|
| One-time generation (2 learning langs) | $22.40 |
| R2 storage (2 langs x 0.95 GB) | $0.03/mo |
| Ongoing API cost | $0 |

**Flow**: User taps word → expo-speech plays instantly (free) → R2 high-quality audio loads in parallel for replay.

---

## 9. Video Ingestion

```bash
# Full pipeline: normalize + OCR + definitions + upload + DB insert
python3 scripts/pipeline.py --video source.mp4

# With explicit options:
python3 scripts/pipeline.py --video source.mp4 --language zh --title "Ordering Coffee"

# Dry run (OCR + LLM only, no R2/Supabase writes):
python3 scripts/pipeline.py --video source.mp4 --dry-run
```

The pipeline handles FFmpeg normalization internally (720p, faststart, 60s max).

---

## 10. Subtitle Data Format

```json
[
  {
    "word": "café",
    "start_ms": 2000,
    "end_ms": 2300,
    "tts_url": "https://cdn.scrollingo.com/tts/es/d4e5f6.mp3",
    "frequency_rank": 312,
    "definitions": {
      "en": {
        "translation": "coffee",
        "contextual_definition": "The beverage, ordering context",
        "part_of_speech": "noun"
      },
      "zh": {
        "translation": "咖啡",
        "contextual_definition": "饮料，在点餐的语境中使用",
        "part_of_speech": "名词"
      }
    }
  }
]
```

---

## 11. Security

- **Current (pre-M10):** App uses Supabase PostgREST directly with RLS policies. Pipeline uses service role key (bypasses RLS).
- **After M10 (Go backend):** PostgREST disabled for writes, all access through Go backend with JWT verification via JWKS.
- Auth: Supabase Auth (Google/Apple OAuth, email/password)
- Admin pipeline: runs locally, uses Supabase service role key + R2 API keys from `.env`
- Secrets: `.env` file (gitignored), fly.io secrets for production

---

## 12. CI/CD

- **Backend**: GitHub Actions → `go test` → `flyctl deploy`
- **Mobile**: EAS Build → App Store / Play Store
- **Migrations**: golang-migrate, run on deploy

---

## 13. Monthly Cost

| Component | Service | Monthly |
|-----------|---------|---------|
| Database + Auth | Supabase Pro | $25.00 |
| Compute | fly.io shared-cpu-2x (M10) | $5.00 |
| Storage + CDN | Cloudflare R2 | $0.00 |
| Monitoring | Axiom + Sentry + Grafana | $0.00 |
| OCR processing | PaddleOCR (self-hosted, CPU) | $0.04 |
| Definitions | Claude Haiku 3.5 via OpenRouter (100 videos × 11 langs) | ~$1.00 |
| TTS storage | R2 (pre-generated audio) | $0.03 |
| **Total** | | **~$31/mo** |
| **One-time**: TTS generation (2 langs) | Google Neural2 | $22.40 |

**Breakeven**: ~230 MAU at $7.99/mo subscription, 2% conversion, 15% App Store cut.

---

## 14. What's NOT in Phase 1

| Feature | Phase | Why |
|---------|-------|-----|
| Proficiency system (CEFR for English, HSK for Chinese, JLPT for Japanese) | 1.5 | Difficulty scales vary by language — needs per-language proficiency model |
| Scored/personalized feed | 1.5 | Chronological works first |
| Mid-scroll quizzes | 1.5 | Need engagement data first |
| User video uploads | 2 | Moderation, storage costs |
| Redis | 2 | Go sync.Map sufficient |
| Multi-instance HA | 2 | Single instance handles 50K+ MAU |
| HLS streaming | 2 | Progressive MP4 + prefetch fine for <60s clips |
| Bandwidth optimization (480p initial + quality upgrade) | 2 | Acceptable waste at <10K MAU |
| Push notifications | 2 | Supabase Realtime for in-app |
| ML recommendations | 3 | SQL scoring works at this scale |
| A/B testing | 3 | Need statistical significance |
