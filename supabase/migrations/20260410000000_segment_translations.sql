-- Migration: segment_translations
-- Stores LLM-generated sentence-level translations for each video segment.
-- One row per (video, segment start time, target language).

CREATE TABLE segment_translations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id         UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    start_ms         INT NOT NULL,
    end_ms           INT NOT NULL,
    source_text      TEXT NOT NULL,
    target_language  TEXT NOT NULL,
    translation      TEXT NOT NULL,
    llm_provider     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(video_id, start_ms, target_language)
);

CREATE INDEX idx_seg_trans_video ON segment_translations(video_id, target_language);

ALTER TABLE segment_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY seg_trans_read ON segment_translations FOR SELECT USING (true);
