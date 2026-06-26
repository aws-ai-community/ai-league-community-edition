"""Property-based tests for agent configuration round-trips.

Uses hypothesis with mocked DynamoDB (moto) to verify correctness properties
of supervisor agent, sub-agent, and Lambda tool CRUD handlers.

**Validates: Requirements 3.1, 3.2, 4.1, 4.4, 4.5, 5.1, 5.2**
"""

import os
import sys

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
# Property 2: Supervisor Agent Configuration Round-Trip
# **Validates: Requirements 3.1, 3.2**
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
@settings(max_examples=100, deadline=None)
def test_property_2_supervisor_agent_round_trip(
    name, system_prompt, model_id, sub_agents, lambda_tools, memory_tool, guardrail_tool
):
    """**Validates: Requirements 3.1, 3.2**

    For any valid supervisor agent configuration, saving via
    handle_update_supervisor_agent and then reading via
    handle_get_supervisor_agent SHALL produce a configuration
    equivalent to the original input.
    """
    with mock_aws():
        _create_table_and_patch()

        user_id = "test-user-prop2"
        event = _make_event(user_id)

        # Save the supervisor config
        arguments = {
            "name": name,
            "systemPrompt": system_prompt,
            "modelId": model_id,
            "subAgents": sub_agents,
            "lambdaTools": lambda_tools,
            "memoryTool": memory_tool,
            "guardrailTool": guardrail_tool,
        }
        save_result = agent_config_handlers.handle_update_supervisor_agent(arguments, event)
        assert save_result.get("name") == name, f"Save failed: {save_result}"

        # Read back the supervisor config
        read_result = agent_config_handlers.handle_get_supervisor_agent({}, event)

        # Verify field equivalence
        assert read_result["name"] == name
        assert read_result["systemPrompt"] == system_prompt
        assert read_result["modelId"] == model_id
        assert read_result["subAgents"] == sub_agents
        assert read_result["lambdaTools"] == lambda_tools
        assert read_result["memoryTool"] == memory_tool
        assert read_result["guardrailTool"] == guardrail_tool


# ---------------------------------------------------------------------------
# Property 3: Sub-Agent Configuration Round-Trip
# **Validates: Requirements 4.1, 4.5**
# ---------------------------------------------------------------------------


@given(
    name=safe_text,
    system_prompt=safe_text,
    model_id=st.sampled_from(ALLOWED_MODELS),
    lambda_tools=id_list,
)
@settings(max_examples=100, deadline=None)
def test_property_3_sub_agent_round_trip(name, system_prompt, model_id, lambda_tools):
    """**Validates: Requirements 4.1, 4.5**

    For any valid sub-agent configuration, creating via handle_create_sub_agent
    and then reading via handle_get_sub_agent with the returned agentId SHALL
    produce a configuration with fields equivalent to the original input.
    """
    with mock_aws():
        _create_table_and_patch()

        user_id = "test-user-prop3"
        event = _make_event(user_id)

        # Create the sub-agent
        arguments = {
            "name": name,
            "systemPrompt": system_prompt,
            "modelId": model_id,
            "lambdaTools": lambda_tools,
        }
        create_result = agent_config_handlers.handle_create_sub_agent(arguments, event)
        assert create_result.get("agentId") is not None, f"Create failed: {create_result}"

        agent_id = create_result["agentId"]
        assert agent_id is not None and len(agent_id) > 0

        # Read back the sub-agent by agentId
        read_result = agent_config_handlers.handle_get_sub_agent({"agentId": agent_id}, event)

        # Verify field equivalence
        assert read_result["agentId"] == agent_id
        assert read_result["name"] == name
        assert read_result["systemPrompt"] == system_prompt
        assert read_result["modelId"] == model_id
        assert read_result["lambdaTools"] == lambda_tools


# ---------------------------------------------------------------------------
# Property 4: Sub-Agent List Completeness
# **Validates: Requirements 4.4**
# ---------------------------------------------------------------------------


@given(
    configs=st.lists(
        st.fixed_dictionaries({
            "name": safe_text,
            "systemPrompt": safe_text,
            "modelId": st.sampled_from(ALLOWED_MODELS),
            "lambdaTools": id_list,
        }),
        min_size=1,
        max_size=10,
    )
)
@settings(max_examples=100, deadline=None)
def test_property_4_sub_agent_list_completeness(configs):
    """**Validates: Requirements 4.4**

    For any set of N sub-agents created for a user, calling
    handle_list_sub_agents SHALL return exactly N sub-agents, and the set
    of returned agentIds SHALL equal the set of agentIds returned during creation.
    """
    with mock_aws():
        _create_table_and_patch()

        user_id = "test-user-prop4"
        event = _make_event(user_id)

        # Create N sub-agents and collect their agentIds
        created_agent_ids = set()
        for config in configs:
            create_result = agent_config_handlers.handle_create_sub_agent(config, event)
            assert create_result.get("agentId") is not None, f"Create failed: {create_result}"
            created_agent_ids.add(create_result["agentId"])

        # List all sub-agents
        list_result = agent_config_handlers.handle_list_sub_agents({}, event)

        # Verify exactly N sub-agents returned
        assert len(list_result) == len(configs), (
            f"Expected {len(configs)} sub-agents, got {len(list_result)}"
        )

        # Verify agentId sets match
        listed_agent_ids = {item["agentId"] for item in list_result}
        assert listed_agent_ids == created_agent_ids, (
            f"AgentId mismatch: created={created_agent_ids}, listed={listed_agent_ids}"
        )


# ---------------------------------------------------------------------------
# Property 5: Lambda Tool Registration Round-Trip
# **Validates: Requirements 5.1, 5.2**
# NOTE: Updated to use handle_create_lambda_tool (replaces handle_update_lambda_tool)
# ---------------------------------------------------------------------------


@given(
    name=st.from_regex(r"[A-Za-z][A-Za-z0-9_-]{0,30}", fullmatch=True),
)
@settings(max_examples=100, deadline=None)
def test_property_5_lambda_tool_round_trip(name):
    """**Validates: Requirements 5.1, 5.2**

    For any valid Lambda tool name, creating via handle_create_lambda_tool
    and then listing via handle_list_lambda_tool SHALL include a tool with
    matching name and functionName = AgentCoreGatewayTool-{name}.
    """
    with mock_aws():
        _create_table_and_patch()

        user_id = "test-user-prop5"
        event = _make_event(user_id)

        # Create the IAM role that Lambda can assume (required by moto)
        import json as _json
        iam_client = boto3.client("iam", region_name="us-east-1")
        assume_role_policy = _json.dumps({
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }]
        })
        role_response = iam_client.create_role(
            RoleName="LambdaToolRole",
            AssumeRolePolicyDocument=assume_role_policy,
            Path="/",
        )
        role_arn = role_response["Role"]["Arn"]

        # Set up required env var for LAMBDA_TOOL_ROLE_ARN
        old_role_arn = os.environ.get("LAMBDA_TOOL_ROLE_ARN")
        os.environ["LAMBDA_TOOL_ROLE_ARN"] = role_arn

        try:
            # Create the Lambda tool (moto mocks the Lambda service)
            arguments = {"name": name}
            create_result = agent_config_handlers.handle_create_lambda_tool(arguments, event)
            assert create_result.get("toolId") is not None, f"Create failed: {create_result}"
            assert create_result.get("functionName") == f"AgentCoreGatewayTool-{name}"

            # List Lambda tools
            list_result = agent_config_handlers.handle_list_lambda_tool({}, event)

            # Verify the created tool appears in the list with matching fields
            matching_tools = [
                tool for tool in list_result
                if tool["name"] == name and tool["functionName"] == f"AgentCoreGatewayTool-{name}"
            ]
            assert len(matching_tools) >= 1, (
                f"Expected tool with name='{name}' and functionName='AgentCoreGatewayTool-{name}' "
                f"in list result. Got: {list_result}"
            )
        finally:
            # Restore env var to avoid leaking state
            if old_role_arn is None:
                del os.environ["LAMBDA_TOOL_ROLE_ARN"]
            else:
                os.environ["LAMBDA_TOOL_ROLE_ARN"] = old_role_arn
