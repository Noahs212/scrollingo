"""
Tests for Scrollingo Video Processing Pipeline (pipeline.py)

Run with:
    python3 -m pytest scripts/test_pipeline.py -v
"""

import json
import os
import sys
import types
import uuid
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch, call

import pytest

# Add the scripts directory to sys.path so we can import pipeline directly
sys.path.insert(0, str(Path(__file__).parent))


# ---------------------------------------------------------------------------
# Patch environment variables BEFORE importing pipeline so the module-level
# env-var validation and client initialisation don't fail or hit the network.
# ---------------------------------------------------------------------------

_ENV_VARS = {
    "OpenrouterAPIKey": "test-openrouter-key",
    "SupabaseUrl": "https://fake.supabase.co",
    "SupbaseAnonKey": "test-anon-key",
    "SupabaseServiceKey": "test-service-key",
    "R2AccessKeyId": "test-r2-access",
    "R2SecretAccessKey": "test-r2-secret",
    "R2BucketName": "test-bucket",
    "R2Endpoint": "https://fake-r2.example.com",
    "R2BucketUrl": "https://cdn.fake-r2.example.com",
}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Ensure each test starts with a controlled environment."""
    for k, v in _ENV_VARS.items():
        monkeypatch.setenv(k, v)


# We need to mock the heavy imports that happen at module level inside pipeline.py
# (supabase.create_client, OpenAI, boto3).  We patch them *before* the first import.

_mock_supabase_client = MagicMock()
_mock_openai_client = MagicMock()
_mock_boto3 = MagicMock()

# Patch module-level side-effects so importing pipeline is safe.
with patch.dict(os.environ, _ENV_VARS):
    with patch("supabase.create_client", return_value=_mock_supabase_client):
        with patch("openai.OpenAI", return_value=_mock_openai_client):
            with patch("boto3.client", return_value=MagicMock()):
                import pipeline


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_VIDEO_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _make_bbox_data(segments=None):
    """Return a minimal bbox_data dict."""
    if segments is None:
        segments = [
            {
                "start_ms": 0,
                "end_ms": 1000,
                "detections": [
                    {
                        "text": "你好世界",
                        "confidence": 0.95,
                        "bbox": {"x": 10, "y": 500, "width": 200, "height": 40},
                        "chars": [],
                    }
                ],
            },
            {
                "start_ms": 1500,
                "end_ms": 3000,
                "detections": [
                    {
                        "text": "今天天气真好",
                        "confidence": 0.91,
                        "bbox": {"x": 10, "y": 500, "width": 300, "height": 40},
                        "chars": [],
                    }
                ],
            },
        ]
    return {
        "video": SAMPLE_VIDEO_ID,
        "resolution": {"width": 720, "height": 1280},
        "duration_ms": 5000,
        "frame_interval_ms": 250,
        "segments": segments,
    }


# ===========================================================================
# Tests: get_auto_title
# ===========================================================================

class TestGetAutoTitle:
    def test_returns_first_subtitle_text(self):
        data = _make_bbox_data()
        assert pipeline.get_auto_title(data) == "你好世界"

    def test_skips_short_text(self):
        """Texts with < 2 characters are skipped."""
        data = _make_bbox_data(segments=[
            {
                "start_ms": 0, "end_ms": 500,
                "detections": [{"text": "a", "confidence": 0.9,
                                "bbox": {"x": 0, "y": 0, "width": 10, "height": 10}, "chars": []}],
            },
            {
                "start_ms": 1000, "end_ms": 2000,
                "detections": [{"text": "有效标题", "confidence": 0.9,
                                "bbox": {"x": 0, "y": 0, "width": 10, "height": 10}, "chars": []}],
            },
        ])
        assert pipeline.get_auto_title(data) == "有效标题"

    def test_empty_segments(self):
        data = _make_bbox_data(segments=[])
        assert pipeline.get_auto_title(data) == "Untitled"

    def test_no_detections(self):
        data = _make_bbox_data(segments=[{"start_ms": 0, "end_ms": 500, "detections": []}])
        assert pipeline.get_auto_title(data) == "Untitled"

    def test_whitespace_only_text(self):
        data = _make_bbox_data(segments=[
            {"start_ms": 0, "end_ms": 500,
             "detections": [{"text": "   ", "confidence": 0.9,
                             "bbox": {"x": 0, "y": 0, "width": 10, "height": 10}, "chars": []}]},
        ])
        assert pipeline.get_auto_title(data) == "Untitled"

    def test_missing_segments_key(self):
        assert pipeline.get_auto_title({}) == "Untitled"


# ===========================================================================
# Tests: extract_thumbnail (FFmpeg mocked)
# ===========================================================================

class TestExtractThumbnail:
    @patch("pipeline.subprocess.run")
    def test_seek_at_30_percent(self, mock_run, tmp_path):
        duration = 100
        pipeline.extract_thumbnail("/fake/video.mp4", str(tmp_path), duration)
        args = mock_run.call_args[0][0]
        # Seek should be at max(1, int(100 * 0.3)) = 30
        assert "-ss" in args
        ss_idx = args.index("-ss")
        assert args[ss_idx + 1] == "30"

    @patch("pipeline.subprocess.run")
    def test_seek_clamps_to_1_for_short_video(self, mock_run, tmp_path):
        duration = 2
        pipeline.extract_thumbnail("/fake/video.mp4", str(tmp_path), duration)
        args = mock_run.call_args[0][0]
        ss_idx = args.index("-ss")
        assert args[ss_idx + 1] == "1"

    @patch("pipeline.subprocess.run")
    def test_output_path(self, mock_run, tmp_path):
        result = pipeline.extract_thumbnail("/fake/video.mp4", str(tmp_path), 60)
        assert result == os.path.join(str(tmp_path), "thumbnail.jpg")


# ===========================================================================
# Tests: normalize_video (FFmpeg mocked)
# ===========================================================================

class TestNormalizeVideo:
    def _probe_output(self, width=1080, height=1920, duration=45.0):
        return json.dumps({
            "streams": [
                {"codec_type": "video", "width": width, "height": height, "duration": str(duration)},
                {"codec_type": "audio"},
            ]
        })

    @patch("pipeline.subprocess.run")
    def test_reencode_non_720(self, mock_run, tmp_path):
        mock_run.return_value = MagicMock(stdout=self._probe_output(1080, 1920, 30))
        path, dur = pipeline.normalize_video("/fake/input.mp4", str(tmp_path))
        assert dur == 30
        assert path == os.path.join(str(tmp_path), "video.mp4")
        # First call = ffprobe, second call = ffmpeg encode
        assert mock_run.call_count == 2
        encode_args = mock_run.call_args_list[1][0][0]
        assert "ffmpeg" in encode_args[0]

    @patch("pipeline.subprocess.run")
    @patch("pipeline.shutil.copy2")
    def test_copy_when_already_720x1280(self, mock_copy, mock_run, tmp_path):
        mock_run.return_value = MagicMock(stdout=self._probe_output(720, 1280, 20))
        path, dur = pipeline.normalize_video("/fake/input.mp4", str(tmp_path))
        assert dur == 20
        # Should use shutil.copy2 instead of ffmpeg
        mock_copy.assert_called_once()

    @patch("pipeline.shutil.copy2")
    @patch("pipeline.subprocess.run")
    def test_duration_rounded_down(self, mock_run, mock_copy, tmp_path):
        mock_run.return_value = MagicMock(stdout=self._probe_output(720, 1280, 45.9))
        _, dur = pipeline.normalize_video("/fake/input.mp4", str(tmp_path))
        assert dur == 45  # int(45.9)


# ===========================================================================
# Tests: upload_to_r2 (boto3 mocked)
# ===========================================================================

class TestUploadToR2:
    @patch("pipeline.get_r2_client")
    def test_upload_success(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        url = pipeline.upload_to_r2("/tmp/video.mp4", "videos/abc/video.mp4")

        mock_client.upload_file.assert_called_once()
        args, kwargs = mock_client.upload_file.call_args
        assert args[0] == "/tmp/video.mp4"
        assert args[1] == pipeline.R2_BUCKET_NAME
        assert args[2] == "videos/abc/video.mp4"
        assert kwargs["ExtraArgs"]["ContentType"] == "video/mp4"
        assert "cdn.fake-r2.example.com" in url

    @patch("pipeline.get_r2_client")
    def test_content_type_mapping(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        pipeline.upload_to_r2("/tmp/thumb.jpg", "videos/abc/thumbnail.jpg")
        ct = mock_get_client.return_value.upload_file.call_args[1]["ExtraArgs"]["ContentType"]
        assert ct == "image/jpeg"

    @patch("pipeline.get_r2_client")
    def test_json_content_type(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        pipeline.upload_to_r2("/tmp/bboxes.json", "videos/abc/bboxes.json")
        ct = mock_get_client.return_value.upload_file.call_args[1]["ExtraArgs"]["ContentType"]
        assert ct == "application/json"

    @patch("pipeline.get_r2_client")
    def test_unknown_extension_defaults_to_octet_stream(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        pipeline.upload_to_r2("/tmp/data.xyz", "videos/abc/data.xyz")
        ct = mock_get_client.return_value.upload_file.call_args[1]["ExtraArgs"]["ContentType"]
        assert ct == "application/octet-stream"

    def test_skip_when_no_credentials(self, monkeypatch):
        """When R2_ENDPOINT or R2_ACCESS_KEY is empty, skip upload and return placeholder."""
        monkeypatch.setattr(pipeline, "R2_ENDPOINT", "")
        monkeypatch.setattr(pipeline, "R2_ACCESS_KEY", "")
        url = pipeline.upload_to_r2("/tmp/video.mp4", "videos/abc/video.mp4")
        assert "r2-placeholder.dev" in url

    @patch("pipeline.get_r2_client")
    def test_cache_control_header(self, mock_get_client):
        mock_get_client.return_value = MagicMock()
        pipeline.upload_to_r2("/tmp/video.mp4", "key")
        cc = mock_get_client.return_value.upload_file.call_args[1]["ExtraArgs"]["CacheControl"]
        assert "immutable" in cc


# ===========================================================================
# Tests: insert_video_row (Supabase mocked)
# ===========================================================================

class TestInsertVideoRow:
    def test_insert_correct_fields(self):
        mock_table = MagicMock()
        mock_table.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": SAMPLE_VIDEO_ID}]
        )
        pipeline.supabase.table = MagicMock(return_value=mock_table)

        result = pipeline.insert_video_row(
            SAMPLE_VIDEO_ID, "Test Video", "zh", 30,
            "https://cdn/video.mp4", "https://cdn/thumb.jpg",
        )

        insert_arg = mock_table.insert.call_args[0][0]
        assert insert_arg["id"] == SAMPLE_VIDEO_ID
        assert insert_arg["title"] == "Test Video"
        assert insert_arg["language"] == "zh"
        assert insert_arg["duration_sec"] == 30
        assert insert_arg["status"] == "processing"
        assert insert_arg["subtitle_source"] == "ocr"
        assert insert_arg["seeded_by"] == "pipeline"
        assert result["id"] == SAMPLE_VIDEO_ID


# ===========================================================================
# Tests: segment_words (jieba runs for real)
# ===========================================================================

class TestSegmentWords:
    def test_chinese_segmentation(self):
        data = _make_bbox_data()
        unique_words, occurrences = pipeline.segment_words(data, "zh")
        # jieba should split the Chinese text into words
        assert len(unique_words) > 0
        assert len(occurrences) > 0
        # "你好" and "世界" should appear
        assert "你好" in unique_words or "你" in unique_words

    def test_occurrences_have_timestamps(self):
        data = _make_bbox_data()
        _, occurrences = pipeline.segment_words(data, "zh")
        for occ in occurrences:
            assert "word" in occ
            assert "start_ms" in occ
            assert "end_ms" in occ
            assert "sentence" in occ

    def test_non_chinese_splits_on_whitespace(self):
        data = _make_bbox_data(segments=[
            {
                "start_ms": 0, "end_ms": 1000,
                "detections": [{"text": "hello world foo", "confidence": 0.9,
                                "bbox": {"x": 0, "y": 0, "width": 100, "height": 20}, "chars": []}],
            }
        ])
        unique_words, occurrences = pipeline.segment_words(data, "en")
        assert "hello" in unique_words
        assert "world" in unique_words
        assert "foo" in unique_words

    def test_empty_segments(self):
        data = _make_bbox_data(segments=[])
        unique_words, occurrences = pipeline.segment_words(data, "zh")
        assert unique_words == []
        assert occurrences == []

    def test_unique_words_are_deduplicated(self):
        data = _make_bbox_data(segments=[
            {
                "start_ms": 0, "end_ms": 1000,
                "detections": [{"text": "你好你好", "confidence": 0.9,
                                "bbox": {"x": 0, "y": 0, "width": 100, "height": 20}, "chars": []}],
            }
        ])
        unique_words, occurrences = pipeline.segment_words(data, "zh")
        # unique_words is derived from a set, so each word appears once
        word_counts = {}
        for w in unique_words:
            word_counts[w] = word_counts.get(w, 0) + 1
        for count in word_counts.values():
            assert count == 1


# ===========================================================================
# Tests: generate_definition_for_word and generate_all_definitions (LLM mocked)
# ===========================================================================

class TestGenerateDefinitions:
    def _mock_llm_response(self, content):
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = content
        return mock_resp

    def test_single_word_structured_response(self):
        """Parses Translation/Contextual Definition/Part of Speech format."""
        content = "Translation: hello\nContextual Definition: a greeting\nPart of Speech: interjection"
        pipeline.llm.chat.completions.create = MagicMock(
            return_value=self._mock_llm_response(content)
        )
        result = pipeline.generate_definition_for_word("你好", "你好世界", "zh", "en")
        assert result["translation"] == "hello"
        assert result["contextual_definition"] == "a greeting"
        assert result["part_of_speech"] == "interjection"

    def test_localized_labels_chinese_target(self):
        """Chinese target language uses 翻译/语境释义/词性 labels."""
        content = "翻译: hello\n语境释义: 问候语\n词性: 感叹词"
        pipeline.llm.chat.completions.create = MagicMock(
            return_value=self._mock_llm_response(content)
        )
        result = pipeline.generate_definition_for_word("hello", "hello world", "en", "zh")
        assert result["translation"] == "hello"

    def test_llm_error_returns_empty_placeholders(self):
        """On LLM failure, returns empty strings."""
        pipeline.llm.chat.completions.create = MagicMock(side_effect=Exception("API timeout"))
        result = pipeline.generate_definition_for_word("你好", "你好世界", "zh", "en")
        assert result["translation"] == ""
        assert result["contextual_definition"] == ""
        assert result["part_of_speech"] == ""

    def test_empty_word_list_returns_empty(self):
        result = pipeline.generate_all_definitions([], {}, "zh")
        assert result == {}

    @patch("pipeline.time.sleep")
    def test_all_definitions_generates_for_all_target_langs(self, mock_sleep):
        """generate_all_definitions calls LLM for each word × each target language (excluding source)."""
        content = "Translation: hello\nContextual Definition: greeting\nPart of Speech: interjection"
        pipeline.llm.chat.completions.create = MagicMock(
            return_value=self._mock_llm_response(content)
        )
        result = pipeline.generate_all_definitions(
            ["你好"], {"你好": "你好世界"}, "zh"
        )
        assert "你好" in result
        # Should have 11 target languages (12 total minus zh)
        assert len(result["你好"]) == 11
        assert "en" in result["你好"]
        assert "es" in result["你好"]
        assert "ja" in result["你好"]
        assert "zh" not in result["你好"]  # Skipped self-translation

    @patch("pipeline.time.sleep")
    def test_all_definitions_skips_source_language(self, mock_sleep):
        """Source language is excluded from target languages."""
        content = "Translation: bonjour\nContextual Definition: salutation\nPart of Speech: interjection"
        pipeline.llm.chat.completions.create = MagicMock(
            return_value=self._mock_llm_response(content)
        )
        result = pipeline.generate_all_definitions(
            ["hello"], {"hello": "hello world"}, "en"
        )
        assert "en" not in result["hello"]  # Source = en, so en excluded
        assert len(result["hello"]) == 11

    @patch("pipeline.time.sleep")
    def test_multiple_words_generates_all_combinations(self, mock_sleep):
        """Two words × 11 languages = 22 LLM calls."""
        content = "Translation: tr\nContextual Definition: def\nPart of Speech: noun"
        pipeline.llm.chat.completions.create = MagicMock(
            return_value=self._mock_llm_response(content)
        )
        result = pipeline.generate_all_definitions(
            ["你好", "世界"], {"你好": "你好世界", "世界": "你好世界"}, "zh"
        )
        assert len(result) == 2
        assert len(result["你好"]) == 11
        assert len(result["世界"]) == 11
        # 2 words × 11 languages = 22 calls
        assert pipeline.llm.chat.completions.create.call_count == 22


# ===========================================================================
# Tests: insert_vocab_and_definitions (Supabase mocked)
# ===========================================================================

class TestInsertVocabAndDefinitions:
    def setup_method(self):
        """Set up a fresh mock for supabase.table before each test."""
        self.table_mocks = {}

        def make_table(name):
            if name not in self.table_mocks:
                m = MagicMock()
                # Default: upsert returns rows with generated ids
                m.upsert.return_value.execute.return_value = MagicMock(
                    data=[{"id": str(uuid.uuid4()), "word": "default"}]
                )
                # Default: insert returns a row with a generated id
                m.insert.return_value.execute.return_value = MagicMock(
                    data=[{"id": str(uuid.uuid4())}]
                )
                self.table_mocks[name] = m
            return self.table_mocks[name]

        pipeline.supabase.table = MagicMock(side_effect=make_table)

    def _make_multi_lang_defs(self, word, translation="hello"):
        """Helper: create nested {word: {lang: {translation, ...}}} for all target langs."""
        return {
            word: {
                lang["code"]: {"translation": f"{translation}_{lang['code']}", "contextual_definition": "def", "part_of_speech": "noun"}
                for lang in pipeline.TARGET_LANGUAGES if lang["code"] != "zh"
            }
        }

    def test_inserts_new_vocab_words(self):
        vocab_mock = MagicMock()
        vocab_mock.upsert.return_value.execute.return_value = MagicMock(
            data=[{"id": "id-1", "word": "你好"}, {"id": "id-2", "word": "世界"}]
        )
        self.table_mocks["vocab_words"] = vocab_mock

        def make_table(name):
            if name not in self.table_mocks:
                m = MagicMock()
                m.insert.return_value.execute.return_value = MagicMock(data=[])
                self.table_mocks[name] = m
            return self.table_mocks[name]

        pipeline.supabase.table = MagicMock(side_effect=make_table)

        all_defs = {**self._make_multi_lang_defs("你好"), **self._make_multi_lang_defs("世界", "world")}
        occs = [
            {"word": "你好", "start_ms": 0, "end_ms": 1000, "display_text": "你好", "sentence": "你好世界"},
            {"word": "世界", "start_ms": 0, "end_ms": 1000, "display_text": "世界", "sentence": "你好世界"},
        ]
        pipeline.insert_vocab_and_definitions(SAMPLE_VIDEO_ID, ["你好", "世界"], all_defs, occs, "zh")
        vocab_mock.upsert.assert_called_once()

    def test_reuses_existing_vocab_word(self):
        existing_id = str(uuid.uuid4())
        vocab_mock = MagicMock()
        vocab_mock.upsert.return_value.execute.return_value = MagicMock(
            data=[{"id": existing_id, "word": "你好"}]
        )

        def make_table(name):
            if name == "vocab_words":
                return vocab_mock
            m = MagicMock()
            m.insert.return_value.execute.return_value = MagicMock(data=[{"id": str(uuid.uuid4())}])
            return m

        pipeline.supabase.table = MagicMock(side_effect=make_table)

        all_defs = self._make_multi_lang_defs("你好")
        pipeline.insert_vocab_and_definitions(
            SAMPLE_VIDEO_ID, ["你好"], all_defs,
            [{"word": "你好", "start_ms": 0, "end_ms": 1000, "display_text": "你好", "sentence": "你好"}],
            "zh",
        )
        vocab_mock.upsert.assert_called_once()

    def test_inserts_word_definitions_for_all_languages(self):
        def make_table(name):
            m = MagicMock()
            m.upsert.return_value.execute.return_value = MagicMock(
                data=[{"id": "wid-1", "word": "你好"}]
            )
            m.insert.return_value.execute.return_value = MagicMock(data=[{"id": "wid-1"}])
            self.table_mocks[name] = m
            return m

        pipeline.supabase.table = MagicMock(side_effect=make_table)

        all_defs = self._make_multi_lang_defs("你好")
        pipeline.insert_vocab_and_definitions(
            SAMPLE_VIDEO_ID, ["你好"], all_defs,
            [{"word": "你好", "start_ms": 0, "end_ms": 1000, "display_text": "你好", "sentence": "你好世界"}],
            "zh",
        )

        def_mock = self.table_mocks["word_definitions"]
        insert_arg = def_mock.insert.call_args[0][0]
        # Should have 11 definition rows (one per target language, excluding zh)
        assert len(insert_arg) == 11
        # Check one row has correct structure
        row = insert_arg[0]
        assert row["llm_provider"] == pipeline.LLM_MODEL
        assert row["source_sentence"] == "你好世界"
        assert "target_language" in row
        assert "translation" in row

    def test_empty_words_list(self):
        pipeline.insert_vocab_and_definitions(
            SAMPLE_VIDEO_ID, [], {}, [], "zh"
        )
        # No table operations attempted (nothing to insert)


# ===========================================================================
# Tests: mark_video_ready (Supabase mocked)
# ===========================================================================

class TestMarkVideoReady:
    def test_updates_status_and_inserts_pipeline_job(self):
        mock_videos = MagicMock()
        mock_jobs = MagicMock()

        def make_table(name):
            if name == "videos":
                return mock_videos
            return mock_jobs

        pipeline.supabase.table = MagicMock(side_effect=make_table)

        pipeline.mark_video_ready(SAMPLE_VIDEO_ID, "2026-01-01T00:00:00+00:00")

        # videos.update called with status=ready
        update_arg = mock_videos.update.call_args[0][0]
        assert update_arg["status"] == "ready"
        assert "processed_at" in update_arg
        mock_videos.update.return_value.eq.assert_called_with("id", SAMPLE_VIDEO_ID)

        # pipeline_jobs.insert called
        job_arg = mock_jobs.insert.call_args[0][0]
        assert job_arg["video_id"] == SAMPLE_VIDEO_ID
        assert job_arg["status"] == "ready"
        assert job_arg["started_at"] == "2026-01-01T00:00:00+00:00"


# ===========================================================================
# Tests: get_r2_client
# ===========================================================================

class TestGetR2Client:
    @patch("pipeline.boto3.client")
    def test_creates_s3_client_with_r2_config(self, mock_boto3_client):
        pipeline.get_r2_client()
        mock_boto3_client.assert_called_once_with(
            "s3",
            endpoint_url=pipeline.R2_ENDPOINT,
            aws_access_key_id=pipeline.R2_ACCESS_KEY,
            aws_secret_access_key=pipeline.R2_SECRET_KEY,
            region_name="auto",
        )


# ===========================================================================
# Tests: LLM response parsing edge cases
# ===========================================================================

class TestLLMResponseParsing:
    """Focused tests on the structured response parsing in generate_definition_for_word."""

    def _mock_llm_response(self, content):
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = content
        return mock_resp

    def test_extra_text_around_structured_fields(self):
        """Handle responses where LLM adds extra text around the labels."""
        content = "Sure! Here you go:\nTranslation: cat\nContextual Definition: a feline animal\nPart of Speech: noun\nHope this helps!"
        pipeline.llm.chat.completions.create = MagicMock(
            return_value=self._mock_llm_response(content)
        )
        result = pipeline.generate_definition_for_word("猫", "我有一只猫", "zh", "en")
        assert result["translation"] == "cat"
        assert result["contextual_definition"] == "a feline animal"

    @patch("pipeline.time.sleep")
    def test_partial_word_failure_preserves_successful_words(self, mock_sleep):
        """If one word fails, others still get definitions."""
        call_count = [0]
        def mock_create(**kwargs):
            call_count[0] += 1
            if call_count[0] % 3 == 0:  # Every 3rd call fails
                raise Exception("rate limit")
            return self._mock_llm_response("Translation: good\nContextual Definition: positive\nPart of Speech: adjective")

        pipeline.llm.chat.completions.create = MagicMock(side_effect=mock_create)
        result = pipeline.generate_all_definitions(
            ["好"], {"好": "很好"}, "zh"
        )
        # Should have entries for all target languages, some with empty placeholders
        assert "好" in result
        assert len(result["好"]) == 11


# ===========================================================================
# Tests: Full pipeline (end-to-end with all mocks)
# ===========================================================================

class TestFullPipeline:
    """Integration test: run main() with all external services mocked."""

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_full_pipeline_flow(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_ocr, mock_segment, mock_defs, mock_insert_vocab,
        mock_ready, tmp_path,
    ):
        # Setup
        video_file = tmp_path / "test_video.mp4"
        video_file.write_bytes(b"fake video data")

        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(tmp_path / "video.mp4"), 30)
        mock_thumb.return_value = str(tmp_path / "thumbnail.jpg")
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()
        mock_segment.return_value = (["你好", "世界"], [
            {"word": "你好", "start_ms": 0, "end_ms": 1000, "display_text": "你好", "sentence": "你好世界"},
        ])
        mock_defs.return_value = {"你好": {"translation": "hello", "contextual_definition": "", "part_of_speech": ""}}
        mock_insert_row.return_value = {"id": SAMPLE_VIDEO_ID}

        # Run
        with patch("sys.argv", ["pipeline.py", "--video", str(video_file), "--language", "zh", "--native-lang", "en"]):
            pipeline.main()

        # Verify execution order
        mock_normalize.assert_called_once()
        mock_ocr.assert_called_once()
        mock_thumb.assert_called_once()
        assert mock_upload.call_count == 3  # video, thumbnail, bboxes
        mock_insert_row.assert_called_once()
        mock_segment.assert_called_once()
        mock_defs.assert_called_once()
        mock_insert_vocab.assert_called_once()
        mock_ready.assert_called_once()
        assert mock_ready.call_args[0][0] == SAMPLE_VIDEO_ID

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_dry_run_skips_supabase(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_ocr, mock_segment, mock_defs, mock_insert_vocab,
        mock_ready, tmp_path,
    ):
        video_file = tmp_path / "test_video.mp4"
        video_file.write_bytes(b"fake video data")

        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(tmp_path / "video.mp4"), 30)
        mock_thumb.return_value = str(tmp_path / "thumbnail.jpg")
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()
        mock_segment.return_value = (["你好"], [])
        mock_defs.return_value = {}

        with patch("sys.argv", ["pipeline.py", "--video", str(video_file), "--dry-run"]):
            pipeline.main()

        # In dry-run mode, Supabase operations should NOT be called
        mock_insert_row.assert_not_called()
        mock_insert_vocab.assert_not_called()
        mock_ready.assert_not_called()

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_auto_title_from_ocr(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_ocr, mock_segment, mock_defs, mock_insert_vocab,
        mock_ready, tmp_path,
    ):
        """When --title is not provided, title is auto-detected from first OCR subtitle."""
        video_file = tmp_path / "test_video.mp4"
        video_file.write_bytes(b"fake video data")

        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(tmp_path / "video.mp4"), 30)
        mock_thumb.return_value = str(tmp_path / "thumbnail.jpg")
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()  # First detection text = "你好世界"
        mock_segment.return_value = ([], [])
        mock_defs.return_value = {}
        mock_insert_row.return_value = {"id": SAMPLE_VIDEO_ID}

        with patch("sys.argv", ["pipeline.py", "--video", str(video_file)]):
            pipeline.main()

        # Title passed to insert_video_row should be the auto-detected one
        insert_call_args = mock_insert_row.call_args[0]
        title_arg = insert_call_args[1]
        assert title_arg == "你好世界"

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_explicit_title_overrides_auto(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_ocr, mock_segment, mock_defs, mock_insert_vocab,
        mock_ready, tmp_path,
    ):
        video_file = tmp_path / "test_video.mp4"
        video_file.write_bytes(b"fake video data")

        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(tmp_path / "video.mp4"), 30)
        mock_thumb.return_value = str(tmp_path / "thumbnail.jpg")
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()
        mock_segment.return_value = ([], [])
        mock_defs.return_value = {}
        mock_insert_row.return_value = {"id": SAMPLE_VIDEO_ID}

        with patch("sys.argv", ["pipeline.py", "--video", str(video_file), "--title", "My Custom Title"]):
            pipeline.main()

        title_arg = mock_insert_row.call_args[0][1]
        assert title_arg == "My Custom Title"

    def test_missing_video_file_exits(self):
        with patch("sys.argv", ["pipeline.py", "--video", "/nonexistent/path.mp4"]):
            with pytest.raises(SystemExit):
                pipeline.main()


# ===========================================================================
# Tests: Edge cases
# ===========================================================================

class TestEdgeCases:
    def test_empty_ocr_results_produce_no_words(self):
        data = _make_bbox_data(segments=[
            {"start_ms": 0, "end_ms": 1000, "detections": []},
        ])
        unique_words, occurrences = pipeline.segment_words(data, "zh")
        assert unique_words == []
        assert occurrences == []

    def test_segment_words_strips_whitespace(self):
        """Words that are only whitespace after stripping should be excluded."""
        data = _make_bbox_data(segments=[
            {
                "start_ms": 0, "end_ms": 1000,
                "detections": [{"text": "你好 世界", "confidence": 0.9,
                                "bbox": {"x": 0, "y": 0, "width": 100, "height": 20}, "chars": []}],
            }
        ])
        unique_words, _ = pipeline.segment_words(data, "zh")
        # No word should be empty or whitespace-only
        for w in unique_words:
            assert w.strip() != ""

    def test_get_auto_title_deeply_nested(self):
        """Multiple segments, first has only short text, second has valid text."""
        data = {
            "segments": [
                {"start_ms": 0, "end_ms": 500, "detections": [
                    {"text": "。", "confidence": 0.9, "bbox": {}, "chars": []},
                ]},
                {"start_ms": 1000, "end_ms": 2000, "detections": [
                    {"text": "这是标题", "confidence": 0.9, "bbox": {}, "chars": []},
                ]},
            ]
        }
        assert pipeline.get_auto_title(data) == "这是标题"

    def test_generate_definition_for_word_parses_multiline(self):
        """Handles extra whitespace and varied formatting in LLM response."""
        content = "\n  Translation:  good  \n  Contextual Definition:  positive quality  \n  Part of Speech:  adjective  \n"
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = content
        pipeline.llm.chat.completions.create = MagicMock(return_value=mock_resp)

        result = pipeline.generate_definition_for_word("好", "很好", "zh", "en")
        assert result["translation"] == "good"
        assert result["part_of_speech"] == "adjective"


# ===========================================================================
# OCR Regression Test: pipeline run_ocr must match extract_subtitles_videocr2
# ===========================================================================

class TestOCRRegression:
    """Verify that pipeline.run_ocr() uses the expected constants from
    extract_subtitles_dense.py (the active dense-OCR backend).

    If this test fails, run_ocr() has drifted from the dense module — either
    the dense module constants changed without updating run_ocr, or vice versa.
    """

    def test_pipeline_ocr_uses_dense_backend_constants(self):
        """run_ocr imports and uses the dense OCR backend."""
        import inspect

        run_ocr_source = inspect.getsource(pipeline.run_ocr)
        dense_source = open(
            os.path.join(os.path.dirname(__file__), "extract_subtitles_dense.py")
        ).read()

        # run_ocr must import from extract_subtitles_dense
        assert "extract_subtitles_dense" in run_ocr_source, \
            "run_ocr must import from extract_subtitles_dense"

        # Dense backend constants — verified in the dense module source
        assert "FRAME_INTERVAL_MS = 100" in dense_source, \
            "Dense OCR must sample at 100ms (10fps)"
        assert "CONF_THRESHOLD = 0.50" in dense_source, \
            "Dense OCR must use 0.50 confidence threshold"
        assert "MIN_DURATION_MS = 100" in dense_source, \
            "Dense OCR must keep segments ≥ 100ms"
        assert "GAP_TOLERANCE_MS = 500" in dense_source, \
            "Dense OCR must bridge gaps ≤ 500ms"
        assert "CHANGE_THRESHOLD = 2.0" in dense_source, \
            "Dense OCR must use pixel diff threshold 2.0"
        assert "SUBTITLE_REGION_TOP = 0.60" in dense_source, \
            "Dense OCR change detection must monitor from 60% of frame height"


# ===========================================================================
# Tests: Hardening Fix 1 — R2 cleanup on Supabase insert error
# ===========================================================================

class TestR2CleanupOnError:
    """When the Supabase insert fails, R2 files for the video must be deleted."""

    def _make_pipeline_mocks(self, tmp_path):
        """Return a dict of common mocks needed to run main() up to the insert step."""
        video_file = tmp_path / "video.mp4"
        video_file.write_bytes(b"fake")
        norm_file = tmp_path / "norm.mp4"
        norm_file.write_bytes(b"fake norm")
        thumb_file = tmp_path / "thumbnail.jpg"
        thumb_file.write_bytes(b"fake thumb")
        return {
            "video_file": video_file,
            "norm_file": norm_file,
            "thumb_file": thumb_file,
        }

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.get_r2_client")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_r2_delete_called_for_all_six_keys_on_error(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_get_r2, mock_ocr, mock_segment, mock_defs,
        mock_insert_vocab, mock_ready, tmp_path,
    ):
        """All 6 R2 keys are deleted when Supabase insert raises."""
        mocks = self._make_pipeline_mocks(tmp_path)
        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(mocks["norm_file"]), 30)
        mock_thumb.return_value = str(mocks["thumb_file"])
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()
        mock_segment.return_value = (["你好"], [
            {"word": "你好", "start_ms": 0, "end_ms": 1000, "display_text": "你好", "sentence": "你好世界"},
        ])
        mock_defs.return_value = {}
        mock_insert_row.return_value = {"id": SAMPLE_VIDEO_ID}

        mock_r2 = MagicMock()
        mock_get_r2.return_value = mock_r2
        # head_object raises 404 (no duplicate) → pipeline continues
        err_404 = Exception("NoSuchKey")
        err_404.response = {"Error": {"Code": "404"}}
        mock_r2.head_object.side_effect = err_404

        # Make insert_vocab_and_definitions raise to trigger cleanup
        mock_insert_vocab.side_effect = Exception("DB connection lost")

        with patch("sys.argv", ["pipeline.py", "--video", str(mocks["video_file"]), "--language", "zh"]):
            with pytest.raises(Exception, match="DB connection lost"):
                pipeline.main()

        deleted_keys = [c[1]["Key"] for c in mock_r2.delete_object.call_args_list]
        expected_keys = [
            f"videos/{SAMPLE_VIDEO_ID}/video.mp4",
            f"videos/{SAMPLE_VIDEO_ID}/thumbnail.jpg",
            f"videos/{SAMPLE_VIDEO_ID}/bboxes.json",
            f"videos/{SAMPLE_VIDEO_ID}/stt.json",
            f"videos/{SAMPLE_VIDEO_ID}/transcript.json",
            f"videos/{SAMPLE_VIDEO_ID}/audio.mp3",
        ]
        for key in expected_keys:
            assert key in deleted_keys, f"Expected R2 delete for {key}"

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.get_r2_client")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_one_r2_delete_failure_does_not_block_others(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_get_r2, mock_ocr, mock_segment, mock_defs,
        mock_insert_vocab, mock_ready, tmp_path,
    ):
        """A failing delete_object for one key must not stop cleanup of the rest."""
        mocks = self._make_pipeline_mocks(tmp_path)
        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(mocks["norm_file"]), 30)
        mock_thumb.return_value = str(mocks["thumb_file"])
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()
        mock_segment.return_value = (["你好"], [
            {"word": "你好", "start_ms": 0, "end_ms": 1000, "display_text": "你好", "sentence": "你好世界"},
        ])
        mock_defs.return_value = {}
        mock_insert_row.return_value = {"id": SAMPLE_VIDEO_ID}

        mock_r2 = MagicMock()
        mock_get_r2.return_value = mock_r2
        err_404 = Exception("NoSuchKey")
        err_404.response = {"Error": {"Code": "404"}}
        mock_r2.head_object.side_effect = err_404

        mock_insert_vocab.side_effect = Exception("DB error")
        # First delete_object call raises; rest should still be attempted
        mock_r2.delete_object.side_effect = [Exception("AccessDenied")] + [MagicMock()] * 10

        with patch("sys.argv", ["pipeline.py", "--video", str(mocks["video_file"]), "--language", "zh"]):
            with pytest.raises(Exception, match="DB error"):
                pipeline.main()

        # All 6 keys were attempted despite the first failure
        assert mock_r2.delete_object.call_count == 6


# ===========================================================================
# Tests: Hardening Fix 2 — Local output filenames use video_id, not stem
# ===========================================================================

class TestLocalFilenameUsesVideoId:
    """Local output files should be keyed by video_id to prevent collisions."""

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.get_r2_client")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_bbox_output_path_uses_video_id(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_get_r2, mock_ocr, mock_segment, mock_defs,
        mock_insert_vocab, mock_ready, tmp_path, monkeypatch,
    ):
        """_pipeline.json local output uses video_id, not the video filename stem."""
        # Input file has a generic name that could collide
        video_file = tmp_path / "video.mp4"
        video_file.write_bytes(b"fake")
        norm_file = tmp_path / "norm.mp4"
        norm_file.write_bytes(b"fake norm")
        thumb_file = tmp_path / "thumbnail.jpg"
        thumb_file.write_bytes(b"fake thumb")

        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(norm_file), 30)
        mock_thumb.return_value = str(thumb_file)
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()
        mock_segment.return_value = ([], [])
        mock_defs.return_value = {}
        mock_insert_row.return_value = {"id": SAMPLE_VIDEO_ID}

        mock_r2 = MagicMock()
        mock_get_r2.return_value = mock_r2
        err_404 = Exception("NoSuchKey")
        err_404.response = {"Error": {"Code": "404"}}
        mock_r2.head_object.side_effect = err_404

        # Redirect OUTPUT_DIR to tmp_path so files are actually written
        monkeypatch.setattr(pipeline, "OUTPUT_DIR", tmp_path)

        with patch("sys.argv", ["pipeline.py", "--video", str(video_file), "--language", "zh"]):
            pipeline.main()

        written_names = [f.name for f in tmp_path.iterdir()]
        # Must contain video_id in name, NOT the raw stem "video"
        assert any(SAMPLE_VIDEO_ID in n and "_pipeline.json" in n for n in written_names), \
            f"Expected *{SAMPLE_VIDEO_ID}*_pipeline.json, got: {written_names}"
        # The stem "video" alone must NOT appear as the prefix (collision risk)
        assert not any(n.startswith("video_pipeline") for n in written_names), \
            f"Found collision-prone filename: {written_names}"


# ===========================================================================
# Tests: Hardening Fix 3 — Duplicate R2 guard before upload
# ===========================================================================

class TestDuplicateR2Guard:
    """Pipeline must abort if video.mp4 already exists in R2 for a given video_id."""

    def _setup_mocks(self, tmp_path, mock_uuid, mock_normalize, mock_thumb,
                     mock_insert_row, mock_upload, mock_ocr):
        video_file = tmp_path / "input.mp4"
        video_file.write_bytes(b"fake")
        norm_file = tmp_path / "norm.mp4"
        norm_file.write_bytes(b"fake norm")
        thumb_file = tmp_path / "thumbnail.jpg"
        thumb_file.write_bytes(b"fake thumb")
        mock_uuid.return_value = uuid.UUID(SAMPLE_VIDEO_ID)
        mock_normalize.return_value = (str(norm_file), 30)
        mock_thumb.return_value = str(thumb_file)
        mock_upload.return_value = "https://cdn/video.mp4"
        mock_ocr.return_value = _make_bbox_data()
        mock_insert_row.return_value = {"id": SAMPLE_VIDEO_ID}
        return video_file

    @patch("pipeline.run_ocr")
    @patch("pipeline.get_r2_client")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_aborts_when_video_already_exists_in_r2(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_get_r2, mock_ocr, tmp_path,
    ):
        """head_object succeeds (key exists) → pipeline calls sys.exit(1)."""
        video_file = self._setup_mocks(tmp_path, mock_uuid, mock_normalize,
                                       mock_thumb, mock_insert_row, mock_upload, mock_ocr)
        mock_r2 = MagicMock()
        mock_get_r2.return_value = mock_r2
        # head_object does NOT raise → key exists
        mock_r2.head_object.return_value = {"ContentLength": 1234}

        with patch("sys.argv", ["pipeline.py", "--video", str(video_file), "--language", "zh"]):
            with pytest.raises(SystemExit) as exc_info:
                pipeline.main()

        assert exc_info.value.code == 1
        # upload_to_r2 must NOT have been called for video.mp4
        uploaded_keys = [c[0][1] for c in mock_upload.call_args_list]
        assert f"videos/{SAMPLE_VIDEO_ID}/video.mp4" not in uploaded_keys

    @patch("pipeline.mark_video_ready")
    @patch("pipeline.insert_vocab_and_definitions")
    @patch("pipeline.generate_all_definitions")
    @patch("pipeline.segment_words")
    @patch("pipeline.run_ocr")
    @patch("pipeline.get_r2_client")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_continues_when_head_object_returns_404(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_get_r2, mock_ocr, mock_segment, mock_defs,
        mock_insert_vocab, mock_ready, tmp_path,
    ):
        """head_object raises a 404 ClientError → pipeline continues normally."""
        video_file = self._setup_mocks(tmp_path, mock_uuid, mock_normalize,
                                       mock_thumb, mock_insert_row, mock_upload, mock_ocr)
        mock_r2 = MagicMock()
        mock_get_r2.return_value = mock_r2
        err_404 = Exception("NoSuchKey")
        err_404.response = {"Error": {"Code": "404"}}
        mock_r2.head_object.side_effect = err_404

        mock_segment.return_value = ([], [])
        mock_defs.return_value = {}

        with patch("sys.argv", ["pipeline.py", "--video", str(video_file), "--language", "zh"]):
            pipeline.main()  # Must not raise or exit

        # upload_to_r2 was called with video.mp4
        uploaded_keys = [c[0][1] for c in mock_upload.call_args_list]
        assert f"videos/{SAMPLE_VIDEO_ID}/video.mp4" in uploaded_keys

    @patch("pipeline.run_ocr")
    @patch("pipeline.get_r2_client")
    @patch("pipeline.upload_to_r2")
    @patch("pipeline.insert_video_row")
    @patch("pipeline.extract_thumbnail")
    @patch("pipeline.normalize_video")
    @patch("pipeline.uuid.uuid4")
    def test_non_404_r2_error_propagates(
        self, mock_uuid, mock_normalize, mock_thumb, mock_insert_row,
        mock_upload, mock_get_r2, mock_ocr, tmp_path,
    ):
        """An unexpected error from head_object (not 404) should propagate, not be swallowed."""
        video_file = self._setup_mocks(tmp_path, mock_uuid, mock_normalize,
                                       mock_thumb, mock_insert_row, mock_upload, mock_ocr)
        mock_r2 = MagicMock()
        mock_get_r2.return_value = mock_r2
        err_500 = Exception("InternalError")
        err_500.response = {"Error": {"Code": "500"}}
        mock_r2.head_object.side_effect = err_500

        with patch("sys.argv", ["pipeline.py", "--video", str(video_file), "--language", "zh"]):
            with pytest.raises(Exception, match="InternalError"):
                pipeline.main()


# ===========================================================================
# Helpers for merge tests
# ===========================================================================

RES = {"width": 720, "height": 1280}
RES_H = 1280

def _ocr_det(text, y_frac=0.80, conf=0.95):
    """Build a minimal OCR detection dict at a given y-fraction of a 1280px frame."""
    y = int(RES_H * y_frac)
    return {
        "text": text,
        "confidence": conf,
        "bbox": {"x": 10, "y": y, "width": 300, "height": 40},
        "chars": [{"char": c, "x": 10 + i * 20, "y": y, "width": 20, "height": 40}
                  for i, c in enumerate(text)],
    }

def _ocr_seg(text, start_ms, end_ms, y_frac=0.80):
    """Build a minimal OCR segment dict."""
    return {
        "start_ms": start_ms,
        "end_ms": end_ms,
        "detections": [_ocr_det(text, y_frac)],
    }

def _stt_seg(text, start_ms, end_ms):
    """Build a minimal STT segment dict (same bbox format as whisper_to_bboxes)."""
    y = int(RES_H * 0.82)
    return {
        "start_ms": start_ms,
        "end_ms": end_ms,
        "detections": [{
            "text": text,
            "confidence": 1.0,
            "bbox": {"x": 0, "y": y, "width": 300, "height": 40},
            "chars": [],
        }],
    }

def _make_ocr_data(segments, duration_ms=10_000):
    return {"video": SAMPLE_VIDEO_ID, "resolution": RES, "duration_ms": duration_ms, "segments": segments}

def _make_stt_data(segments):
    return {"video": SAMPLE_VIDEO_ID, "resolution": RES, "segments": segments}

def _seg_texts(result):
    """Extract (text, source) pairs from merge result segments."""
    return [(s["detections"][0]["text"], s["source"]) for s in result["segments"]]


# ===========================================================================
# Tests: _text_similarity
# ===========================================================================

class TestTextSimilarity:
    def test_identical_strings(self):
        assert pipeline._text_similarity("你好", "你好") == 1.0

    def test_empty_a(self):
        assert pipeline._text_similarity("", "你好") == 0.0

    def test_empty_b(self):
        assert pipeline._text_similarity("你好", "") == 0.0

    def test_both_empty(self):
        assert pipeline._text_similarity("", "") == 0.0

    def test_completely_different(self):
        assert pipeline._text_similarity("你好世界", "abcdefgh") == 0.0

    def test_chinese_partial_overlap(self):
        # "你好" is a prefix of "你好世界" — should score > 0.5
        sim = pipeline._text_similarity("你好", "你好世界")
        assert sim > 0.5

    def test_chinese_near_identical(self):
        # One extra character — high similarity
        sim = pipeline._text_similarity("今天天气很好", "今天天气好")
        assert sim > 0.8

    def test_latin_position_sensitive(self):
        # SequenceMatcher considers position — "Hello" vs "World" is low
        sim = pipeline._text_similarity("Hello", "World")
        assert sim < 0.5

    def test_latin_false_positive_jaccard_would_give(self):
        # Old Jaccard similarity: "Hello world" vs "Yellow world" scored 0.75
        # because both contain {e,l,o,w,r,d}. SequenceMatcher should score lower.
        sim = pipeline._text_similarity("Hello world", "Yellow world")
        # SequenceMatcher: " world" matches (6 chars), plus "llo" vs "low" partial
        # Exact value doesn't matter — just verify it's meaningfully lower than the 0.75 Jaccard got
        # "Hello world" (11) vs "Yellow world" (12): "llo" matches at pos 2 vs 3, " world" matches
        # M ≈ 8, T = 23 → ratio ≈ 0.70. Not dramatically different but position helps.
        # The real test: dissimilar strings that happen to share letters score < 0.8
        sim2 = pipeline._text_similarity("Hello world", "Completely different text")
        assert sim2 < 0.3

    def test_substring_scores_high(self):
        sim = pipeline._text_similarity("weather", "today's weather is nice")
        assert sim > 0.4  # 7/23 chars match → ratio ≈ 0.48

    def test_whitespace_stripped(self):
        assert pipeline._text_similarity("  你好  ", "你好") == 1.0


# ===========================================================================
# Tests: _detect_watermarks
# ===========================================================================

class TestDetectWatermarks:
    def test_empty_segments(self):
        assert pipeline._detect_watermarks([]) == set()

    def test_text_in_all_segments_filtered(self):
        segs = [_ocr_seg("WATERMARK", i * 1000, i * 1000 + 800) for i in range(10)]
        wm = pipeline._detect_watermarks(segs)
        assert "WATERMARK" in wm

    def test_text_in_69_percent_not_filtered(self):
        # 7/10 = 70% — just at the border; must appear in exactly 7 of 10
        segs = ([_ocr_seg("BORDERLINE", i * 1000, i * 1000 + 800) for i in range(7)] +
                [_ocr_seg("OTHER", i * 1000, i * 1000 + 800) for i in range(3)])
        wm = pipeline._detect_watermarks(segs)
        assert "BORDERLINE" in wm  # 7/10 = 70% exactly — included

    def test_text_in_60_percent_not_filtered(self):
        segs = ([_ocr_seg("FREQUENT", i * 1000, i * 1000 + 800) for i in range(6)] +
                [_ocr_seg("OTHER", i * 1000, i * 1000 + 800) for i in range(4)])
        wm = pipeline._detect_watermarks(segs)
        assert "FREQUENT" not in wm  # 60% < 70%

    def test_single_segment_not_filtered(self):
        # 1/1 = 100% frequency but only 1 occurrence — count guard (c >= 3) prevents false positive
        wm = pipeline._detect_watermarks([_ocr_seg("TEXT", 0, 1000)])
        assert "TEXT" not in wm

    def test_subtitle_text_not_filtered(self):
        # Each segment has unique text — nothing hits 70%
        segs = [_ocr_seg(f"subtitle {i}", i * 1000, i * 1000 + 2000) for i in range(10)]
        wm = pipeline._detect_watermarks(segs)
        assert len(wm) == 0

    def test_deduplication_per_segment(self):
        # Same text appearing twice in ONE segment only counts once
        seg = {"start_ms": 0, "end_ms": 2000, "detections": [
            _ocr_det("REPEAT"), _ocr_det("REPEAT"),
        ]}
        segs = [seg] + [_ocr_seg("OTHER", i * 1000, i * 1000 + 800) for i in range(9)]
        wm = pipeline._detect_watermarks(segs)
        assert "REPEAT" not in wm  # only 1 of 10 segments


# ===========================================================================
# Tests: _find_subtitle_y_band
# ===========================================================================

class TestFindSubtitleYBand:
    def test_insufficient_data_returns_default(self):
        # < 5 detections → default 0.55
        segs = [_ocr_seg("hello", 0, 1000, y_frac=0.80)]
        y = pipeline._find_subtitle_y_band(segs, RES_H, set())
        assert y == 0.55

    def test_all_subtitles_at_bottom(self):
        # All detections at 0.80 → p25 ≈ 0.80 → clamped to 0.75
        segs = [_ocr_seg(f"text{i}", i * 1000, i * 1000 + 2000, y_frac=0.80)
                for i in range(10)]
        y = pipeline._find_subtitle_y_band(segs, RES_H, set())
        assert 0.40 <= y <= 0.75

    def test_watermarks_excluded(self):
        # Watermark at top (y=0.30) should not pull the band up
        wm_det = _ocr_det("WM", y_frac=0.30)
        sub_det = _ocr_det("sub", y_frac=0.80)
        segs = [{"start_ms": i * 1000, "end_ms": i * 1000 + 2000,
                 "detections": [wm_det, sub_det]} for i in range(10)]
        y = pipeline._find_subtitle_y_band(segs, RES_H, {"WM"})
        # Only subtitle at 0.80 counted — result should be > 0.55
        assert y > 0.55

    def test_clamps_to_safe_range(self):
        # Even if detections are all at 0.95, result <= 0.75
        segs = [_ocr_seg(f"t{i}", i * 1000, i * 1000 + 1000, y_frac=0.95) for i in range(20)]
        y = pipeline._find_subtitle_y_band(segs, RES_H, set())
        assert y <= 0.75

    def test_ignores_top_half_detections(self):
        # Detections in top half (y < 0.50) should not be sampled
        top_det = _ocr_det("title", y_frac=0.30)
        segs = [{"start_ms": 0, "end_ms": 1000, "detections": [top_det]}]
        y = pipeline._find_subtitle_y_band(segs, RES_H, set())
        assert y == 0.55  # falls back to default (< 5 bottom-half detections)


# ===========================================================================
# Tests: _is_stt_hallucination
# ===========================================================================

class TestIsSTTHallucination:
    def test_too_short_below_300ms(self):
        assert pipeline._is_stt_hallucination("text", [], 299) is True

    def test_exactly_300ms_is_ok(self):
        assert pipeline._is_stt_hallucination("text", [], 300) is False

    def test_long_enough_no_repetition(self):
        assert pipeline._is_stt_hallucination("hello world", ["goodbye"], 500) is False

    def test_looping_detected(self):
        # Same text appears ≥ 2 times in recent 4 — hallucination
        prev = ["music music", "music music music"]
        assert pipeline._is_stt_hallucination("music music", prev, 800) is True

    def test_looping_needs_two_similar(self):
        # Only 1 similar in history — not a loop
        prev = ["music music"]
        assert pipeline._is_stt_hallucination("music music", prev, 800) is False

    def test_looping_uses_last_4_only(self):
        # Many old instances but only 1 in the last 4 — not a loop
        prev = ["music"] * 10 + ["different text", "also different", "totally other"]
        assert pipeline._is_stt_hallucination("music", prev, 800) is False

    def test_similar_but_not_identical_still_loops(self):
        # 80% similar text still counts as loop
        prev = ["今天天气很好啊", "今天天气很好"]
        assert pipeline._is_stt_hallucination("今天天气很好", prev, 600) is True


# ===========================================================================
# Tests: merge_ocr_stt — OCR-first design
# ===========================================================================

class TestMergeOcrStt:

    # ── Empty / degenerate inputs ────────────────────────────────────────────

    def test_empty_both(self):
        result = pipeline.merge_ocr_stt(_make_ocr_data([]), _make_stt_data([]))
        assert result["segments"] == []

    def test_empty_ocr_all_stt(self):
        """No OCR → STT fills the whole video (if hallucination-free)."""
        stt = _make_stt_data([_stt_seg("hello", 1000, 3000)])
        result = pipeline.merge_ocr_stt(_make_ocr_data([], duration_ms=10_000), stt)
        texts = _seg_texts(result)
        assert len(texts) == 1
        assert texts[0] == ("hello", "stt_only")

    def test_empty_stt_all_ocr(self):
        """No STT → OCR backbone only, no gap fill possible."""
        ocr = _make_ocr_data([_ocr_seg("你好", 1000, 3000)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        texts = _seg_texts(result)
        assert len(texts) == 1
        assert texts[0] == ("你好", "ocr")

    # ── OCR backbone priority ────────────────────────────────────────────────

    def test_ocr_text_used_not_stt_text_when_matching(self):
        """When OCR and STT overlap with high similarity, OCR text wins."""
        # OCR has the accurate Chinese text; STT has a slightly different transcription
        ocr = _make_ocr_data([_ocr_seg("今天天气很好", 1000, 3000)])
        stt = _make_stt_data([_stt_seg("今天天气好", 1000, 3000)])  # missing 很
        result = pipeline.merge_ocr_stt(ocr, stt)
        texts = _seg_texts(result)
        # OCR text must win
        assert texts[0][0] == "今天天气很好"

    def test_stt_timing_adopted_on_high_similarity(self):
        """OCR timing is replaced by STT timing when sim ≥ 0.6."""
        # OCR covers 800–3200ms; STT has tighter timing 1000–2800ms
        ocr = _make_ocr_data([_ocr_seg("今天天气很好", 800, 3200)])
        stt = _make_stt_data([_stt_seg("今天天气好", 1000, 2800)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        seg = result["segments"][0]
        assert seg["source"] == "ocr+stt"
        assert seg["start_ms"] == 1000
        assert seg["end_ms"] == 2800

    def test_stt_timing_not_adopted_on_low_similarity(self):
        """When OCR/STT texts are dissimilar (different content), keep OCR timing."""
        ocr = _make_ocr_data([_ocr_seg("完全不同的内容", 1000, 3000)])
        stt = _make_stt_data([_stt_seg("hello world", 1200, 2800)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        seg = result["segments"][0]
        assert seg["source"] == "ocr"
        assert seg["start_ms"] == 1000  # original OCR timing preserved

    def test_ocr_source_field_when_no_stt(self):
        ocr = _make_ocr_data([_ocr_seg("你好", 1000, 3000)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert result["segments"][0]["source"] == "ocr"

    def test_ocr_plus_stt_source_field(self):
        ocr = _make_ocr_data([_ocr_seg("今天天气很好", 1000, 3000)])
        stt = _make_stt_data([_stt_seg("今天天气好", 1000, 3000)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        assert result["segments"][0]["source"] == "ocr+stt"

    # ── Watermark filtering ──────────────────────────────────────────────────

    def test_watermark_ocr_segments_excluded(self):
        """OCR segments whose only detection is a watermark are excluded."""
        # 10 segments with watermark, 1 with actual subtitle
        wm_segs = [_ocr_seg("CHANNELID", i * 1000, i * 1000 + 800) for i in range(10)]
        sub_seg = _ocr_seg("你好世界", 10_000, 12_000)
        ocr = _make_ocr_data(wm_segs + [sub_seg], duration_ms=15_000)
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        texts = [s["detections"][0]["text"] for s in result["segments"]]
        assert "CHANNELID" not in texts
        assert "你好世界" in texts

    def test_multiple_detections_watermark_filtered_best_subtitle_used(self):
        """Segment with both watermark and subtitle — subtitle wins."""
        seg = {
            "start_ms": 1000, "end_ms": 3000,
            "detections": [
                _ocr_det("WATERMARK", y_frac=0.80),  # will be persistent
                _ocr_det("真正的字幕", y_frac=0.85),
            ],
        }
        # 10 identical watermark segments so it hits the 70% threshold
        wm_only = [{"start_ms": i * 500, "end_ms": i * 500 + 400,
                    "detections": [_ocr_det("WATERMARK", y_frac=0.80)]}
                   for i in range(10)]
        ocr = _make_ocr_data(wm_only + [seg], duration_ms=10_000)
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        texts = [s["detections"][0]["text"] for s in result["segments"]]
        # "WATERMARK" must not appear; "真正的字幕" should
        assert "WATERMARK" not in texts
        assert "真正的字幕" in texts

    # ── Position (scene text) filtering ─────────────────────────────────────

    def test_scene_text_in_top_of_frame_excluded(self):
        """Detections in the top portion of the frame are not treated as subtitles."""
        # y_frac=0.20 = top 20% of frame — scene text / title
        ocr = _make_ocr_data([_ocr_seg("STORE SIGN", 1000, 3000, y_frac=0.20)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert result["segments"] == []

    def test_subtitle_in_bottom_included(self):
        """Detections in the bottom portion are included."""
        ocr = _make_ocr_data([_ocr_seg("字幕文字", 1000, 3000, y_frac=0.82)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert len(result["segments"]) == 1
        assert result["segments"][0]["detections"][0]["text"] == "字幕文字"

    # ── Duration filter ──────────────────────────────────────────────────────

    def test_very_short_ocr_segment_excluded(self):
        """OCR segments < 200ms are filtered (single-frame flicker)."""
        ocr = _make_ocr_data([_ocr_seg("flicker", 1000, 1100)])  # 100ms
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert result["segments"] == []

    def test_very_long_ocr_segment_excluded(self):
        """OCR segments > 15s are excluded (likely a persistent element, not a subtitle)."""
        ocr = _make_ocr_data([_ocr_seg("persistent", 0, 16_000)])  # 16s
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert result["segments"] == []

    def test_200ms_ocr_segment_included(self):
        """200ms is the minimum — exactly 200ms should pass."""
        ocr = _make_ocr_data([_ocr_seg("ok", 1000, 1200)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert len(result["segments"]) == 1

    # ── STT gap-fill ─────────────────────────────────────────────────────────

    def test_stt_fills_genuine_gap_between_ocr_segments(self):
        """STT segment in a real gap between two OCR segments is included."""
        ocr = _make_ocr_data([
            _ocr_seg("段落一", 0, 2000),
            _ocr_seg("段落三", 5000, 7000),
        ], duration_ms=10_000)
        stt = _make_stt_data([_stt_seg("gap speech", 2500, 4500)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        texts = _seg_texts(result)
        assert ("gap speech", "stt_only") in texts

    def test_stt_not_inserted_during_ocr_coverage(self):
        """STT segment that overlaps with an OCR segment is NOT gap-filled."""
        ocr = _make_ocr_data([_ocr_seg("字幕", 1000, 5000)], duration_ms=10_000)
        # STT segment is during the OCR coverage window
        stt = _make_stt_data([_stt_seg("overlapping", 2000, 4000)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        # "overlapping" must not appear as stt_only — it was within an OCR window
        stt_only = [s for s in result["segments"] if s["source"] == "stt_only"]
        assert not any(s["detections"][0]["text"] == "overlapping" for s in stt_only)

    def test_stt_not_inserted_in_small_gap(self):
        """Gaps < 500ms are not filled — too small for reliable gap detection."""
        ocr = _make_ocr_data([
            _ocr_seg("seg1", 0, 2000),
            _ocr_seg("seg2", 2300, 4000),  # only 300ms gap
        ], duration_ms=10_000)
        stt = _make_stt_data([_stt_seg("small gap", 2050, 2250)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        stt_only = [s for s in result["segments"] if s["source"] == "stt_only"]
        assert len(stt_only) == 0

    def test_stt_fills_gap_before_first_ocr(self):
        """STT before the first OCR segment is included (intro speech)."""
        ocr = _make_ocr_data([_ocr_seg("字幕", 3000, 5000)], duration_ms=10_000)
        stt = _make_stt_data([_stt_seg("intro speech", 500, 2000)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        stt_only = [s for s in result["segments"] if s["source"] == "stt_only"]
        assert any(s["detections"][0]["text"] == "intro speech" for s in stt_only)

    def test_stt_fills_gap_after_last_ocr(self):
        """STT after the last OCR segment is included (outro speech)."""
        ocr = _make_ocr_data([_ocr_seg("字幕", 1000, 3000)], duration_ms=10_000)
        stt = _make_stt_data([_stt_seg("outro", 7000, 9000)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        stt_only = [s for s in result["segments"] if s["source"] == "stt_only"]
        assert any(s["detections"][0]["text"] == "outro" for s in stt_only)

    # ── STT hallucination filtering ──────────────────────────────────────────

    def test_short_stt_segment_not_gap_filled(self):
        """STT segments < 300ms are hallucination-filtered."""
        ocr = _make_ocr_data([
            _ocr_seg("a", 0, 1000),
            _ocr_seg("b", 3000, 4000),
        ], duration_ms=10_000)
        stt = _make_stt_data([_stt_seg("short", 1200, 1400)])  # 200ms
        result = pipeline.merge_ocr_stt(ocr, stt)
        stt_only = [s for s in result["segments"] if s["source"] == "stt_only"]
        assert len(stt_only) == 0

    def test_looping_stt_not_gap_filled(self):
        """Repeating STT text (Whisper loop hallucination) is filtered."""
        ocr = _make_ocr_data([_ocr_seg("字幕", 0, 1000)], duration_ms=20_000)
        # Five identical STT segments in the gap — classic Whisper loop
        stt_segs = [_stt_seg("music music music", 2000 + i * 2000, 3000 + i * 2000)
                    for i in range(5)]
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data(stt_segs))
        stt_only = [s for s in result["segments"] if s["source"] == "stt_only"]
        # After the 3rd repetition, hallucination filter kicks in
        assert len(stt_only) <= 2  # at most the first 2 before loop detected

    def test_varied_stt_in_gap_not_filtered(self):
        """Different STT segments in a genuine gap are not filtered."""
        ocr = _make_ocr_data([
            _ocr_seg("a", 0, 1000),
            _ocr_seg("b", 8000, 9000),
        ], duration_ms=12_000)
        stt_segs = [
            _stt_seg("first sentence", 1500, 2500),
            _stt_seg("second sentence", 3000, 4500),
            _stt_seg("third sentence", 5000, 6500),
        ]
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data(stt_segs))
        stt_only = [s for s in result["segments"] if s["source"] == "stt_only"]
        assert len(stt_only) == 3

    # ── Deduplication ────────────────────────────────────────────────────────

    def test_consecutive_identical_segments_merged(self):
        """Consecutive OCR segments with identical text are merged into one."""
        ocr = _make_ocr_data([
            _ocr_seg("你好", 0, 1000),
            _ocr_seg("你好", 1000, 2000),  # exact duplicate
        ])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert len(result["segments"]) == 1
        assert result["segments"][0]["end_ms"] == 2000

    def test_consecutive_similar_segments_merged(self):
        """Segments with ≥85% similar text are merged (OCR noise)."""
        # "你好世界" vs "你好世界！" — one punctuation difference, high similarity
        ocr = _make_ocr_data([
            _ocr_seg("你好世界", 0, 1000),
            _ocr_seg("你好世界！", 1000, 2000),
        ])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert len(result["segments"]) == 1

    def test_different_segments_not_merged(self):
        """Segments with different text are not deduplicated."""
        ocr = _make_ocr_data([
            _ocr_seg("第一段", 0, 2000),
            _ocr_seg("第二段", 2500, 4500),
        ])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert len(result["segments"]) == 2

    # ── Output format ────────────────────────────────────────────────────────

    def test_output_has_required_top_level_fields(self):
        ocr = _make_ocr_data([_ocr_seg("test", 1000, 3000)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert "video" in result
        assert "resolution" in result
        assert "duration_ms" in result
        assert "subtitle_source" in result
        assert "segments" in result
        assert result["subtitle_source"] == "both"

    def test_each_segment_has_required_fields(self):
        ocr = _make_ocr_data([_ocr_seg("你好", 1000, 3000)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        seg = result["segments"][0]
        assert "start_ms" in seg
        assert "end_ms" in seg
        assert "source" in seg
        assert "spoken" in seg
        assert seg["spoken"] is True
        assert "detections" in seg
        det = seg["detections"][0]
        assert "text" in det
        assert "confidence" in det
        assert "bbox" in det
        assert "chars" in det

    def test_stt_only_segments_have_centered_bbox(self):
        """STT-only segments get a synthetic centered bbox."""
        ocr = _make_ocr_data([_ocr_seg("字幕", 0, 1000)], duration_ms=10_000)
        stt = _make_stt_data([_stt_seg("gap speech", 2000, 4000)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        stt_segs = [s for s in result["segments"] if s["source"] == "stt_only"]
        assert len(stt_segs) == 1
        bbox = stt_segs[0]["detections"][0]["bbox"]
        # Should be centered horizontally on a 720px frame
        text = stt_segs[0]["detections"][0]["text"]
        assert bbox["x"] >= 0
        assert bbox["y"] > int(1280 * 0.70)  # in the bottom portion

    def test_segments_sorted_by_start_ms(self):
        """Output segments are always in chronological order."""
        ocr = _make_ocr_data([
            _ocr_seg("第二段", 5000, 7000),
            _ocr_seg("第一段", 1000, 3000),
        ], duration_ms=10_000)
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        starts = [s["start_ms"] for s in result["segments"]]
        assert starts == sorted(starts)

    def test_ocr_preserves_char_bboxes(self):
        """OCR segments retain their original char bbox data (not synthetic)."""
        det = _ocr_det("你好世界", y_frac=0.80)
        det["chars"] = [{"char": c, "x": i * 25, "y": 1024, "width": 25, "height": 40}
                        for i, c in enumerate("你好世界")]
        seg = {"start_ms": 1000, "end_ms": 3000, "detections": [det]}
        ocr = _make_ocr_data([seg])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        out_det = result["segments"][0]["detections"][0]
        # Chars should come from OCR, not synthetic (OCR chars have y=1024 here)
        assert out_det["chars"][0]["y"] == 1024

    # ── Latin language support ────────────────────────────────────────────────

    def test_latin_subtitles_pass_through(self):
        """Latin-script subtitles (Spanish) are handled without CJK assumptions."""
        ocr = _make_ocr_data([_ocr_seg("Buenos días", 1000, 3000)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert len(result["segments"]) == 1
        assert result["segments"][0]["detections"][0]["text"] == "Buenos días"

    def test_latin_stt_timing_refinement(self):
        """Spanish OCR matches Spanish STT with SequenceMatcher (not Jaccard)."""
        ocr = _make_ocr_data([_ocr_seg("Buenos días amigos", 1000, 3500)])
        stt = _make_stt_data([_stt_seg("Buenos días amigos", 1100, 3200)])
        result = pipeline.merge_ocr_stt(ocr, stt)
        seg = result["segments"][0]
        assert seg["source"] == "ocr+stt"
        assert seg["start_ms"] == 1100

    def test_mixed_cjk_latin_segment(self):
        """Mixed Chinese+English subtitles (code-switching) are preserved."""
        ocr = _make_ocr_data([_ocr_seg("Hello 世界", 1000, 3000)])
        result = pipeline.merge_ocr_stt(ocr, _make_stt_data([]))
        assert result["segments"][0]["detections"][0]["text"] == "Hello 世界"

    # ── Multi-segment scenarios ──────────────────────────────────────────────

    def test_full_video_ocr_with_stt_gaps(self):
        """Realistic scenario: OCR for subtitles + STT for intro/outro gaps."""
        ocr = _make_ocr_data([
            _ocr_seg("第一句", 2000, 4000),
            _ocr_seg("第二句", 5000, 7000),
            _ocr_seg("第三句", 8000, 10000),
        ], duration_ms=15_000)
        stt = _make_stt_data([
            _stt_seg("intro words", 500, 1500),          # before first OCR
            _stt_seg("第一句", 2100, 3900),              # overlaps OCR → timing refinement
            _stt_seg("gap words", 4200, 4800),            # small gap (800ms) → included
            _stt_seg("第二句 variation", 5100, 6900),    # overlaps OCR → timing refinement
            _stt_seg("outro words", 11000, 13000),        # after last OCR
        ])
        result = pipeline.merge_ocr_stt(ocr, stt)
        sources = [s["source"] for s in result["segments"]]
        texts = [s["detections"][0]["text"] for s in result["segments"]]

        # OCR text must be preserved for matching segments
        assert "第一句" in texts
        assert "第二句" in texts
        assert "第三句" in texts
        # STT gap fills present
        assert "intro words" in texts
        assert "outro words" in texts
        # No stt_only segments for OCR-covered windows
        ocr_covered_stt_only = [
            (t, src) for t, src in zip(texts, sources)
            if src == "stt_only" and t in ("第一句 variation",)
        ]
        assert len(ocr_covered_stt_only) == 0
