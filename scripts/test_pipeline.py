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
    """Verify that the pipeline's run_ocr() produces the same output as
    the validated extract_subtitles_videocr2.py for a reference video.

    This test prevents the regression where the pipeline's inline OCR
    silently diverged from the validated extraction script and produced
    fewer subtitles. If this test fails, either:
    1. The pipeline's run_ocr() was changed without updating videocr2, or
    2. The videocr2 script was changed without updating the pipeline.
    """

    def test_pipeline_ocr_constants_match_videocr2(self):
        """Verify that the pipeline's OCR uses the same constants as videocr2."""
        import importlib.util

        # Load videocr2 module
        spec = importlib.util.spec_from_file_location(
            "videocr2",
            os.path.join(os.path.dirname(__file__), "extract_subtitles_videocr2.py"),
        )
        videocr2 = importlib.util.module_from_spec(spec)

        # Extract constants from videocr2 source (avoid executing the module
        # which would try to import paddleocr)
        videocr2_source = open(
            os.path.join(os.path.dirname(__file__), "extract_subtitles_videocr2.py")
        ).read()

        # Check that the pipeline's run_ocr docstring mentions videocr2
        import inspect
        run_ocr_source = inspect.getsource(pipeline.run_ocr)

        # Verify critical constants are present and match
        assert "FRAME_INTERVAL_MS = 250" in run_ocr_source, "Pipeline must sample at 250ms"
        assert "OCR_SCALE = 0.5" in run_ocr_source, "Pipeline must use half-res"
        assert "MIN_DURATION_MS = 750" in run_ocr_source, "Pipeline must filter <750ms segments"
        assert "CONF_THRESHOLD = 0.70" in run_ocr_source, "Pipeline must use 0.70 confidence"
        assert "MIN_CHARS = 2" in run_ocr_source, "Pipeline must filter <2 char detections"
        assert "SSIM_THRESHOLD = 0.92" in run_ocr_source, "Pipeline must use 0.92 SSIM threshold"
        assert "SUBTITLE_REGION_TOP = 0.5" in run_ocr_source, "Pipeline subtitle region must start at 50%"
        assert "SUBTITLE_REGION_BOTTOM = 0.85" in run_ocr_source, "Pipeline subtitle region must end at 85%"

        # Same constants in videocr2
        assert "FRAME_INTERVAL_MS = 250" in videocr2_source
        assert "OCR_SCALE = 0.5" in videocr2_source
        assert "MIN_DURATION_MS = 750" in videocr2_source
        assert "CONF_THRESHOLD = 0.70" in videocr2_source
        assert "SSIM_THRESHOLD = 0.92" in videocr2_source
        assert "SUBTITLE_REGION_TOP = 0.5" in videocr2_source
        assert "SUBTITLE_REGION_BOTTOM = 0.85" in videocr2_source
