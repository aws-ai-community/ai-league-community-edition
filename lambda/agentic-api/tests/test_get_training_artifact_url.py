"""Unit tests for handle_get_training_artifact_url handler."""

import os
import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture(autouse=True)
def env_vars(monkeypatch):
    """Set required environment variables for module import."""
    monkeypatch.setenv("AGENT_CONFIGURATIONS_TABLE", "test-table")
    monkeypatch.setenv("TRAINING_ARTIFACTS_BUCKET", "test-bucket")


@pytest.fixture
def handler():
    """Import the handler after setting env vars."""
    # Need to reimport to pick up env vars
    import importlib
    import fine_tuning_handlers

    importlib.reload(fine_tuning_handlers)
    return fine_tuning_handlers.handle_get_training_artifact_url


@pytest.fixture
def mock_event():
    """Minimal AppSync event."""
    return {"identity": {"sub": "user-123"}}


class TestHandleGetTrainingArtifactUrl:
    """Tests for handle_get_training_artifact_url."""

    def test_valid_training_data_jsonl(self, handler, mock_event):
        """Valid artifactKey 'tool-call-training.jsonl' returns a pre-signed URL."""
        with patch("fine_tuning_handlers.s3_client") as mock_s3:
            mock_s3.generate_presigned_url.return_value = "https://s3.example.com/presigned"

            result = handler({"artifactKey": "tool-call-training.jsonl"}, mock_event)

            assert result == {"url": "https://s3.example.com/presigned", "expiresIn": 3600}
            mock_s3.generate_presigned_url.assert_called_once_with(
                "get_object",
                Params={"Bucket": "test-bucket", "Key": "samples/tool-call-training.jsonl"},
                ExpiresIn=3600,
            )

    def test_valid_eval_data_jsonl(self, handler, mock_event):
        """Valid artifactKey 'tool-call-eval.jsonl' returns a pre-signed URL."""
        with patch("fine_tuning_handlers.s3_client") as mock_s3:
            mock_s3.generate_presigned_url.return_value = "https://s3.example.com/eval"

            result = handler({"artifactKey": "tool-call-eval.jsonl"}, mock_event)

            assert result == {"url": "https://s3.example.com/eval", "expiresIn": 3600}
            mock_s3.generate_presigned_url.assert_called_once_with(
                "get_object",
                Params={"Bucket": "test-bucket", "Key": "samples/tool-call-eval.jsonl"},
                ExpiresIn=3600,
            )

    def test_valid_reward_function_py(self, handler, mock_event):
        """Valid artifactKey 'reward-function-tool-call.py' returns a pre-signed URL."""
        with patch("fine_tuning_handlers.s3_client") as mock_s3:
            mock_s3.generate_presigned_url.return_value = "https://s3.example.com/reward"

            result = handler({"artifactKey": "reward-function-tool-call.py"}, mock_event)

            assert result == {"url": "https://s3.example.com/reward", "expiresIn": 3600}
            mock_s3.generate_presigned_url.assert_called_once_with(
                "get_object",
                Params={"Bucket": "test-bucket", "Key": "samples/reward-function-tool-call.py"},
                ExpiresIn=3600,
            )

    def test_invalid_artifact_key_raises_value_error(self, handler, mock_event):
        """Invalid artifact key raises ValueError."""
        with pytest.raises(ValueError, match="Invalid artifact key"):
            handler({"artifactKey": "malicious-file.sh"}, mock_event)

    def test_empty_artifact_key_raises_value_error(self, handler, mock_event):
        """Empty artifact key raises ValueError."""
        with pytest.raises(ValueError, match="Invalid artifact key"):
            handler({"artifactKey": ""}, mock_event)

    def test_missing_artifact_key_raises_value_error(self, handler, mock_event):
        """Missing artifactKey argument raises ValueError."""
        with pytest.raises(ValueError, match="Invalid artifact key"):
            handler({}, mock_event)

    def test_path_traversal_attempt_rejected(self, handler, mock_event):
        """Path traversal attempts are rejected."""
        with pytest.raises(ValueError, match="Invalid artifact key"):
            handler({"artifactKey": "../secrets/credentials.json"}, mock_event)

    def test_missing_bucket_env_var_raises_runtime_error(self, mock_event, monkeypatch):
        """Missing TRAINING_ARTIFACTS_BUCKET raises RuntimeError."""
        monkeypatch.setenv("TRAINING_ARTIFACTS_BUCKET", "")

        import importlib
        import fine_tuning_handlers

        importlib.reload(fine_tuning_handlers)

        with pytest.raises(RuntimeError, match="Training artifacts bucket is not configured"):
            fine_tuning_handlers.handle_get_training_artifact_url(
                {"artifactKey": "tool-call-training.jsonl"}, mock_event
            )

    def test_s3_error_raises_runtime_error(self, handler, mock_event):
        """S3 client errors are wrapped in RuntimeError."""
        with patch("fine_tuning_handlers.s3_client") as mock_s3:
            mock_s3.generate_presigned_url.side_effect = Exception("S3 access denied")

            with pytest.raises(RuntimeError, match="Failed to generate download URL"):
                handler({"artifactKey": "tool-call-training.jsonl"}, mock_event)
