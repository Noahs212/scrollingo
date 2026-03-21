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
- R18: Flashcard review with SM-2 spaced repetition algorithm
- R19: Flashcards work offline (MMKV persistence, sync on reconnect)
- R20: On-device TTS for instant word pronunciation (expo-speech, free)
- R21: High-quality pre-generated TTS audio from R2 for flashcard review

**Language System**
- R22: User sets one native language + one or more learning languages
- R23: Learning languages (Phase 1): English, Chinese
- R24: Native languages (definitions target): English, Spanish, Chinese, Japanese, Korean, Hindi, French, German, Portuguese, Arabic, Italian, Russian (12 total)
- R25: English and Chinese can be both learning AND native
- R26: Offline bilingual dictionaries (SQLite, ~20 pairs), auto-downloaded on language change
- R27: Chinese dictionaries handle simplified/traditional characters + pinyin
- R28: LLM contextual definitions for every word in every video, per native language
- R29: Dictionary adapter factory with fallback to remote API for missing offline pairs

**Progress**
- R30: Daily streak tracking with streak badges
- R31: Stats dashboard: words learned, videos watched, cards reviewed
- R32: Daily activity sync to server

**Content Pipeline (Backend)**
- R33: Admin CLI uploads video → triggers AI pipeline
- R34: Pipeline: detect subtitle source (OCR or STT) → Translation → Contextual Definitions (LLM) → store in R2
- R35: OCR via cloud vision API for videos with burned-in subtitles; STT via Groq Whisper for videos with audio only
- R36: Pre-generated TTS for all ~100K words per learning language, stored in R2
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
- N4: Flashcard review works fully offline
- N5: Dictionary lookup < 100ms (local SQLite)

---

## 2. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Mobile** | React Native + Expo (TypeScript) | kirkwat/tiktok base repo, largest ecosystem |
| **Base Repo** | kirkwat/tiktok | Auth, feed, likes, comments, profiles, DMs built |
| **State** | Zustand | Simpler than Redux Toolkit (migrated from base) |
| **Video** | expo-video + @shopify/flash-list | Native players, performant full-screen pager |
| **Offline Storage** | react-native-mmkv (flashcards), expo-sqlite (dictionaries) | Fast KV store + SQL for structured lookups |
| **Navigation** | React Navigation (bottom tabs + stacks) | Inherited from base, no migration needed |
| **Backend** | Go monolith (chi router) on fly.io | Single binary, efficient, $5/mo |
| **Database** | Supabase Pro (PostgreSQL + Auth + Realtime) | $25/mo, auth for 100K MAU included |
| **Storage/CDN** | Cloudflare R2 | Free egress, free CDN |
| **STT** | Groq Whisper Turbo | $0.000667/min, 9x cheaper than OpenAI |
| **Translation** | Google Translate API | $20/M chars, best quality |
| **Definitions** | LLM (Claude Haiku 3.5) | ~$1/mo for 100 videos x 12 languages |
| **TTS** | Pre-generated (Google Neural2) + expo-speech | $22.40 one-time for 2 langs, $0 ongoing |
| **Monitoring** | Axiom + Sentry + Grafana Cloud | All free tier |

### Key Dependencies
```json
{
  "expo": "~52.x",
  "expo-video": "~2.x",
  "expo-speech": "~12.x",
  "expo-sqlite": "~14.x",
  "expo-file-system": "~17.x",
  "@supabase/supabase-js": "^2.x",
  "zustand": "^4.x",
  "@shopify/flash-list": "^1.x",
  "react-native-reanimated": "~3.x",
  "@gorhom/bottom-sheet": "^4.x",
  "react-native-mmkv": "^2.x"
}
```

---

## 3. Mobile App

### 3.1 Folder Structure
```
src/
├── app/                            # React Navigation
│   ├── (tabs)/
│   │   ├── feed.tsx                # Video feed
│   │   ├── flashcards.tsx          # Flashcard review
│   │   ├── progress.tsx            # Stats dashboard
│   │   └── profile.tsx             # User profile
│   └── (auth)/
│       ├── login.tsx
│       └── onboarding.tsx          # Language + level selection
├── components/
│   ├── feed/
│   │   ├── VideoCard.tsx           # Full-screen video + subtitle overlay
│   │   ├── SubtitleOverlay.tsx     # Tappable word-by-word subtitles
│   │   └── WordPopup.tsx           # Bottom sheet: translation + TTS
│   └── flashcards/
│       ├── FlashcardDeck.tsx       # Swipeable card stack
│       └── SRSControls.tsx         # Again / Hard / Good / Easy
├── stores/
│   ├── authStore.ts                # Supabase auth (Zustand)
│   ├── feedStore.ts                # Feed data + pagination
│   ├── flashcardStore.ts           # Offline SRS (MMKV)
│   ├── progressStore.ts            # Streak, daily goals
│   └── languageStore.ts            # native_language + learning_languages[]
├── services/
│   ├── supabase.ts                 # Supabase client
│   ├── api.ts                      # Go backend client
│   ├── tts.ts                      # expo-speech + R2 fallback
│   ├── sync.ts                     # Offline → server sync
│   └── dictionaryDownloader.ts     # Auto-download on language change
├── dictionary/
│   ├── DictionaryFactory.ts        # (sourceLang, targetLang) → adapter
│   ├── adapters/
│   │   ├── SimpleDictAdapter.ts    # Standard bilingual (written_rep → trans_list)
│   │   ├── ChineseSourceAdapter.ts # Simplified/traditional + pinyin
│   │   ├── EnglishToChineseAdapter.ts
│   │   ├── RemoteApiAdapter.ts     # Fallback for missing offline pairs
│   │   └── LlmWrapperAdapter.ts    # Merges local dict + LLM contextual definitions
│   └── availablePairs.ts           # ~20 offline bilingual pairs
└── lib/
    ├── sm2.ts                      # SM-2 spaced repetition
    └── subtitleParser.ts           # Parse WebVTT with word timestamps
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

### 3.3 SM-2 Algorithm
```typescript
export function sm2(card: Flashcard, quality: 0 | 1 | 2 | 3 | 4 | 5): Flashcard {
  let { easeFactor, interval, repetitions } = card;
  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions++;
  } else { repetitions = 0; interval = 1; }
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  return { ...card, easeFactor, interval, repetitions, nextReview: addDays(new Date(), interval) };
}
```

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
Stored locally (MMKV) + synced to `users.native_language` / `users.learning_languages` on server.

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
Generated per word, per video, per native language during the AI pipeline. Prompt is in the target language:
```
System: "You are a professional translator. Provide precise, contextual translations."
User: [word], [sentence context], [source→target lang]
Output: { translation, contextual_definition, part_of_speech }
```
Results cached in `subtitles.word_data` JSONB — no runtime LLM calls.

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

### 5.4 AI Pipeline
```go
func (s *PipelineService) ProcessVideo(ctx context.Context, videoID string) error {
    // 1. Extract text: OCR (burned-in subs) or STT (audio)
    video, _ := s.db.GetVideo(ctx, videoID)
    var transcript Transcript
    if video.HasBurnedInSubs {
        frames, _ := s.extractFrames(ctx, videoID)                        // Sample frames
        transcript, _ = s.ocr.ExtractSubtitles(ctx, frames)              // Cloud Vision OCR
    } else {
        audio, _ := s.r2.GetObject(ctx, fmt.Sprintf("videos/%s/audio.mp3", videoID))
        transcript, _ = s.groq.Transcribe(ctx, audio)                    // Groq Whisper STT
    }

    // 2. Upsert unique words into vocab_words
    for _, word := range transcript.UniqueWords() {
        s.db.Exec(ctx, "INSERT INTO vocab_words (word, language) VALUES ($1, $2) ON CONFLICT DO NOTHING", word, srcLang)
    }

    // 3. Generate contextual definitions for ALL words × 12 native languages
    // Every word gets a fresh definition because meaning depends on sentence context
    for _, lang := range s.nativeLanguages {
        definitions, _ := s.llm.BatchDefine(ctx, transcript.Words, transcript.Text, srcLang, lang)
        s.bulkInsertDefinitions(ctx, videoID, lang, definitions)
    }

    // 4. Link word occurrences to video (timestamps)
    s.insertVideoWords(ctx, videoID, transcript.Words)

    // 5. Generate WebVTT files → upload to R2
    for _, lang := range s.nativeLanguages {
        vtt := s.generateWebVTT(ctx, videoID, lang)
        s.r2.PutObject(ctx, fmt.Sprintf("videos/%s/subs/%s.vtt", videoID, lang), vtt)
    }

    // 6. Extract OCR bounding boxes for tappable subtitle overlay → upload to R2
    // Uses VideOCR (SSIM dedup) at 250ms frame intervals, half-res for speed
    bboxes := s.extractSubtitleBboxes(ctx, videoID) // per-character tap targets
    s.r2.PutObject(ctx, fmt.Sprintf("videos/%s/bboxes.json", videoID), bboxes)

    s.db.Exec(ctx, "UPDATE videos SET status='ready' WHERE id=$1", videoID) // 7. Mark ready
    return nil
}
```

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

### Tables (12)

| Table | Purpose |
|-------|---------|
| `users` | Profile, language prefs (native + learning), streak, stats |
| `videos` | Video metadata, language, status, CDN URLs |
| `vocab_words` | Canonical word entries per language (word, POS, frequency, TTS URL) |
| `word_definitions` | LLM contextual definitions per (word, target_lang, sentence_context) |
| `video_words` | Links words to timestamps in a video + their definitions |
| `flashcards` | User's saved words with SM-2 SRS state (FKs to vocab_words + word_definitions) |
| `user_views` | Watch tracking (completion %, view count) |
| `user_likes` | Liked videos |
| `user_bookmarks` | Bookmarked videos |
| `comments` | Video comments (max 500 chars) |
| `daily_progress` | Daily activity stats for streak tracking |
| `pipeline_jobs` | AI pipeline status per video |

### Key Design Decisions
- **Normalized definitions**: `vocab_words` + `word_definitions` instead of JSONB blobs in subtitles — same word across videos shares definitions, flashcards reference by FK
- **Flashcard references**: Cards store FKs to vocab_words + word_definitions + SRS state. Client MMKV caches display data for offline
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
# Standardize to 720p progressive MP4
ffmpeg -i source.mp4 \
  -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset medium -crf 23 -profile:v main \
  -c:a aac -b:a 128k -movflags +faststart -t 60 output.mp4

# Upload
scrollingo-admin upload --file output.mp4 --lang en --title "Ordering Coffee"
```

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

- PostgREST disabled — all access through Go backend
- Auth: Supabase JWT → Go middleware verifies via JWKS (cached 1h)
- Admin: separate `/internal/admin/*` path, API key + IP allowlist
- Secrets: fly.io secrets

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
| Compute | fly.io shared-cpu-2x | $5.00 |
| Storage + CDN | Cloudflare R2 | $0.00 |
| Monitoring | Axiom + Sentry + Grafana | $0.00 |
| STT | Groq Whisper (100 videos) | $0.03 |
| Translation | Google Translate (100 videos) | $0.80 |
| Definitions | Claude Haiku 3.5 (100 videos x 12 langs) | ~$1.00 |
| TTS storage | R2 (pre-generated audio) | $0.03 |
| **Total** | | **~$32/mo** |
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
