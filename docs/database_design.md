# Scrollingo — Phase 1 Database Design

> Supabase PostgreSQL | 15 tables | Covers requirements R1-R37

---

## Entity Relationship Overview

```
users ─────┬──────────┬───────────┬────────────┬──────────────┐
           │          │           │            │              │
      user_views  user_likes  user_bookmarks  comments   user_follows
           │          │           │            │              │
           └────┬─────┘           │            │              │
                │                 │            │              │
             videos ──────── video_words ──────┘              │
                │                 │                            │
           pipeline_jobs     vocab_words ──── word_definitions │
                                  │                            │
                             flashcards ───────────────────────┘
                                  │
                           daily_progress
```

### Table Summary

| # | Table | Purpose | Req |
|---|-------|---------|-----|
| 1 | `users` | Profile, language prefs, streak, stats. PK = Supabase auth UID | R7, R8, R22-R25, R30 |
| 2 | `videos` | Video metadata, status, counts, subtitle source (STT/OCR) | R1-R5, R13-R15, R33, R37 |
| 3 | `vocab_words` | Canonical word entries per language (word, frequency, TTS URL, pinyin) | R11, R26, R36 |
| 4 | `word_definitions` | LLM contextual definitions per (word, target_lang, sentence) | R11, R28, R34 |
| 5 | `video_words` | Links words in a video to timestamps + sentence context | R10, R11, R16 |
| 6 | `flashcards` | User's saved words with FSRS SRS state | R17-R19, R21 |
| 7 | `review_logs` | Per-review analytics (rating, duration) | R18 |
| 8 | `user_views` | Watch tracking (completion %, view count) | R2, R3, R31 |
| 9 | `user_likes` | Liked videos | R6 |
| 10 | `user_bookmarks` | Bookmarked videos | R6 |
| 11 | `comments` | Video comments | R6 |
| 12 | `user_follows` | Follower/following relationships | R7 |
| 13 | `daily_progress` | Daily streak + activity stats | R30-R32 |
| 14 | `pipeline_jobs` | AI pipeline tracking per video | R33, R34, R37 |

---

## Schema

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- Fuzzy word search

-- NOTE: Using gen_random_uuid() (built-in) instead of pg_uuidv7.
-- pg_uuidv7 is not guaranteed on all Supabase instances.
-- If your project supports it, replace gen_random_uuid() with uuid_generate_v7().

-- ============================================================
-- 1. USERS
-- ============================================================
-- PK is the Supabase auth UID directly (no dual-identity).
-- All RLS policies use auth.uid() without extra JOINs.

CREATE TABLE users (
    id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Profile (R7)
    username            TEXT UNIQUE,
    display_name        TEXT,
    avatar_url          TEXT,

    -- Language preferences (R22-R25)
    native_language     TEXT NOT NULL DEFAULT 'en',        -- ISO 639-1: definitions rendered in this
    target_language     TEXT NOT NULL DEFAULT 'en',        -- Active learning language (filters feed)
    learning_languages  TEXT[] NOT NULL DEFAULT '{"en"}',  -- All learning languages

    -- Learning stats (R30-R31)
    daily_goal_minutes  SMALLINT NOT NULL DEFAULT 10,
    streak_days         INT NOT NULL DEFAULT 0,
    streak_last_date    DATE,
    longest_streak      INT NOT NULL DEFAULT 0,            -- Best streak ever (for badges)
    total_words_learned INT NOT NULL DEFAULT 0,
    total_videos_watched INT NOT NULL DEFAULT 0,

    -- Social counts (denormalized, updated by triggers)
    follower_count      INT NOT NULL DEFAULT 0,
    following_count     INT NOT NULL DEFAULT 0,

    -- Subscription
    premium             BOOLEAN NOT NULL DEFAULT FALSE,

    -- Review settings
    max_reviews_per_day SMALLINT NOT NULL DEFAULT 20,      -- Caps flashcards pulled per review session

    -- User preferences (extensible without schema changes)
    preferences         JSONB NOT NULL DEFAULT '{}',       -- {notifications: true, theme: "dark", ...}

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_language ON users(target_language);

-- ============================================================
-- 2. VIDEOS
-- ============================================================
-- Metadata for curated videos seeded by the team.
-- No user uploads in Phase 1 (R4).

CREATE TABLE videos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT NOT NULL,
    description       TEXT,
    language          TEXT NOT NULL,                     -- Source language (ISO 639-1)
    difficulty        TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    duration_sec      SMALLINT NOT NULL CHECK (duration_sec > 0),
    tags              TEXT[] DEFAULT '{}',

    -- Storage (R5)
    r2_video_key      TEXT NOT NULL,                     -- videos/{id}/video.mp4
    cdn_url           TEXT NOT NULL,                     -- Full CDN playback URL
    thumbnail_url     TEXT,
    transcript_text   TEXT,                              -- Raw transcript (from STT or OCR)

    -- Subtitle extraction (R13-R15)
    subtitle_source   TEXT                               -- NULL = not yet determined; set by pipeline
        CHECK (subtitle_source IN ('stt', 'ocr')),

    -- Processing (R33, R37)
    status            TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('uploading','processing','ready','failed')),
    seeded_by         TEXT,
    processed_at      TIMESTAMPTZ,

    -- Denormalized counts
    view_count        INT NOT NULL DEFAULT 0,
    like_count        INT NOT NULL DEFAULT 0,
    comment_count     INT NOT NULL DEFAULT 0,
    bookmark_count    INT NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_videos_feed ON videos(language, status, created_at DESC, id DESC)
    INCLUDE (title, cdn_url, thumbnail_url, duration_sec, difficulty, view_count, like_count);

-- ============================================================
-- 3. VOCAB WORDS
-- ============================================================
-- Canonical vocabulary entries per language.
-- One row per unique word per language. Shared across all users and videos.
-- TTS audio is pre-generated for all ~100K words per learning language (R36).

CREATE TABLE vocab_words (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word            TEXT NOT NULL,
    language        TEXT NOT NULL,
    frequency_rank  INT,                       -- Zipf frequency rank (lower = more common)
    pinyin          TEXT,                      -- Chinese only: romanization
    simplified      TEXT,                      -- Chinese only: simplified form
    traditional     TEXT,                      -- Chinese only: traditional form
    tts_url         TEXT,                      -- R2 CDN URL for pre-generated pronunciation audio
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(word, language)
);

-- UNIQUE constraint creates implicit index on (word, language)
CREATE INDEX idx_vocab_trgm ON vocab_words USING gin (word gin_trgm_ops);
CREATE INDEX idx_vocab_frequency ON vocab_words(language, frequency_rank);

-- ============================================================
-- 4. WORD DEFINITIONS
-- ============================================================
-- LLM-generated CONTEXTUAL definitions.
-- Per (word, video, target_language) — every word in every video
-- gets its own definition because meaning depends on sentence context.
--
-- "run" in "I went for a run" → translation: carrera, POS: noun
-- "run" in "run the program"  → translation: ejecutar, POS: verb
--
-- The LLM prompt includes the source sentence for context.
-- Pipeline generates definitions for every word × every video × 12 native languages.
--
-- NOTE: target_language = the user's native language (definitions rendered in it).

CREATE TABLE word_definitions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vocab_word_id          UUID NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
    video_id               UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    target_language        TEXT NOT NULL,           -- User's native language
    translation            TEXT NOT NULL,           -- Translated word (NOT the full sentence)
    contextual_definition  TEXT NOT NULL,           -- LLM-generated explanation in target language
    part_of_speech         TEXT,                    -- POS in this specific context
    source_sentence        TEXT,                    -- The sentence used as LLM context
    llm_provider           TEXT,                    -- Which LLM generated this
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(vocab_word_id, video_id, target_language)
);

CREATE INDEX idx_definitions_video ON word_definitions(video_id, target_language);
CREATE INDEX idx_definitions_word ON word_definitions(vocab_word_id, target_language);

-- ============================================================
-- 5. VIDEO WORDS
-- ============================================================
-- Links words appearing in a video to their timestamps.
-- Each row = one word occurrence at a specific time.
-- Definitions resolved at query time via simple JOIN on vocab_word_id + target_language.

CREATE TABLE video_words (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    vocab_word_id   UUID NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
    start_ms        INT NOT NULL CHECK (start_ms >= 0),
    end_ms          INT NOT NULL,
    word_index      SMALLINT NOT NULL,         -- Position in transcript (0-based)
    display_text    TEXT NOT NULL,             -- How the word appears in subtitles
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_ms > start_ms)
);

CREATE INDEX idx_video_words_video ON video_words(video_id, word_index);
CREATE INDEX idx_video_words_vocab ON video_words(vocab_word_id);

-- ============================================================
-- 6. FLASHCARDS (User Saved Words)
-- ============================================================
-- FSRS (Free Spaced Repetition Scheduler) fields for review scheduling (R18).
-- Uses ts-fsrs package — modern replacement for SM-2 with per-card
-- stability and difficulty tracking.
-- Display data (word, translation, TTS) resolved via JOINs.
-- Client MMKV caches display data for offline review (R19).
-- client_updated_at allows last-write-wins conflict resolution on sync.

CREATE TABLE flashcards (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vocab_word_id    UUID NOT NULL REFERENCES vocab_words(id) ON DELETE RESTRICT,
    definition_id    UUID NOT NULL REFERENCES word_definitions(id) ON DELETE RESTRICT,
    source_video_id  UUID REFERENCES videos(id) ON DELETE SET NULL,

    -- FSRS SRS fields (R18) — mirrors ts-fsrs Card interface
    state            SMALLINT NOT NULL DEFAULT 0,    -- 0=new, 1=learning, 2=review, 3=relearning
    stability        DOUBLE PRECISION NOT NULL DEFAULT 0,  -- FSRS stability — retention strength
    difficulty       DOUBLE PRECISION NOT NULL DEFAULT 0,  -- FSRS difficulty — inherent card hardness
    elapsed_days     DOUBLE PRECISION NOT NULL DEFAULT 0,  -- Days since last review
    scheduled_days   DOUBLE PRECISION NOT NULL DEFAULT 0,  -- Days until next scheduled review
    reps             INT NOT NULL DEFAULT 0,               -- Total successful repetitions
    lapses           INT NOT NULL DEFAULT 0,               -- Times card lapsed (forgot after learning)
    learning_steps   INT NOT NULL DEFAULT 0,               -- Current learning/relearning step
    due              TIMESTAMPTZ NOT NULL DEFAULT NOW(),    -- Next review due date (UTC)
    last_review_at   TIMESTAMPTZ,                          -- When last reviewed

    -- Offline sync (R19, N4)
    client_updated_at TIMESTAMPTZ,             -- Set by client; last-write-wins conflict resolution

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_flashcards_due ON flashcards(user_id, due);
CREATE UNIQUE INDEX idx_flashcards_dedup ON flashcards(user_id, vocab_word_id, definition_id);

-- ============================================================
-- 7. REVIEW LOGS (Per-Review Analytics)
-- ============================================================
-- Recorded per review for analytics and future FSRS parameter optimization.
-- FSRS supports per-user weight tuning based on review history.

CREATE TABLE review_logs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flashcard_id     UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 4), -- 1=Again, 2=Hard, 3=Good, 4=Easy
    review_duration_ms INT,                    -- Milliseconds spent on card (optional)
    -- FSRS state snapshot at time of review (for parameter optimization)
    state            SMALLINT,
    stability        DOUBLE PRECISION,
    difficulty       DOUBLE PRECISION,
    elapsed_days     DOUBLE PRECISION,
    last_elapsed_days DOUBLE PRECISION,
    scheduled_days   DOUBLE PRECISION,
    learning_steps   INT,
    reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_review_logs_user ON review_logs(user_id, reviewed_at DESC);

-- ============================================================
-- 7. USER VIEWS
-- ============================================================
CREATE TABLE user_views (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id       UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    watch_percent  SMALLINT NOT NULL DEFAULT 0 CHECK (watch_percent BETWEEN 0 AND 100),
    view_count     SMALLINT NOT NULL DEFAULT 1,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_user_views_video ON user_views(video_id, user_id);

-- ============================================================
-- 8. USER LIKES
-- ============================================================
CREATE TABLE user_likes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id   UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_likes_user ON user_likes(user_id, created_at DESC);

-- ============================================================
-- 9. USER BOOKMARKS
-- ============================================================
CREATE TABLE user_bookmarks (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id   UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_bookmarks_user ON user_bookmarks(user_id, created_at DESC);

-- ============================================================
-- 10. COMMENTS
-- ============================================================
CREATE TABLE comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id   UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL CHECK (length(body) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_video ON comments(video_id, created_at DESC);

-- ============================================================
-- 11. USER FOLLOWS (R7)
-- ============================================================
CREATE TABLE user_follows (
    follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id != following_id)        -- Can't follow yourself
);

CREATE INDEX idx_follows_following ON user_follows(following_id);  -- "Who follows me?"

-- ============================================================
-- 12. DAILY PROGRESS
-- ============================================================
CREATE TABLE daily_progress (
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date              DATE NOT NULL,
    minutes_active    SMALLINT NOT NULL DEFAULT 0,
    videos_watched    SMALLINT NOT NULL DEFAULT 0,
    words_learned     SMALLINT NOT NULL DEFAULT 0,
    cards_reviewed    SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

-- ============================================================
-- 13. PIPELINE JOBS
-- ============================================================
CREATE TABLE pipeline_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id      UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','extracting','translating','definitions','ready','failed')),
    error_message TEXT,
    retry_count   SMALLINT NOT NULL DEFAULT 0,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pipeline_status ON pipeline_jobs(status);
CREATE INDEX idx_pipeline_video ON pipeline_jobs(video_id);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_videos_updated BEFORE UPDATE ON videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_flashcards_updated BEFORE UPDATE ON flashcards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_comments_updated BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_pipeline_updated BEFORE UPDATE ON pipeline_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Defense-in-depth. Primary access control is the Go backend (service-role key).
-- RLS protects against accidental PostgREST exposure.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_jobs ENABLE ROW LEVEL SECURITY;

-- Users: anyone can read profiles (R7), own can insert/update/delete
CREATE POLICY users_read ON users FOR SELECT USING (true);
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY users_write ON users FOR UPDATE USING (id = auth.uid());
CREATE POLICY users_delete ON users FOR DELETE USING (id = auth.uid());

-- User content: own data only
CREATE POLICY flashcards_own ON flashcards FOR ALL USING (user_id = auth.uid());
CREATE POLICY views_own ON user_views FOR ALL USING (user_id = auth.uid());
CREATE POLICY likes_own ON user_likes FOR ALL USING (user_id = auth.uid());
CREATE POLICY bookmarks_own ON user_bookmarks FOR ALL USING (user_id = auth.uid());
CREATE POLICY progress_own ON daily_progress FOR ALL USING (user_id = auth.uid());
CREATE POLICY follows_own ON user_follows FOR ALL USING (follower_id = auth.uid());
CREATE POLICY follows_read ON user_follows FOR SELECT USING (true);  -- Anyone can see who follows whom

-- Comments: anyone can read, own can write/edit/delete
CREATE POLICY comments_read ON comments FOR SELECT USING (true);
CREATE POLICY comments_insert ON comments FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY comments_update ON comments FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY comments_delete ON comments FOR DELETE USING (user_id = auth.uid());

-- Content tables: read-only for authenticated users
CREATE POLICY videos_read ON videos FOR SELECT USING (status = 'ready');
CREATE POLICY vocab_read ON vocab_words FOR SELECT USING (true);
CREATE POLICY definitions_read ON word_definitions FOR SELECT USING (true);
CREATE POLICY video_words_read ON video_words FOR SELECT USING (true);

-- Review logs: own data only
CREATE POLICY review_logs_own ON review_logs FOR ALL USING (user_id = auth.uid());

-- Pipeline jobs: service-role only (no user-facing policy)
```

---

## Key Design Decisions

### 1. Supabase auth UID as PK
`users.id` references `auth.users(id)` directly. No separate `supabase_uid`. All RLS policies use `auth.uid()` without extra JOINs.

### 2. `gen_random_uuid()` over pg_uuidv7
`pg_uuidv7` is not guaranteed on all Supabase instances. Using built-in `gen_random_uuid()` for portability. If your Supabase project supports it, swap to `uuid_generate_v7()` for better index locality on hot write tables.

### 3. Definitions are per word per video per language
Every word in every video gets its own LLM-generated contextual definition for each of 12 native languages. This is essential because the same word can mean different things depending on the sentence it appears in. Keyed on `(vocab_word_id, video_id, target_language)`.

The hot-path query (load all subtitle data for a video) is a clean equi-join on indexed UUID columns:
```sql
SELECT vw.display_text, vw.start_ms, vw.end_ms,
       v.word, v.tts_url, v.pinyin,
       wd.translation, wd.contextual_definition, wd.part_of_speech
FROM video_words vw
JOIN vocab_words v ON v.id = vw.vocab_word_id
JOIN word_definitions wd ON wd.vocab_word_id = vw.vocab_word_id
    AND wd.video_id = vw.video_id
    AND wd.target_language = $user_native_language
WHERE vw.video_id = $video_id
ORDER BY vw.word_index;
```

### 4. FSRS over SM-2
FSRS (Free Spaced Repetition Scheduler) replaces SM-2 for better retention modeling. Per-card state includes stability (retention strength) and difficulty (inherent hardness). The `ts-fsrs` package provides the algorithm. Review logs enable per-user FSRS parameter optimization in the future.

### 5. Flashcard `definition_id` is NOT NULL
Made NOT NULL (with ON DELETE RESTRICT) to prevent the NULL-in-UNIQUE problem. A flashcard always has a specific definition. If the definition is deleted, the flashcard is protected (RESTRICT prevents deletion).

### 6. `client_updated_at` for offline sync
When two devices edit the same flashcard offline, the server uses `client_updated_at` for last-write-wins conflict resolution. The `updated_at` column is server-managed (trigger); `client_updated_at` is set by the client.

### 7. Flashcards reference, don't snapshot
Flashcards store only FKs + FSRS state. Display data resolved via JOINs. Client MMKV caches display data for offline use.

### 8. `subtitle_source` defaults to NULL
NULL means "not yet determined." The pipeline auto-detects whether to use OCR or STT, then sets the value. No misleading default.

### 9. Feed pagination uses compound cursor `(created_at, id)`
Both columns are in the index key (not just INCLUDE) so the keyset cursor `WHERE (created_at, id) < ($cursor_ts, $cursor_id)` works efficiently.

### 10. Covering index on `videos` for feed query
`idx_videos_feed` INCLUDEs the columns needed by the feed query, avoiding heap lookups.

### 11. RLS as defense-in-depth
Primary access control is the Go backend (service-role key bypasses RLS). RLS policies are a safety net against accidental PostgREST exposure. User profiles are readable by anyone (R7 requires viewing other profiles).

---

## Data Flow: Word Tap → Flashcard Save

```
1. User watches video (video_id = X, native_language = "es")
2. App fetches: video_words JOIN vocab_words JOIN word_definitions
   WHERE vw.video_id = X AND wd.video_id = X AND wd.target_language = "es"
   → Single query returns all words with timestamps + contextual translations + TTS URLs
   → ~50 rows per video, served in <20ms from indexed tables
3. SubtitleOverlay renders tappable words synced to video playback
4. User taps "café"
   → Bottom sheet: "café" → "coffee" + "La bebida, en contexto de pedir" + [play audio]
   → Data already loaded from step 2 (no extra query)
5. User taps "Save"
   → POST /api/v1/flashcards { vocab_word_id, definition_id, source_video_id }
   → UNIQUE index prevents duplicate saves
   → Client caches display data in MMKV for offline
```

---

## Data Flow: AI Pipeline (per video)

```
1. Admin uploads video → pipeline_jobs.status = 'pending'

2. Text extraction (status = 'extracting'):
   → Auto-detect: burned-in subs → OCR, otherwise → STT
   → Set videos.subtitle_source = 'ocr' or 'stt'
   → For each unique word: INSERT INTO vocab_words ON CONFLICT DO NOTHING

3. Translation + Definitions (status = 'translating' → 'definitions'):
   → For each of 12 native languages:
       → Google Translate: bulk translation
       → LLM batch: contextual definitions for ALL words in this video
       → INSERT INTO word_definitions (vocab_word_id, video_id, target_language, ...)
       → Every word gets a fresh contextual definition per video (meaning depends on sentence)

4. Link words to video:
   → INSERT INTO video_words (video_id, vocab_word_id, start_ms, end_ms, display_text, word_index)

5. Generate WebVTT → upload to R2

6. videos.status = 'ready', pipeline_jobs.status = 'ready'
```

---

## Row Count Projections (12 months)

| Table | Month 1 | Month 12 | Growth Driver |
|-------|---------|----------|---------------|
| users | ~100 | ~5,000 | MAU growth |
| videos | 100 | 1,200 | 100 seeded/month |
| vocab_words | ~5,000 | ~15,000 | Unique words across videos |
| word_definitions | ~60,000 | ~720,000 | ~50 words × 1,200 videos × 12 langs |
| video_words | ~5,000 | ~60,000 | ~50 words/video × 1,200 |
| flashcards | ~500 | ~50,000 | ~10 cards/user × 5K users |
| review_logs | ~2,000 | ~500,000 | ~100 reviews/user × 5K users |
| user_views | ~2,000 | ~100,000 | Users × videos watched |
| user_follows | ~500 | ~25,000 | ~5 follows/user |
| user_likes | ~200 | ~10,000 | ~2 likes/user |
| comments | ~50 | ~5,000 | ~1 comment/user |
| daily_progress | ~3,000 | ~150,000 | Users × active days |
| pipeline_jobs | 100 | 1,200 | 1 per video |

**Total DB size at 12 months: ~50-100 MB** (Supabase Pro limit: 8 GB)

---

## Not In Schema (Conscious Deferrals)

| Feature | Requirement | Decision |
|---------|-------------|----------|
| Direct messages | R9 | Base repo (kirkwat/tiktok) had DMs via Firebase. Needs `conversations` + `messages` tables if migrating to Supabase. **Defer to Phase 2** — DMs are not a core language learning feature. |
| Notifications | — | No `notifications` table. Using Supabase Realtime for ephemeral in-app notifications only. Persistent notification history deferred. |
| Multi-sense definitions | R28 | Handled: definitions are per-video, so the same word in different videos gets different contextual definitions automatically. |
| Flashcard decks | — | Single implicit deck per user. Deck management deferred to Phase 2. |
| Proficiency levels | — | CEFR/HSK/JLPT per-language proficiency. Deferred to Phase 1.5/2. Will need `user_proficiencies(user_id, language, system, level)` table. |
| Video sharing tracking | — | No `shares` column on videos. Add when analytics matter. |
| Comment reporting | — | No report/flag mechanism. Add when content moderation is needed (Phase 2). |
