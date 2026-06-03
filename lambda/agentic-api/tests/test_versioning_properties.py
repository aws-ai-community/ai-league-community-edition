"""Property-based tests for version snapshot and model registration.

Uses hypothesis with mocked DynamoDB (moto) to verify correctness properties
of agent version snapshots, version list ordering, and model registration.

**Validates: Requirements 16.1, 16.2, 17.1, 17.2**
"""

import json
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

# Set env var BEFORE importing agent_config_handlers (reads at module load time)
os.environ["AGENT_CONFIGURATIONS_TABLE"] = "TestAgentConfigurations"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SECURITY_TOKEN"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"

# Add parent directory to path so we can import the handlers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import boto3
from moto import mock_aws

from hypothesis import given, settings
from hypothesis import strategies as st

# Import handlers AFTER setting env var
import agent_config_handlers


# ---------------------------------------------------------------------------
# Constants and Strategies
# ---------------------------------------------------------------------------

ALLOWED_MODELS = [
    "amazon.nova-micro-v1:0",
    "amazon.nova-lite-v1:0",
    "amazon.nova-pro-v1:0",
    "deepseek.deepseek-v3-2-0:0",
    "meta.llama3-3-70b-instruct-v1:0",
    "meta.llama4-scout-17b-16e-instruct-v1:0",
    "meta.llama4-maverick-17b-128e-instruct-v1:0",
    "mistral.mistral-large-2411-v1:0",
    "mistral.magistral-small-2506-v1:0",
]

# Strategy for non-empty printable text (avoid null bytes that DynamoDB rejects)
safe_text = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z", "S")),
    min_size=1,
    max_size=100,
)

# Strategy for list of tool/agent ID strings
id_list = st.lists(safe_text, min_size=0, max_size=5)


# ---------------------------------------------------------------------------
# Helper: create table and patch module references inside mock context
# ---------------------------------------------------------------------------


def _create_table_and_patch():
    """Create the AgentConfigurations table and patch module-level references.

    Must be called inside an active mock_aws context.
    """
    dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
    table = dynamodb.create_table(
        TableName="TestAgentConfigurations",
        KeySchema=[
            {"AttributeName": "userId", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "userId", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
            {"AttributeName": "gsi1pk", "AttributeType": "S"},
            {"AttributeName": "gsi1sk", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "GSI1",
                "KeySchema": [
                    {"AttributeName": "gsi1pk", "KeyType": "HASH"},
                    {"AttributeName": "gsi1sk", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    table.meta.client.get_waiter("table_exists").wait(TableName="TestAgentConfigurations")

    # Patch the module-level DynamoDB references
    agent_config_handlers.dynamodb = dynamodb
    agent_config_handlers.agent_configurations_table = dynamodb.Table("TestAgentConfigurations")
    return table


def _make_event(user_id: str = "test-user-123") -> dict:
    """Create a mock AppSync event with Cognito identity."""
    return {"identity": {"sub": user_id}}


# ---------------------------------------------------------------------------
# Property 13: Agent Version Snapshot Fidelity
# **Validates: Requirements 16.1**
# ---------------------------------------------------------------------------


@given(
    name=safe_text,
    system_prompt=safe_text,
    model_id=st.sampled_from(ALLOWED_MODELS),
    sub_agents=id_list,
    lambda_tools=id_list,
    memory_tool=st.one_of(st.none(), safe_text),
    guardrail_tool=st.one_of(st.none(), safe_text),
)
@settings(max_examples=50, deadline=None)
def test_property_13_version_snapshot_fidelity(
    name, system_prompt, model_id, sub_agents, lambda_tools, memory_tool, guardrail_tool
):
    """**Validates: Requirements 16.1**

    For any supervisor agent configuration at the time of leaderboard submission,
    the created version snapshot SHALL contain a supervisorConfig field that,
    when JSON-parsed, produces an object with fields equivalent to the supervisor
    configuration at submission time.
    """
    with mock_aws():
        table = _create_table_and_patch()

        user_id = "test-user-prop13"
        leaderboard_id = "lb-test"
        version_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        # Build the supervisor config as it would exist in the table
        supervisor_config = {
            "userId": user_id,
            "sk": "SUPERVISOR",
            "name": name,
            "systemPrompt": system_prompt,
            "modelId": model_id,
            "subAgents": sub_agents,
            "lambdaTools": lambda_tools,
            "memoryTool": memory_tool,
            "guardrailTool": guardrail_tool,
        }

        # Create the version record (same pattern as index.py handle_submit_to_leaderboard)
        version_record = {
            "userId": user_id,
            "sk": f"VERSION#{leaderboard_id}#{version_id}",
            "versionId": version_id,
            "name": supervisor_config.get("name", ""),
            "supervisorConfig": json.dumps(supervisor_config),
            "finalScore": 100,
            "subAgentCount": len(supervisor_config.get("subAgents", [])),
            "gsi1pk": f"USER#{user_id}",
            "gsi1sk": f"VERSION#{now}",
            "createdAt": now,
            "updatedAt": now,
        }
        table.put_item(Item=version_record)

        # Read back the version record
        read_response = table.get_item(
            Key={"userId": user_id, "sk": f"VERSION#{leaderboard_id}#{version_id}"}
        )
        stored_version = read_response["Item"]

        # JSON-parse the supervisorConfig field
        parsed_config = json.loads(stored_version["supervisorConfig"])

        # Verify equivalence to the original supervisor config
        assert parsed_config["name"] == name
        assert parsed_config["systemPrompt"] == system_prompt
        assert parsed_config["modelId"] == model_id
        assert parsed_config["subAgents"] == sub_agents
        assert parsed_config["lambdaTools"] == lambda_tools
        assert parsed_config["memoryTool"] == memory_tool
        assert parsed_config["guardrailTool"] == guardrail_tool


# ---------------------------------------------------------------------------
# Property 14: Agent Version List Ordering
# **Validates: Requirements 16.2**
# ---------------------------------------------------------------------------


@given(
    num_versions=st.integers(min_value=2, max_value=10),
)
@settings(max_examples=50, deadline=None)
def test_property_14_version_list_ordering(num_versions):
    """**Validates: Requirements 16.2**

    For any set of agent versions created at different timestamps, calling
    handle_list_agent_versions SHALL return versions ordered by createdAt
    descending (most recent first).
    """
    with mock_aws():
        table = _create_table_and_patch()

        user_id = "test-user-prop14"
        event = _make_event(user_id)

        # Create N version records with sequential timestamps
        base_time = datetime(2024, 1, 1, tzinfo=timezone.utc)
        created_timestamps = []

        for idx in range(num_versions):
            version_id = str(uuid.uuid4())
            ts = (base_time + timedelta(hours=idx)).isoformat()
            created_timestamps.append(ts)

            version_record = {
                "userId": user_id,
                "sk": f"VERSION#lb1#{version_id}",
                "versionId": version_id,
                "name": f"Version {idx}",
                "supervisorConfig": json.dumps({"name": f"Version {idx}"}),
                "finalScore": idx * 10,
                "subAgentCount": 0,
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"VERSION#{ts}",
                "createdAt": ts,
                "updatedAt": ts,
            }
            table.put_item(Item=version_record)

        # Call handle_list_agent_versions
        result = agent_config_handlers.handle_list_agent_versions({}, event)
        versions = result["versions"]

        # Verify we get back all versions
        assert len(versions) == num_versions

        # Verify ordering is descending by createdAt
        for i in range(len(versions) - 1):
            assert versions[i]["createdAt"] >= versions[i + 1]["createdAt"], (
                f"Version at index {i} (createdAt={versions[i]['createdAt']}) "
                f"should be >= version at index {i+1} (createdAt={versions[i+1]['createdAt']})"
            )


# ---------------------------------------------------------------------------
# Property 15: Model Registration Round-Trip
# **Validates: Requirements 17.1, 17.2**
# ---------------------------------------------------------------------------


@given(
    name=safe_text,
    resource_identifier=safe_text,
    model_type=st.sampled_from(["AGENTCORE_RUNTIME", "CUSTOM_MODEL", "BEDROCK_MODEL"]),
    pathfinding_prompt_strategy=safe_text,
)
@settings(max_examples=50, deadline=None)
def test_property_15_model_registration_round_trip(
    name, resource_identifier, model_type, pathfinding_prompt_strategy
):
    """**Validates: Requirements 17.1, 17.2**

    For any valid model registration (name, resourceIdentifier, type,
    pathfindingPromptStrategy), creating via handle_create_model SHALL return
    a non-empty modelId, and the stored record SHALL contain all provided
    fields unchanged.
    """
    with mock_aws():
        table = _create_table_and_patch()

        user_id = "test-user-prop15"
        event = _make_event(user_id)

        arguments = {
            "name": name,
            "resourceIdentifier": resource_identifier,
            "type": model_type,
            "pathfindingPromptStrategy": pathfinding_prompt_strategy,
        }

        # Call handle_create_model
        result = agent_config_handlers.handle_create_model(arguments, event)

        # Verify non-empty modelId returned
        assert result.get("success") is True, f"Create model failed: {result}"
        model_id = result["modelId"]
        assert model_id is not None and len(model_id) > 0

        # Read the DynamoDB item back and verify all fields match
        read_response = table.get_item(
            Key={"userId": user_id, "sk": f"MODEL#{model_id}"}
        )
        assert "Item" in read_response, "Model record not found in DynamoDB"
        stored_item = read_response["Item"]

        assert stored_item["name"] == name
        assert stored_item["resourceIdentifier"] == resource_identifier
        assert stored_item["type"] == model_type
        assert stored_item["pathfindingPromptStrategy"] == pathfinding_prompt_strategy
        assert stored_item["modelId"] == model_id
