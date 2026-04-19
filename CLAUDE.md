# Scrollingo

TikTok-style short video app for language learning. Full TikTok feature set — like, comment, follow, chat, profiles, bookmarks — plus language learning: videos have OCR'd/STT'd subtitles where every word is tappable for contextual definitions, and users can save words to flashcards with FSRS spaced repetition.

## Quick Links
- Architecture details: `docs/phase1_architecture.md`
- Database DDL + design decisions: `docs/database_design.md`
- Cost modeling: `cost_estimator.py` (Streamlit dashboard)
- Pipeline: `scripts/pipeline.py`
- Mobile app: `mobile/`

## Tech Stack

| Layer | Choice |
|-------|--------|
| Mobile | React Native + Expo SDK 54, TypeScript |
| State | Redux Toolkit (5 slices) + React Query v5 |
| Video | expo-video (native AVPlayer/ExoPlayer) |
| Navigation | React Navigation v6 (material-bottom-tabs + native-stack) |
| Auth | Supabase Auth (Google/Apple OAuth, email/password) |
| Database | Supabase Pro (PostgreSQL + Auth + Realtime + RLS) |
| Storage/CDN | Cloudflare R2 (`scrollingo-media` bucket, free egress) |
| Pipeline | Python (`scripts/pipeline.py`) — Go backend deferred to M10 |
| OCR | PaddleOCR PP-OCRv5 via VideOCR (SSIM dedup) |
| STT | Groq Whisper Turbo (M3.5, deferred — current content is OCR-only) |
| Definitions | Claude Haiku 3.5 via OpenRouter, 11 target languages per word |
| SRS | ts-fsrs (FSRS algorithm, replaces SM-2) |
| TTS | expo-speech (on-device, free) |

## Architecture Overview

**Current state (pre-M10):** App talks directly to Supabase via `@supabase/supabase-js` + PostgREST + RLS. No Go backend yet. Pipeline runs locally via Python.

### Data Flow: Video Ingestion
```
Admin runs pipeline.py --video file.mp4
  1. FFmpeg normalize → 720p progressive MP4
  2. VideOCR (SSIM dedup) → subtitle text + bounding boxes
  3. Auto-detect language (langdetect) + auto-title from first caption
  4. Upload video.mp4 + thumbnail.jpg + bboxes.json to R2
  5. Insert video row in Supabase (status='processing')
  6. Segment words (jieba for Chinese, whitespace for others)
  7. LLM definitions: Claude Haiku 3.5 per word x 11 target languages
  8. Insert vocab_words, word_definitions, video_words
  9. Mark video status='ready'
```

### Data Flow: Word Tap → Definition
```
1. Video loads → app fetches video_words JOIN vocab_words JOIN word_definitions
   WHERE video_id = X AND target_language = user.native_language
   → ~50 rows, <20ms, all data pre-loaded
2. User taps word → bottom sheet with translation, definition, POS, pronunciation
3. "Save" → creates flashcard referencing vocab_word + word_definition
```

### Feed
- Chronological, filtered by user's active learning language
- Keyset cursor pagination: `(created_at, id)` compound cursor
- Covering index on videos table avoids heap lookups
- Prefetch next 2 videos + thumbnail placeholders for instant swipe UX

## Database (Supabase PostgreSQL — 15 tables)

### Core Tables
| Table | Purpose |
|-------|---------|
| `users` | Profile, language prefs (native + learning), streak, stats |
| `videos` | Metadata, language, status, CDN URLs, denormalized counts |
| `vocab_words` | Canonical word entries per language (word, pinyin, tts_url) |
| `word_definitions` | LLM contextual defs per (word, video, target_lang) — 11 langs/word |
| `video_words` | Word occurrences with timestamps in a video |
| `flashcards` | User saved words + FSRS state (stability, difficulty, due) |
| `review_logs` | Per-review analytics for future FSRS parameter optimization |

### Social/Engagement Tables
`user_views`, `user_likes`, `user_bookmarks`, `user_follows`, `comments`, `daily_progress`, `pipeline_jobs`

### Key Design Decisions
- **Definitions are contextual**: same word in different videos gets different definitions (keyed on vocab_word_id + video_id + target_language)
- **Supabase auth UID as PK**: `users.id` references `auth.users(id)` directly, RLS uses `auth.uid()`
- **FSRS over SM-2**: per-card stability/difficulty tracking via ts-fsrs
- **Flashcards reference, don't snapshot**: FKs to vocab_words + word_definitions, display data resolved via JOINs
- **RLS as defense-in-depth**: primary access control will be Go backend (M10), RLS is safety net
- **`client_updated_at` for offline sync**: last-write-wins conflict resolution

## Language System

| Type | Languages |
|------|-----------|
| Learning (content) | English, Chinese |
| Native (definitions) | en, es, zh, ja, ko, hi, fr, de, pt, ar, it, ru (12) |

Lookup direction: always **video language → user's native language**. Never guesses direction.

```typescript
// Redux languageSlice
interface LanguageState {
  nativeLanguage: string;           // "es" — definitions rendered in this
  learningLanguages: string[];      // ["en", "zh"]
  activeLearningLanguage: string;   // "en" — filters the feed
}
```

## R2 Storage Layout
```
scrollingo-media/
├── videos/{video_id}/
│   ├── video.mp4          # 720p progressive MP4
│   ├── thumbnail.jpg
│   ├── bboxes.json        # OCR bounding boxes for tap targets
│   └── transcript.json    # Merged OCR+STT transcript
├── tts/{language}/{sha256}.mp3
└── avatars/{user_id}.jpg
```

`bboxes.json` contains per-character tap target positions. The app's SubtitleTapOverlay transforms pixel coords to screen coords (accounting for contentFit="contain" scaling) and renders invisible Pressable targets. Pre-computed lookup table indexed by 50ms buckets for O(1) segment matching.

## Mobile App Structure
```
mobile/src/
├── navigation/        # Root stack (auth gate + onboarding gate), bottom tabs, feed tabs
├── screens/           # feed, auth, onboarding, profile, settings, review, search
├── components/        # PostSingle (video player), subtitle overlays, profile header
├── redux/slices/      # authSlice, languageSlice, postSlice, modalSlice, chatSlice
├── services/          # posts, subtitles, user, language, auth (Supabase)
├── hooks/             # useUser, useFollowing, useFollowingMutation, useCurrentUserId
└── lib/supabase.ts    # Supabase client (expo-secure-store auth)
```

## Phase Roadmap
| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1 | Video distribution, social, language learning UI | In progress |
| Phase 1.5 | Content recommendation (scored feed, quizzes) | After Phase 1 stable |
| Phase 2 | User uploads, offline mode, scale to 100K MAU | 10K+ MAU |
| Phase 3 | ML recommendations, A/B testing, moderation | 100K+ MAU |

### Not in Phase 1
- Proficiency system (CEFR/HSK/JLPT) — deferred to 1.5
- Scored/personalized feed — chronological first
- User video uploads — moderation concerns
- Go backend — M10, currently direct Supabase
- HLS streaming — progressive MP4 fine for <60s clips
- Redis — Go sync.Map sufficient
- Offline flashcard review — needs MMKV (Phase 2)

## Monthly Cost (~$31/mo at 10K MAU)
| Component | Cost |
|-----------|------|
| Supabase Pro | $25 |
| Cloudflare R2 | $0 (free tier) |
| LLM definitions (100 videos x 11 langs) | ~$1 |
| Monitoring (Axiom + Sentry + Grafana) | $0 |
| Compute (fly.io, M10) | $5 |

## Dev Notes
- Node v25.8.1 via `/usr/local/Cellar/node/25.8.1_1/bin`
- iOS 18.4 simulator (iOS 26.x causes Expo Go errors)
- SDK 54 install requires `--legacy-peer-deps` (react-dom peer conflict)
- Simulator network is flaky — Supabase fetches have 5s timeout + optimistic saves
- Pipeline tests: `pytest scripts/test_pipeline.py` (48 tests)
- Mobile tests: `cd mobile && npx jest` (114 tests)
