"""Unit and integration tests for config_seeder module.

Tests: YAML parsing, deterministic ID generation, resource creation logic,
partial failure scenarios, idempotency, and fallback behaviour.

Requirements: 7.1, 7.2, 7.3, 7.5, 5.3, 6.5
"""

import io
import json
import os
import sys
import zipfile
from unittest.mock import MagicMock, patch, ANY

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config_seeder
from config_seeder import (
    _deterministic_id,
    _get_tool_zip,
    _now_iso,
    load_seed_config,
    seed_user_config,
)


# ============================================================================
# Unit Tests: Deterministic ID generation
# ============================================================================


class TestDeterministicId:
    """Test stable, reproducible ID generation."""

    def test_same_inputs_produce_same_id(self):
        id1 = _deterministic_id("user-123", "tool", "Pathfinder")
        id2 = _deterministic_id("user-123", "tool", "Pathfinder")
        assert id1 == id2

    def test_different_users_produce_different_ids(self):
        id1 = _deterministic_id("user-123", "tool", "Pathfinder")
        id2 = _deterministic_id("user-456", "tool", "Pathfinder")
        assert id1 != id2

    def test_different_names_produce_different_ids(self):
        id1 = _deterministic_id("user-123", "tool", "Pathfinder")
        id2 = _deterministic_id("user-123", "tool", "Calculator")
        assert id1 != id2

    def test_id_has_correct_prefix(self):
        tool_id = _deterministic_id("user-123", "tool", "Pathfinder")
        assert tool_id.startswith("seed-tool-")
        agent_id = _deterministic_id("user-123", "agent", "Sub")
        assert agent_id.startswith("seed-agent-")

    def test_id_length_is_stable(self):
        id1 = _deterministic_id("user-123", "tool", "Pathfinder")
        # prefix "seed-tool-" (10) + 12 hex chars = 22
        assert len(id1) == 22


# ============================================================================
# Unit Tests: Tool zip generation
# ============================================================================


class TestGetToolZip:
    """Test zip generation for Lambda tool source code."""

    def test_default_hello_world_when_no_source_dir(self):
        tool_def = {"name": "MyTool"}
        zip_bytes = _get_tool_zip(tool_def)
        assert isinstance(zip_bytes, bytes)

        # Verify it's a valid zip containing index.py
        buf = io.BytesIO(zip_bytes)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            assert "index.py" in names
            content = zf.read("index.py").decode()
            assert "lambda_handler" in content
            assert "Hello" in content

    @patch.dict(os.environ, {"AGENT_CONFIG_BUCKET": "test-bucket", "AGENT_CONFIG_PREFIX": "agent-config/"})
    @patch("config_seeder.boto3")
    def test_downloads_from_s3_when_source_dir_set(self, mock_boto3):
        """Test that source code is downloaded from S3 and zipped."""
        mock_s3 = MagicMock()
        mock_boto3.client.return_value = mock_s3

        # Mock list_objects_v2
        mock_s3.list_objects_v2.return_value = {
            "Contents": [
                {"Key": "agent-config/tools/Pathfinder/lambda_handler.py"},
            ]
        }
        # Mock get_object
        mock_s3.get_object.return_value = {
            "Body": io.BytesIO(b"def lambda_handler(event, context): pass")
        }

        tool_def = {"name": "Pathfinder", "sourceDir": "tools/Pathfinder"}
        zip_bytes = _get_tool_zip(tool_def)

        mock_s3.list_objects_v2.assert_called_once_with(
            Bucket="test-bucket", Prefix="agent-config/tools/Pathfinder/"
        )
        assert isinstance(zip_bytes, bytes)

        # Verify zip contents
        buf = io.BytesIO(zip_bytes)
        with zipfile.ZipFile(buf, "r") as zf:
            assert "lambda_handler.py" in zf.namelist()


# ============================================================================
# Unit Tests: load_seed_config
# ============================================================================


class TestLoadSeedConfig:
    """Test S3 config loading and caching."""

    def setup_method(self):
        # Reset cache between tests
        config_seeder._cached_config = None
        config_seeder._cached_config_etag = None

    @patch.dict(os.environ, {"AGENT_CONFIG_BUCKET": ""})
    def test_returns_none_when_no_bucket_env_var(self):
        result = load_seed_config()
        assert result is None

    @patch.dict(os.environ, {}, clear=True)
    def test_returns_none_when_env_var_missing(self):
        # Remove all env vars
        for key in ["AGENT_CONFIG_BUCKET", "AGENT_CONFIG_PREFIX"]:
            os.environ.pop(key, None)
        result = load_seed_config()
        assert result is None

    @patch.dict(os.environ, {"AGENT_CONFIG_BUCKET": "test-bucket", "AGENT_CONFIG_PREFIX": "agent-config/"})
    @patch("config_seeder.boto3")
    def test_downloads_and_parses_yaml(self, mock_boto3):
        mock_s3 = MagicMock()
        mock_boto3.client.return_value = mock_s3

        yaml_content = """
supervisor:
  name: "Test Agent"
  systemPrompt: "Hello"
tools:
  - name: "TestTool"
"""
        mock_s3.head_object.return_value = {"ETag": "\"abc123\""}
        mock_s3.get_object.return_value = {
            "Body": io.BytesIO(yaml_content.encode())
        }
        # Need to set the exceptions attribute for NoSuchKey
        mock_s3.exceptions = MagicMock()

        result = load_seed_config()
        assert result is not None
        assert result["supervisor"]["name"] == "Test Agent"

    @patch.dict(os.environ, {"AGENT_CONFIG_BUCKET": "test-bucket", "AGENT_CONFIG_PREFIX": "agent-config/"})
    @patch("config_seeder.boto3")
    def test_caches_config_on_second_call(self, mock_boto3):
        mock_s3 = MagicMock()
        mock_boto3.client.return_value = mock_s3

        yaml_content = "supervisor:\n  name: Cached\n  systemPrompt: Hi\n"
        mock_s3.head_object.return_value = {"ETag": "\"etag1\""}
        mock_s3.get_object.return_value = {
            "Body": io.BytesIO(yaml_content.encode())
        }
        mock_s3.exceptions = MagicMock()

        # First call
        result1 = load_seed_config()
        assert result1["supervisor"]["name"] == "Cached"

        # Second call — same etag, should use cache (get_object not called again)
        mock_s3.get_object.reset_mock()
        result2 = load_seed_config()
        assert result2["supervisor"]["name"] == "Cached"
        mock_s3.get_object.assert_not_called()


# ============================================================================
# Integration Tests: seed_user_config (mocked AWS services)
# ============================================================================


VALID_CONFIG = {
    "supervisor": {
        "name": "Test Supervisor",
        "systemPrompt": "You orchestrate.",
        "subAgents": ["PathAgent"],
        "tools": ["Pathfinder"],
        "memory": None,
        "guardrail": None,
    },
    "subAgents": [
        {
            "name": "PathAgent",
            "systemPrompt": "Find paths.",
            "tools": ["Pathfinder"],
        }
    ],
    "tools": [
        {"name": "Pathfinder", "sourceDir": "tools/Pathfinder"},
    ],
}


class TestSeedUserConfigIntegration:
    """Integration tests with mocked AWS services."""

    def setup_method(self):
        config_seeder._cached_config = None
        config_seeder._cached_config_etag = None

    @patch.dict(os.environ, {
        "AGENT_CONFIG_BUCKET": "test-bucket",
        "AGENT_CONFIG_PREFIX": "agent-config/",
        "AGENT_CONFIGURATIONS_TABLE": "TestTable",
        "LAMBDA_TOOL_ROLE_ARN": "arn:aws:iam::123456789012:role/TestRole",
    })
    @patch("config_seeder.load_seed_config")
    @patch("config_seeder.boto3")
    def test_full_seeding_success(self, mock_boto3, mock_load):
        """Test successful seeding with all resources created."""
        mock_load.return_value = VALID_CONFIG

        # Mock DynamoDB table
        mock_table = MagicMock()
        mock_dynamodb = MagicMock()
        mock_dynamodb.Table.return_value = mock_table
        mock_boto3.resource.return_value = mock_dynamodb

        # Mock Lambda client
        mock_lambda = MagicMock()
        mock_lambda.exceptions = MagicMock()
        mock_lambda.exceptions.ResourceNotFoundException = type("ResourceNotFoundException", (Exception,), {})
        mock_lambda.get_function.side_effect = mock_lambda.exceptions.ResourceNotFoundException()

        # Mock S3 client for tool source download
        mock_s3 = MagicMock()
        mock_s3.list_objects_v2.return_value = {
            "Contents": [{"Key": "agent-config/tools/Pathfinder/lambda_handler.py"}]
        }
        mock_s3.get_object.return_value = {
            "Body": io.BytesIO(b"def lambda_handler(e, c): pass")
        }

        def client_factory(service):
            if service == "lambda":
                return mock_lambda
            elif service == "s3":
                return mock_s3
            return MagicMock()

        mock_boto3.client.side_effect = client_factory

        result = seed_user_config("user-test-1")

        assert result["success"] is True
        assert "seeded successfully" in result["message"]
        assert result["failures"] == []

        # Verify Lambda was created
        mock_lambda.create_function.assert_called_once()
        create_args = mock_lambda.create_function.call_args
        assert create_args.kwargs["FunctionName"] == "AgentCoreGatewayTool-Pathfinder"

        # Verify DynamoDB writes (LAMBDA, SUBAGENT, SUPERVISOR, VERSION)
        assert mock_table.put_item.call_count >= 4

    @patch.dict(os.environ, {
        "AGENT_CONFIG_BUCKET": "test-bucket",
        "AGENT_CONFIG_PREFIX": "agent-config/",
        "AGENT_CONFIGURATIONS_TABLE": "TestTable",
        "LAMBDA_TOOL_ROLE_ARN": "arn:aws:iam::123456789012:role/TestRole",
    })
    @patch("config_seeder.load_seed_config")
    @patch("config_seeder.boto3")
    def test_partial_failure_continues(self, mock_boto3, mock_load):
        """Test that Lambda creation failure doesn't block sub-agent/supervisor seeding."""
        mock_load.return_value = VALID_CONFIG

        mock_table = MagicMock()
        mock_dynamodb = MagicMock()
        mock_dynamodb.Table.return_value = mock_table
        mock_boto3.resource.return_value = mock_dynamodb

        # Lambda client fails on create
        mock_lambda = MagicMock()
        mock_lambda.exceptions = MagicMock()
        mock_lambda.exceptions.ResourceNotFoundException = type("ResourceNotFoundException", (Exception,), {})
        mock_lambda.get_function.side_effect = mock_lambda.exceptions.ResourceNotFoundException()
        mock_lambda.create_function.side_effect = Exception("Role not ready")

        mock_s3 = MagicMock()
        mock_s3.list_objects_v2.return_value = {
            "Contents": [{"Key": "agent-config/tools/Pathfinder/lambda_handler.py"}]
        }
        mock_s3.get_object.return_value = {
            "Body": io.BytesIO(b"def lambda_handler(e, c): pass")
        }

        def client_factory(service):
            if service == "lambda":
                return mock_lambda
            elif service == "s3":
                return mock_s3
            return MagicMock()

        mock_boto3.client.side_effect = client_factory

        result = seed_user_config("user-test-2")

        assert result["success"] is True
        assert len(result["failures"]) > 0
        assert "AgentCoreGatewayTool-Pathfinder" in result["failures"][0]

        # Supervisor and sub-agent should still be written
        put_calls = mock_table.put_item.call_args_list
        sks_written = [call.kwargs["Item"]["sk"] for call in put_calls if "Item" in call.kwargs]
        assert "SUPERVISOR" in sks_written
        # Sub-agent should be written (tool reference will be empty since Lambda failed)
        assert any("SUBAGENT#" in sk for sk in sks_written)

    @patch.dict(os.environ, {
        "AGENT_CONFIG_BUCKET": "test-bucket",
        "AGENT_CONFIG_PREFIX": "agent-config/",
        "AGENT_CONFIGURATIONS_TABLE": "TestTable",
        "LAMBDA_TOOL_ROLE_ARN": "arn:aws:iam::123456789012:role/TestRole",
    })
    @patch("config_seeder.load_seed_config")
    @patch("config_seeder.boto3")
    def test_idempotency_no_duplicates(self, mock_boto3, mock_load):
        """Test that calling seed twice doesn't create duplicates (ConditionExpression)."""
        mock_load.return_value = VALID_CONFIG

        mock_table = MagicMock()
        mock_dynamodb = MagicMock()
        mock_dynamodb.Table.return_value = mock_table
        mock_boto3.resource.return_value = mock_dynamodb

        # Simulate ConditionalCheckFailedException on all put_items (items already exist)
        cond_error = type("ClientError", (Exception,), {
            "response": {"Error": {"Code": "ConditionalCheckFailedException"}}
        })()
        # Make it have the response attribute
        cond_error.response = {"Error": {"Code": "ConditionalCheckFailedException"}}
        mock_table.put_item.side_effect = cond_error

        # Lambda client — function already exists
        mock_lambda = MagicMock()
        mock_lambda.exceptions = MagicMock()
        mock_lambda.exceptions.ResourceNotFoundException = type("ResourceNotFoundException", (Exception,), {})

        mock_s3 = MagicMock()
        mock_s3.list_objects_v2.return_value = {
            "Contents": [{"Key": "agent-config/tools/Pathfinder/lambda_handler.py"}]
        }
        mock_s3.get_object.return_value = {
            "Body": io.BytesIO(b"def lambda_handler(e, c): pass")
        }

        def client_factory(service):
            if service == "lambda":
                return mock_lambda
            elif service == "s3":
                return mock_s3
            return MagicMock()

        mock_boto3.client.side_effect = client_factory

        result = seed_user_config("user-test-3")

        # Should succeed — all "already exists" are handled gracefully
        assert result["success"] is True
        assert result["failures"] == []

    @patch.dict(os.environ, {"AGENT_CONFIG_BUCKET": ""})
    def test_returns_failure_when_no_config(self):
        """Test graceful failure when no config available."""
        config_seeder._cached_config = None
        result = seed_user_config("user-no-config")
        assert result["success"] is False
        assert "No seed config available" in result["message"]

    @patch.dict(os.environ, {
        "AGENT_CONFIG_BUCKET": "test-bucket",
        "AGENT_CONFIG_PREFIX": "agent-config/",
        "AGENT_CONFIGURATIONS_TABLE": "",
    })
    @patch("config_seeder.load_seed_config")
    def test_returns_failure_when_no_table(self, mock_load):
        """Test failure when AGENT_CONFIGURATIONS_TABLE not set."""
        mock_load.return_value = VALID_CONFIG
        result = seed_user_config("user-no-table")
        assert result["success"] is False
        assert "AGENT_CONFIGURATIONS_TABLE not set" in result["message"]


# ============================================================================
# Integration Tests: Memory and Guardrail creation
# ============================================================================


CONFIG_WITH_MEMORY_AND_GUARDRAIL = {
    "supervisor": {
        "name": "Full Agent",
        "systemPrompt": "Orchestrate all.",
        "subAgents": [],
        "tools": [],
        "memory": "GameMemory",
        "guardrail": "SafetyGuard",
    },
    "subAgents": [],
    "tools": [],
    "memory": {
        "name": "GameMemory",
        "description": "Stores game history",
    },
    "guardrail": {
        "name": "SafetyGuard",
        "description": "Content safety",
        "blockedInputMessaging": "Blocked.",
        "blockedOutputsMessaging": "Blocked.",
        "contentFilters": [
            {"type": "VIOLENCE", "inputStrength": "MEDIUM", "outputStrength": "MEDIUM"},
        ],
    },
}


class TestSeedWithMemoryAndGuardrail:
    """Test seeding with memory and guardrail resources."""

    def setup_method(self):
        config_seeder._cached_config = None
        config_seeder._cached_config_etag = None

    @patch.dict(os.environ, {
        "AGENT_CONFIG_BUCKET": "test-bucket",
        "AGENT_CONFIG_PREFIX": "agent-config/",
        "AGENT_CONFIGURATIONS_TABLE": "TestTable",
        "LAMBDA_TOOL_ROLE_ARN": "arn:aws:iam::123456789012:role/TestRole",
    })
    @patch("config_seeder.load_seed_config")
    @patch("config_seeder.boto3")
    def test_memory_creation_failure_continues(self, mock_boto3, mock_load):
        """Test that memory failure doesn't block rest of seeding."""
        mock_load.return_value = CONFIG_WITH_MEMORY_AND_GUARDRAIL

        mock_table = MagicMock()
        mock_dynamodb = MagicMock()
        mock_dynamodb.Table.return_value = mock_table
        mock_boto3.resource.return_value = mock_dynamodb

        # AgentCore client fails
        mock_agentcore = MagicMock()
        mock_agentcore.create_memory.side_effect = Exception("AgentCore unavailable")

        # Bedrock client succeeds for guardrail
        mock_bedrock = MagicMock()
        mock_bedrock.create_guardrail.return_value = {"guardrailId": "gr-123", "status": "READY"}
        mock_bedrock.get_guardrail.return_value = {
            "blockedInputMessaging": "Blocked.",
            "blockedOutputsMessaging": "Blocked.",
            "contentPolicy": {},
            "topicPolicy": {},
        }

        def client_factory(service):
            if service == "bedrock-agentcore-control":
                return mock_agentcore
            elif service == "bedrock":
                return mock_bedrock
            return MagicMock()

        mock_boto3.client.side_effect = client_factory

        result = seed_user_config("user-mem-fail")

        assert result["success"] is True
        assert any("memory" in f.lower() for f in result["failures"])

        # Guardrail should still be written
        put_calls = mock_table.put_item.call_args_list
        sks = [call.kwargs["Item"]["sk"] for call in put_calls if "Item" in call.kwargs]
        assert any("GUARDRAIL#" in sk for sk in sks)

    @patch.dict(os.environ, {
        "AGENT_CONFIG_BUCKET": "test-bucket",
        "AGENT_CONFIG_PREFIX": "agent-config/",
        "AGENT_CONFIGURATIONS_TABLE": "TestTable",
        "LAMBDA_TOOL_ROLE_ARN": "arn:aws:iam::123456789012:role/TestRole",
    })
    @patch("config_seeder.load_seed_config")
    @patch("config_seeder.boto3")
    def test_guardrail_creation_failure_continues(self, mock_boto3, mock_load):
        """Test that guardrail failure doesn't block supervisor seeding."""
        mock_load.return_value = CONFIG_WITH_MEMORY_AND_GUARDRAIL

        mock_table = MagicMock()
        mock_dynamodb = MagicMock()
        mock_dynamodb.Table.return_value = mock_table
        mock_boto3.resource.return_value = mock_dynamodb

        # AgentCore succeeds for memory
        mock_agentcore = MagicMock()
        mock_agentcore.create_memory.return_value = {"memoryId": "mem-123", "status": "ACTIVE"}

        # Bedrock fails for guardrail
        mock_bedrock = MagicMock()
        mock_bedrock.create_guardrail.side_effect = Exception("Bedrock quota exceeded")

        def client_factory(service):
            if service == "bedrock-agentcore-control":
                return mock_agentcore
            elif service == "bedrock":
                return mock_bedrock
            return MagicMock()

        mock_boto3.client.side_effect = client_factory

        result = seed_user_config("user-gr-fail")

        assert result["success"] is True
        assert any("guardrail" in f.lower() for f in result["failures"])

        # Supervisor should still be written (with memory but no guardrail)
        put_calls = mock_table.put_item.call_args_list
        supervisor_calls = [
            call for call in put_calls
            if "Item" in call.kwargs and call.kwargs["Item"].get("sk") == "SUPERVISOR"
        ]
        assert len(supervisor_calls) == 1
        sup_item = supervisor_calls[0].kwargs["Item"]
        assert sup_item["memoryTool"] is not None  # memory succeeded
        assert sup_item["guardrailTool"] is None  # guardrail failed
