"""Tests for config_utils.get_user_model_id function.

Validates: Requirements 15.8, 15.9
"""

import os
from unittest.mock import patch, MagicMock

import pytest

# Set env var before importing the module
os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-agent-configurations")

from config_utils import get_user_model_id, DEFAULT_MODEL_ID, VALID_PURPOSES


class TestGetUserModelId:
    """Tests for get_user_model_id resolution logic."""

    @patch("config_utils.boto3")
    def test_returns_purpose_specific_model_when_set(self, mock_boto3):
        """When a purpose-specific override is set, it should be returned."""
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "userId": "user-1",
                "sk": "LLM_CONFIG",
                "data": {
                    "defaultModel": "amazon.nova-pro-v1:0",
                    "challengeGeneration": "anthropic.claude-sonnet-4-20250514-v1:0",
                    "challengeGrading": None,
                    "gameCommentary": None,
                },
            }
        }
        mock_boto3.resource.return_value.Table.return_value = mock_table

        result = get_user_model_id("user-1", "challengeGeneration")
        assert result == "anthropic.claude-sonnet-4-20250514-v1:0"

    @patch("config_utils.boto3")
    def test_falls_back_to_default_model_when_purpose_is_none(self, mock_boto3):
        """When purpose-specific override is None, should fall back to defaultModel."""
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "userId": "user-1",
                "sk": "LLM_CONFIG",
                "data": {
                    "defaultModel": "amazon.nova-pro-v1:0",
                    "challengeGeneration": None,
                    "challengeGrading": None,
                    "gameCommentary": None,
                },
            }
        }
        mock_boto3.resource.return_value.Table.return_value = mock_table

        result = get_user_model_id("user-1", "challengeGrading")
        assert result == "amazon.nova-pro-v1:0"

    @patch("config_utils.boto3")
    def test_falls_back_to_hardcoded_default_when_no_config_exists(self, mock_boto3):
        """When no LLM_CONFIG item exists, should return the hardcoded default."""
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}  # No Item key
        mock_boto3.resource.return_value.Table.return_value = mock_table

        result = get_user_model_id("user-1", "challengeGeneration")
        assert result == DEFAULT_MODEL_ID

    @patch("config_utils.boto3")
    def test_falls_back_to_hardcoded_default_when_default_model_is_none(self, mock_boto3):
        """When both purpose and defaultModel are None, should return hardcoded default."""
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "userId": "user-1",
                "sk": "LLM_CONFIG",
                "data": {
                    "defaultModel": None,
                    "challengeGeneration": None,
                    "challengeGrading": None,
                    "gameCommentary": None,
                },
            }
        }
        mock_boto3.resource.return_value.Table.return_value = mock_table

        result = get_user_model_id("user-1", "gameCommentary")
        assert result == DEFAULT_MODEL_ID

    @patch("config_utils.boto3")
    def test_returns_default_for_unknown_purpose(self, mock_boto3):
        """When an unknown purpose is provided, should return hardcoded default."""
        result = get_user_model_id("user-1", "unknownPurpose")
        assert result == DEFAULT_MODEL_ID
        # Should not even call DynamoDB
        mock_boto3.resource.assert_not_called()

    @patch("config_utils.boto3")
    def test_returns_default_on_dynamodb_error(self, mock_boto3):
        """When DynamoDB throws an error, should return hardcoded default."""
        mock_table = MagicMock()
        mock_table.get_item.side_effect = Exception("DynamoDB connection error")
        mock_boto3.resource.return_value.Table.return_value = mock_table

        result = get_user_model_id("user-1", "challengeGeneration")
        assert result == DEFAULT_MODEL_ID

    @patch.dict(os.environ, {"AGENT_CONFIGURATIONS_TABLE": ""}, clear=False)
    @patch("config_utils.boto3")
    def test_returns_default_when_table_env_not_set(self, mock_boto3):
        """When AGENT_CONFIGURATIONS_TABLE env var is empty, should return default."""
        # Temporarily clear the env var
        with patch.dict(os.environ, {"AGENT_CONFIGURATIONS_TABLE": ""}):
            result = get_user_model_id("user-1", "challengeGeneration")
            assert result == DEFAULT_MODEL_ID

    @patch("config_utils.boto3")
    def test_all_valid_purposes_are_resolved(self, mock_boto3):
        """Each valid purpose should resolve to its specific model when set."""
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "userId": "user-1",
                "sk": "LLM_CONFIG",
                "data": {
                    "defaultModel": "amazon.nova-lite-v1:0",
                    "challengeGeneration": "meta.llama3-3-70b-instruct-v1:0",
                    "challengeGrading": "mistral.mistral-large-2411-v1:0",
                    "gameCommentary": "deepseek.deepseek-v3-2-0:0",
                },
            }
        }
        mock_boto3.resource.return_value.Table.return_value = mock_table

        assert get_user_model_id("user-1", "challengeGeneration") == "meta.llama3-3-70b-instruct-v1:0"
        assert get_user_model_id("user-1", "challengeGrading") == "mistral.mistral-large-2411-v1:0"
        assert get_user_model_id("user-1", "gameCommentary") == "deepseek.deepseek-v3-2-0:0"

    def test_default_model_id_is_nova_lite(self):
        """The hardcoded default should be amazon.nova-lite-v1:0."""
        assert DEFAULT_MODEL_ID == "amazon.nova-lite-v1:0"

    def test_valid_purposes_contains_expected_keys(self):
        """VALID_PURPOSES should contain the three expected purpose keys."""
        assert VALID_PURPOSES == {"challengeGeneration", "challengeGrading", "gameCommentary"}
