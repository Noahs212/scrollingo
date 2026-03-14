# Scrollingo — Phase 1 Database Design

> Supabase PostgreSQL | 11 tables | Covers requirements R1-R32

---

## Entity Relationship Overview

```
users ─────────────┬──────────────┬───────────────┬──────────────┐
                   │              │               │              │
              user_views     user_likes     user_bookmarks   comments
                   │              │               │              │
                   └──────┬───────┘               │              │
                          │                       │              │
                       videos ────────────── video_words ────────┘
                          │                    │
                     pipeline_jobs        vocab_words ──── word_definitions
                                               │
                                          flashcards
                                               │
                                        daily_progress
```

### Table Summary

| Table | Purpose | Req |
|-------|---------|-----|
| `users` | Profile, language prefs, streak, stats | R7, R8, R18-R21, R26 |
| `videos` | Video metadata, status, counts | R1-R5, R29, R32 |
| `vocab_words` | Canonical word entries per language (word, frequency, TTS URL, pinyin) | R11, R22, R31 |
| `word_definitions` | LLM-generated contextual definitions per (word, source_lang, target_lang, sentence) | R11, R24, R30 |
| `video_words` | Links words in a video to their timestamps + definitions | R10, R11 |
| `flashcards` | User's saved words with SM-2 SRS state | R13-R15, R17 |
| `user_views` | Watch tracking (completion %, view count) | R2, R3, R27 |
| `user_likes` | Liked videos | R6 |
| `user_bookmarks` | Bookmarked videos | R6 |
| `comments` | Video comments | R6 |
| `daily_progress` | Daily streak + activity stats | R26-R28 |
| `pipeline_jobs` | AI pipeline tracking per video | R29, R30, R32 |

---

## Schema

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- Fuzzy word search

-- ============================================================
-- 1. USERS
-- ============================================================
-- Profile, language preferences, learning stats.
-- Auth is handled by Supabase Auth; this stores the app-level profile.

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supabase_uid        TEXT UNIQUE NOT NULL,

    -- Profile
    username            TEXT UNIQUE,
    display_name        TEXT,
    avatar_url          TEXT,

    -- Language preferences (R18-R21)
    native_language     TEXT NOT NULL DEFAULT 'en',        -- ISO 639-1: definitions rendered in this
    target_language     TEXT NOT NULL DEFAULT 'en',        -- Active learning language (filters feed)
    learning_languages  TEXT[] NOT NULL DEFAULT '{"en"}',  -- All learning languages

    -- Learning stats (R26-R27)
    daily_goal_minutes  SMALLINT NOT NULL DEFAULT 10,
    streak_days         INT NOT NULL DEFAULT 0,
    streak_last_date    DATE,
    total_words_learned INT NOT NULL DEFAULT 0,
    total_videos_watched INT NOT NULL DEFAULT 0,

    -- Subscription
    premium             BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_supabase ON users(supabase_uid);
CREATE INDEX idx_users_language ON users(target_language);

-- ============================================================
-- 2. VIDEOS
-- ============================================================
-- Metadata for curated videos seeded by the team.
-- No user uploads in Phase 1 (R4).

CREATE TABLE videos (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title             TEXT NOT NULL,
    description       TEXT,
    language          TEXT NOT NULL,                     -- Source language (ISO 639-1)
    difficulty        TEXT,                              -- Free-form tag (e.g. 'beginner', 'intermediate')
    duration_sec      SMALLINT NOT NULL,
    tags              TEXT[] DEFAULT '{}',

    -- Storage (R5)
    r2_video_key      TEXT NOT NULL,                     -- videos/{id}/video.mp4
    cdn_url           TEXT NOT NULL,                     -- Full CDN playback URL
    thumbnail_url     TEXT,
    transcript_text   TEXT,                              -- Raw STT transcript

    -- Processing (R29, R32)
    status            TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('uploading','processing','ready','failed')),
    seeded_by         TEXT,                              -- Admin who uploaded
    processed_at      TIMESTAMPTZ,

    -- Denormalized counts (updated via triggers or background workers)
    view_count        INT NOT NULL DEFAULT 0,
    like_count        INT NOT NULL DEFAULT 0,
    comment_count     INT NOT NULL DEFAULT 0,
    bookmark_count    INT NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_videos_feed ON videos(language, status, created_at DESC);

-- ============================================================
-- 3. VOCAB WORDS
-- ============================================================
-- Canonical vocabulary entries per language.
-- One row per unique word per language. Shared across all users and videos.
-- TTS audio is pre-generated for all ~100K words per learning language (R31).

CREATE TABLE vocab_words (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    word            TEXT NOT NULL,
    language        TEXT NOT NULL,             -- Language this word belongs to (ISO 639-1)
    frequency_rank  INT,                       -- Zipf frequency rank (lower = more common)
    pinyin          TEXT,                      -- Chinese only: romanization
    simplified      TEXT,                      -- Chinese only: simplified form
    traditional     TEXT,                      -- Chinese only: traditional form
    tts_url         TEXT,                      -- R2 CDN URL for pre-generated pronunciation audio
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(word, language)
);

CREATE INDEX idx_vocab_word ON vocab_words(word, language);
CREATE INDEX idx_vocab_trgm ON vocab_words USING gin (word gin_trgm_ops);  -- Fuzzy search
CREATE INDEX idx_vocab_frequency ON vocab_words(language, frequency_rank);

-- ============================================================
-- 4. WORD DEFINITIONS
-- ============================================================
-- LLM-generated contextual definitions (R24, R30).
-- Per (vocab_word, target_language, sentence_context).
-- The same word can have different contextual meanings in different sentences.
-- Generated during the AI pipeline, stored for all 12 native languages.
--
-- Example: "bank" in "I sat by the river bank" vs "I went to the bank"
--   → different contextual_definition, same translation in some languages.

CREATE TABLE word_definitions (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vocab_word_id          UUID NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
    target_language        TEXT NOT NULL,           -- Native language (definition rendered in this)
    sentence_context       TEXT,                    -- The sentence this word appeared in (for context)
    translation            TEXT NOT NULL,           -- Translated word (NOT the full sentence)
    contextual_definition  TEXT NOT NULL,           -- LLM-generated explanation in target language
    part_of_speech         TEXT,                    -- May differ from vocab_words.part_of_speech by context
    llm_provider           TEXT,                    -- Which LLM generated this
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(vocab_word_id, target_language, sentence_context)
);

CREATE INDEX idx_definitions_word ON word_definitions(vocab_word_id, target_language);

-- ============================================================
-- 5. VIDEO WORDS
-- ============================================================
-- Junction table: links words appearing in a video to their timestamps.
-- Each row = one word occurrence at a specific time in a specific video.
-- References the vocab_word and the contextual definition for the user's language.

CREATE TABLE video_words (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id        UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    vocab_word_id   UUID NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
    definition_id   UUID REFERENCES word_definitions(id),  -- Contextual definition for this occurrence
    start_ms        INT NOT NULL,              -- Word start time in video (milliseconds)
    end_ms          INT NOT NULL,              -- Word end time in video
    word_index      SMALLINT NOT NULL,         -- Position in transcript (0-based)
    display_text    TEXT NOT NULL,             -- How the word appears in subtitles (may differ from canonical)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_video_words_video ON video_words(video_id, word_index);
CREATE INDEX idx_video_words_vocab ON video_words(vocab_word_id);

-- ============================================================
-- 6. FLASHCARDS (User Saved Words)
-- ============================================================
-- When a user taps a word and saves it (R13), a flashcard is created.
-- SM-2 spaced repetition fields for review scheduling (R14).
-- Works offline via MMKV on client, synced to server (R15).

CREATE TABLE flashcards (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vocab_word_id    UUID NOT NULL REFERENCES vocab_words(id),    -- → word, tts_url, pinyin
    definition_id    UUID REFERENCES word_definitions(id),        -- → translation, contextual_definition, POS
    source_video_id  UUID REFERENCES videos(id),                  -- Video where word was tapped

    -- SM-2 SRS fields (R14)
    ease_factor      REAL NOT NULL DEFAULT 2.5,
    interval_days    INT NOT NULL DEFAULT 0,
    repetitions      INT NOT NULL DEFAULT 0,
    next_review      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_review      TIMESTAMPTZ,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_flashcards_due ON flashcards(user_id, next_review);
CREATE INDEX idx_flashcards_user_word ON flashcards(user_id, vocab_word_id, target_language);  -- Dedup

-- ============================================================
-- 7. USER VIEWS
-- ============================================================
-- Tracks which videos a user has watched and how much (R2, R3, R27).
-- Used by feed query to exclude already-watched videos.

CREATE TABLE user_views (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id       UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    watch_percent  SMALLINT NOT NULL DEFAULT 0,   -- 0-100, highest completion
    view_count     SMALLINT NOT NULL DEFAULT 1,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_user_views_video ON user_views(video_id, user_id);  -- For feed LEFT JOIN

-- ============================================================
-- 8. USER LIKES
-- ============================================================
CREATE TABLE user_likes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id   UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

-- ============================================================
-- 9. USER BOOKMARKS
-- ============================================================
CREATE TABLE user_bookmarks (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id   UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

-- ============================================================
-- 10. COMMENTS
-- ============================================================
CREATE TABLE comments (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id   UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL CHECK (length(body) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_video ON comments(video_id, created_at DESC);

-- ============================================================
-- 11. DAILY PROGRESS
-- ============================================================
-- One row per user per day. Tracks activity for streak calculation (R26-R28).

CREATE TABLE daily_progress (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date              DATE NOT NULL,
    minutes_active    SMALLINT NOT NULL DEFAULT 0,
    videos_watched    SMALLINT NOT NULL DEFAULT 0,
    words_learned     SMALLINT NOT NULL DEFAULT 0,    -- New flashcards created
    cards_reviewed    SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

-- ============================================================
-- 12. PIPELINE JOBS
-- ============================================================
-- Tracks AI processing status per video (R29, R30, R32).

CREATE TABLE pipeline_jobs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id      UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','stt','translating','definitions','ready','failed')),
    error_message TEXT,
    retry_count   SMALLINT NOT NULL DEFAULT 0,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pipeline_status ON pipeline_jobs(status);
CREATE INDEX idx_pipeline_video ON pipeline_jobs(video_id);
```

---

## Key Design Decisions

### 1. `vocab_words` vs embedding definitions in subtitles JSONB

**Before**: Definitions lived in `subtitles.word_data` JSONB — a blob per video per language.

**Now**: Definitions are normalized into `vocab_words` + `word_definitions` + `video_words`.

Why:
- Same word appears across many videos → definitions are reusable, not duplicated
- Flashcards reference `vocab_word_id` directly → clean foreign key
- Can query "all definitions for word X" without parsing JSONB blobs
- Can update/improve a definition in one place and all videos benefit
- `video_words` tracks where each word appears (timestamps) separately from what it means

### 2. Flashcards reference, don't snapshot

Flashcards store only FKs (`vocab_word_id`, `definition_id`) + SRS state. All display data (word, translation, definition, TTS URL) is fetched via JOINs. The client-side MMKV store handles offline caching — the server doesn't need to duplicate it.

### 3. No `flashcard_decks` table

Removed for Phase 1. A single implicit deck per user is sufficient. Deck management adds UI complexity with no learning benefit at this stage. Can add in Phase 2 if users want to organize by topic/language.

### 4. No `subtitles` table

Replaced by `video_words`. The WebVTT files are still generated and stored in R2 for the video player, but the structured data lives in `video_words` + `word_definitions` (queryable, referenceable). The subtitle file becomes a rendering artifact, not the source of truth.

### 5. No `tts_cache` or `dictionary` tables

- `tts_cache` → unnecessary; TTS is fully pre-generated, tracked via `vocab_words.tts_url`
- `dictionary` → replaced by `vocab_words` + `word_definitions` (normalized, not a vague cache)

### 6. Contextual definitions are per (word, target_lang, sentence)

The same word can mean different things in different contexts:
- "bank" in "river bank" → orilla (es)
- "bank" in "go to the bank" → banco (es)

`word_definitions` is keyed on `(vocab_word_id, target_language, sentence_context)` so each contextual meaning gets its own row.

---

## Data Flow: Word Tap → Flashcard Save

```
1. User watches video (video_id = X)
2. SubtitleOverlay renders words from video_words WHERE video_id = X
3. User taps "café"
   → App looks up: video_words.vocab_word_id → vocab_words (get tts_url, pinyin)
   → App looks up: video_words.definition_id → word_definitions (get translation, contextual_definition)
   → Bottom sheet shows: "café" → "coffee" + "The beverage, ordering context" + [play audio]
4. User taps "Save"
   → POST /api/v1/flashcards { vocab_word_id, definition_id, source_video_id }
   → Flashcard created with SM-2 defaults (ease=2.5, interval=0, next_review=now)
   → Client caches full display data in MMKV (word, translation, TTS URL, etc.)
   → Server stores only FKs + SRS state
```

---

## Data Flow: AI Pipeline (per video)

```
1. Admin uploads video → pipeline_jobs.status = 'pending'

2. STT (Groq Whisper):
   → Extract transcript with word-level timestamps
   → For each unique word: INSERT INTO vocab_words (word, language) ON CONFLICT DO NOTHING
   → pipeline_jobs.status = 'stt'

3. Translation + Definitions (per native language):
   → Google Translate: get bulk translation
   → LLM batch: generate contextual definitions for all words
   → For each word × native language:
       INSERT INTO word_definitions (vocab_word_id, target_language, sentence_context, ...)
       ON CONFLICT DO NOTHING
   → pipeline_jobs.status = 'definitions'

4. Link words to video:
   → For each word occurrence in transcript:
       INSERT INTO video_words (video_id, vocab_word_id, definition_id, start_ms, end_ms, ...)

5. Generate WebVTT file → upload to R2 (rendering artifact)

6. videos.status = 'ready', pipeline_jobs.status = 'ready'
```

---

## Row Count Projections (Phase 1, 12 months)

| Table | Rows at Month 1 | Rows at Month 12 | Growth Driver |
|-------|-----------------|-------------------|---------------|
| users | ~100 | ~5,000 | MAU growth |
| videos | 100 | 1,200 | 100 seeded/month |
| vocab_words | ~5,000 | ~15,000 | Unique words across all videos |
| word_definitions | ~60,000 | ~180,000 | 15K words × 12 native langs (deduped) |
| video_words | ~5,000 | ~60,000 | ~50 words/video × 1,200 videos |
| flashcards | ~500 | ~50,000 | ~10 cards/user × 5,000 users |
| user_views | ~2,000 | ~100,000 | Users × videos watched |
| user_likes | ~200 | ~10,000 | ~2 likes/user |
| comments | ~50 | ~5,000 | ~1 comment/user |
| daily_progress | ~3,000 | ~150,000 | Users × active days |
| pipeline_jobs | 100 | 1,200 | 1 per video |

**Total estimated DB size at 12 months: ~50-100 MB** (well within Supabase Pro 8 GB limit).
