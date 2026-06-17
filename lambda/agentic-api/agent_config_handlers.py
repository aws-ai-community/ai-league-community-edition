"""Agent Configuration CRUD Handlers.

Ported from reference implementation (index.py handler pattern).
Uses single-table design on AgentConfigurations table.

SK Patterns:
- SUPERVISOR: Supervisor agent config
- SUBAGENT#{agentId}: Sub-agent config
- LAMBDA#{toolId}: Lambda tool registration
- MEMORY#{toolId}: Memory tool reference
- GUARDRAIL#{toolId}: Guardrail tool reference
- MODEL#{modelId}: Registered model entry
- VERSION#{leaderboardId}#{versionId}: Agent version snapshot
- RUNTIME: AgentCore Runtime reference

Requirements: 1.6, 1.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
"""

import json
import os
import uuid
import logging
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _get_required_env(name: str) -> str:
    """Get a required environment variable or fail fast with a clear error."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"Ensure the Lambda function is configured with all required table name variables."
        )
    return value


# Fail fast on cold start if required env var is missing
AGENT_CONFIGURATIONS_TABLE = _get_required_env("AGENT_CONFIGURATIONS_TABLE")

# DynamoDB resource and table reference
dynamodb = boto3.resource("dynamodb")
agent_configurations_table = dynamodb.Table(AGENT_CONFIGURATIONS_TABLE)


DEFAULT_SUPERVISOR_CONFIG = {
    "agentId": None,
    "name": "My Agent",
    "systemPrompt": (
        "You are the Dungeon Game Orchestrator, coordinating specialist agents.\n\n"
        "SPECIALIST AGENTS AVAILABLE:\n"
        "**Pathfinding Specialist** - Use for all pathfinding/navigation tasks\n\n"
        "DELEGATION RULES:\n"
        "1. **Pathfinding Tasks**: Always delegate to Pathfinding_Specialist\n"
        "   - Pass the ENTIRE user input verbatim as the prompt\n"
        "   - Do NOT summarize, shorten, or reformat the input\n"
        "   - Return ONLY the path array from the specialist result\n\n"
        "2. **Simple Tasks**: Handle directly (basic math, quick facts)\n\n"
        "RESPONSE FORMAT:\n"
        "- For pathfinding: Return ONLY the path array like [\"right\",\"down\",\"left\"]\n"
        "- No explanations, no thinking tags, no other text"
    ),
    "modelId": "amazon.nova-lite-v1:0",
    "subAgents": [],
    "lambdaTools": [],
    "memoryTool": None,
    "guardrailTool": None,
}

# Default pathfinder sub-agent — seeded on first access
DEFAULT_PATHFINDER_SUBAGENT_ID = "pathfinder-specialist-default"
DEFAULT_PATHFINDER_SUBAGENT = {
    "agentId": DEFAULT_PATHFINDER_SUBAGENT_ID,
    "name": "Pathfinding Specialist",
    "systemPrompt": (
        "You are the Pathfinding Specialist.\n\n"
        "CRITICAL RULES:\n"
        "1. Call the pathfinding tool with:\n"
        "   - game_map: The grid JSON array from the input (the 2D array of cells like [[\"normal\",\"wall\",...],...])\n"
        "   - start_pos: Extract from the prompt text. \"A1\" means [0,0], \"B2\" means [1,1]. Format: column letter (A=col0, B=col1...) + row number (1=row0, 2=row1...). Pass as JSON string like \"[0,0]\"\n"
        "   - strategy: Extract from user prompt (\"swift\" or \"get_coins\") or default to \"swift\"\n"
        "2. Return ONLY the path array from the tool result\n"
        "3. NO explanations, NO text, just the JSON array\n\n"
        "RESPONSE FORMAT: Only output the path array like [\"right\",\"down\",\"left\"]"
    ),
    "modelId": "amazon.nova-lite-v1:0",
    "lambdaTools": ["pathfinder-default"],
}


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _get_user_id(event: dict) -> str:
    """Extract user identity from AppSync event.

    For Cognito auth: event['identity']['sub'] contains the Cognito user ID.
    For API Key auth: event['identity'] is None → return "anonymous".
    """
    identity = event.get("identity")
    if identity is None:
        return "anonymous"
    # Cognito identity has 'sub' claim
    sub = identity.get("sub")
    if sub:
        return sub
    # Fallback for other identity types
    return identity.get("username", "anonymous")


def handle_get_supervisor_agent(arguments: dict, event: dict) -> dict:
    """Get supervisor config or return default if none exists.

    Reads from AgentConfigurations table by (userId, sk="SUPERVISOR").
    If not found, seeds the default supervisor config AND a default Pathfinding
    Specialist sub-agent, then returns the seeded config.

    Requirements: 3.2, 3.8
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "SUPERVISOR"}
        )
    except Exception as e:
        logger.error(f"Error loading supervisor config for user {user_id}: {e}")
        # Return default on error so the UI is still functional
        return {**DEFAULT_SUPERVISOR_CONFIG, "userId": user_id, "subAgents": [DEFAULT_PATHFINDER_SUBAGENT_ID]}

    item = response.get("Item")
    if not item:
        # First access — seed default pathfinder sub-agent and supervisor config
        _seed_defaults_for_user(user_id)
        return {
            **DEFAULT_SUPERVISOR_CONFIG,
            "userId": user_id,
            "subAgents": [DEFAULT_PATHFINDER_SUBAGENT_ID],
        }

    return {
        "agentId": item.get("agentId"),
        "userId": item.get("userId"),
        "name": item.get("name"),
        "systemPrompt": item.get("systemPrompt"),
        "modelId": item.get("modelId"),
        "subAgents": item.get("subAgents", []),
        "lambdaTools": item.get("lambdaTools", []),
        "memoryTool": item.get("memoryTool"),
        "guardrailTool": item.get("guardrailTool"),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


def _seed_defaults_for_user(user_id: str) -> None:
    """Seed the default Pathfinding Specialist sub-agent and supervisor config for a new user.

    Creates both items in DynamoDB so they appear in the UI on first load.
    """
    now = _now_iso()

    # Seed the default Pathfinding Specialist sub-agent
    try:
        agent_configurations_table.put_item(
            Item={
                "userId": user_id,
                "sk": f"SUBAGENT#{DEFAULT_PATHFINDER_SUBAGENT_ID}",
                "agentId": DEFAULT_PATHFINDER_SUBAGENT_ID,
                "name": DEFAULT_PATHFINDER_SUBAGENT["name"],
                "systemPrompt": DEFAULT_PATHFINDER_SUBAGENT["systemPrompt"],
                "modelId": DEFAULT_PATHFINDER_SUBAGENT["modelId"],
                "lambdaTools": DEFAULT_PATHFINDER_SUBAGENT["lambdaTools"],
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"SUBAGENT#{now}",
                "createdAt": now,
                "updatedAt": now,
            },
            ConditionExpression="attribute_not_exists(sk)",
        )
    except Exception as e:
        # ConditionalCheckFailed means it already exists — that's fine
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code != "ConditionalCheckFailedException":
            logger.warning(f"Failed to seed default pathfinder sub-agent for {user_id}: {e}")

    # Seed the default Lambda tool record for pathfinder
    try:
        agent_configurations_table.put_item(
            Item={
                "userId": user_id,
                "sk": "LAMBDA#pathfinder-default",
                "toolId": "pathfinder-default",
                "name": "Pathfinder",
                "functionName": "AgentCoreGatewayTool-Pathfinder",
                "runtime": "python3.12",
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"LAMBDA#{now}",
                "createdAt": now,
                "updatedAt": now,
            },
            ConditionExpression="attribute_not_exists(sk)",
        )
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code != "ConditionalCheckFailedException":
            logger.warning(f"Failed to seed default Lambda tool for {user_id}: {e}")

    # Seed the default supervisor config with pathfinder sub-agent attached
    try:
        agent_configurations_table.put_item(
            Item={
                "userId": user_id,
                "sk": "SUPERVISOR",
                "name": DEFAULT_SUPERVISOR_CONFIG["name"],
                "systemPrompt": DEFAULT_SUPERVISOR_CONFIG["systemPrompt"],
                "modelId": DEFAULT_SUPERVISOR_CONFIG["modelId"],
                "subAgents": [DEFAULT_PATHFINDER_SUBAGENT_ID],
                "lambdaTools": DEFAULT_SUPERVISOR_CONFIG["lambdaTools"],
                "memoryTool": None,
                "guardrailTool": None,
                "createdAt": now,
                "updatedAt": now,
            },
            ConditionExpression="attribute_not_exists(sk)",
        )
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code != "ConditionalCheckFailedException":
            logger.warning(f"Failed to seed default supervisor config for {user_id}: {e}")

    # Seed a VERSION record as the "Initial Configuration" snapshot
    try:
        initial_supervisor_config = {
            "name": DEFAULT_SUPERVISOR_CONFIG["name"],
            "systemPrompt": DEFAULT_SUPERVISOR_CONFIG["systemPrompt"],
            "modelId": DEFAULT_SUPERVISOR_CONFIG["modelId"],
            "subAgents": [DEFAULT_PATHFINDER_SUBAGENT_ID],
            "lambdaTools": DEFAULT_SUPERVISOR_CONFIG["lambdaTools"],
            "memoryTool": None,
            "guardrailTool": None,
        }
        agent_configurations_table.put_item(
            Item={
                "userId": user_id,
                "sk": f"VERSION#default#{DEFAULT_PATHFINDER_SUBAGENT_ID}",
                "versionId": "initial",
                "name": "Initial Configuration",
                "supervisorConfig": json.dumps(initial_supervisor_config),
                "finalScore": 0,
                "subAgentCount": 1,
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"VERSION#{now}",
                "createdAt": now,
                "updatedAt": now,
            },
            ConditionExpression="attribute_not_exists(sk)",
        )
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code != "ConditionalCheckFailedException":
            logger.warning(f"Failed to seed initial version for {user_id}: {e}")


def handle_update_supervisor_agent(arguments: dict, event: dict) -> dict:
    """Upsert supervisor configuration.

    Writes to AgentConfigurations table with (userId, sk="SUPERVISOR").
    Accepts: name, systemPrompt, modelId, subAgents, lambdaTools,
    memoryTool, guardrailTool.

    Requirements: 3.1, 3.3, 3.4, 3.5, 3.6, 3.7
    """
    user_id = _get_user_id(event)
    now = _now_iso()

    # Extract input fields from arguments
    name = arguments.get("name", DEFAULT_SUPERVISOR_CONFIG["name"])
    system_prompt = arguments.get("systemPrompt", DEFAULT_SUPERVISOR_CONFIG["systemPrompt"])
    model_id = arguments.get("modelId", DEFAULT_SUPERVISOR_CONFIG["modelId"])
    sub_agents = arguments.get("subAgents", [])
    lambda_tools = arguments.get("lambdaTools", DEFAULT_SUPERVISOR_CONFIG["lambdaTools"])
    memory_tool = arguments.get("memoryTool")
    guardrail_tool = arguments.get("guardrailTool")

    item = {
        "userId": user_id,
        "sk": "SUPERVISOR",
        "name": name,
        "systemPrompt": system_prompt,
        "modelId": model_id,
        "subAgents": sub_agents,
        "lambdaTools": lambda_tools,
        "memoryTool": memory_tool,
        "guardrailTool": guardrail_tool,
        "updatedAt": now,
    }

    try:
        # Check if item already exists (to preserve createdAt)
        existing = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "SUPERVISOR"}
        ).get("Item")

        if existing:
            item["createdAt"] = existing.get("createdAt", now)
        else:
            item["createdAt"] = now

        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error(f"Error saving supervisor config for user {user_id}: {e}")
        raise Exception(f"Failed to save supervisor config: {e}")

    return {
        "agentId": None,
        "userId": user_id,
        "name": name,
        "systemPrompt": system_prompt,
        "modelId": model_id,
        "subAgents": sub_agents,
        "lambdaTools": lambda_tools,
        "memoryTool": memory_tool,
        "guardrailTool": guardrail_tool,
        "createdAt": item.get("createdAt", now),
        "updatedAt": now,
    }


# ---------------------------------------------------------------------------
# AgentCore Runtime Provisioning
# ---------------------------------------------------------------------------

# Pre-configured runtime ARN from environment (CDK-provisioned, shared by all users)
AGENT_RUNTIME_ARN = os.environ.get("AGENT_RUNTIME_ARN", "")


def handle_get_agent_core_runtime(arguments: dict, event: dict) -> dict:
    """Get the CDK-provisioned AgentCore Runtime for the authenticated user.

    Resolution order:
    1. Check DynamoDB for a stored RUNTIME record for this user → return if found.
    2. Check AGENT_RUNTIME_ARN env var (CDK-provisioned shared runtime).
       If set, store it in DynamoDB and return it.
    3. If neither: return error asking the admin to redeploy the stack.

    Requirements: 2.1, 2.2, 2.3, 2.5, 2.6
    """
    user_id = _get_user_id(event)

    # Step 1: Check if runtime already exists in DynamoDB
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "RUNTIME"}
        )
    except Exception as e:
        logger.error(f"Error checking runtime for user {user_id}: {e}")
        return {"runtimeArn": None, "status": "ERROR", "message": f"Failed to check runtime: {e}"}

    item = response.get("Item")
    if item and item.get("runtimeArn"):
        # Runtime already stored
        return {
            "runtimeArn": item.get("runtimeArn"),
            "status": "READY",
            "message": "",
        }

    # Step 2: Check AGENT_RUNTIME_ARN env var (CDK-provisioned shared runtime)
    if AGENT_RUNTIME_ARN:
        now = _now_iso()
        try:
            agent_configurations_table.put_item(Item={
                "userId": user_id,
                "sk": "RUNTIME",
                "runtimeArn": AGENT_RUNTIME_ARN,
                "status": "READY",
                "source": "cdk_provisioned",
                "createdAt": now,
                "updatedAt": now,
            })
        except Exception as e:
            logger.warning(f"Failed to store env runtime ARN for user {user_id}: {e}")

        return {
            "runtimeArn": AGENT_RUNTIME_ARN,
            "status": "READY",
            "message": "Using CDK-provisioned runtime",
        }

    # Step 3: Neither DynamoDB nor env var has a runtime
    return {
        "runtimeArn": None,
        "status": "NOT_CONFIGURED",
        "message": (
            "AgentCore Runtime not configured. Please redeploy the stack."
        ),
    }


# ---------------------------------------------------------------------------
# Model Registration
# ---------------------------------------------------------------------------


def handle_create_model(arguments: dict, event: dict) -> dict:
    """Register a model entry for leaderboard submission.

    Creates a MODEL record in AgentConfigurations table capturing the user's
    runtime ARN reference and pathfinding strategy.

    Requirements: 17.1, 17.2
    """
    user_id = _get_user_id(event)
    now = _now_iso()

    model_id = str(uuid.uuid4())
    name = arguments.get("name", "")
    resource_identifier = arguments.get("resourceIdentifier", "")
    model_type = arguments.get("type", "AGENTCORE_RUNTIME")
    pathfinding_prompt_strategy = arguments.get("pathfindingPromptStrategy", "")

    item = {
        "userId": user_id,
        "sk": f"MODEL#{model_id}",
        "modelId": model_id,
        "name": name,
        "resourceIdentifier": resource_identifier,
        "type": model_type,
        "pathfindingPromptStrategy": pathfinding_prompt_strategy,
        "createdAt": now,
        "updatedAt": now,
        # GSI1 keys for efficient listing
        "gsi1pk": f"USER#{user_id}",
        "gsi1sk": f"MODEL#{now}",
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error(f"Error creating model for user {user_id}: {e}")
        return {"modelId": None, "success": False, "message": f"Failed to register model: {e}"}

    return {"modelId": model_id, "success": True, "message": "Model registered"}


# ---------------------------------------------------------------------------
# Agent Version Listing
# ---------------------------------------------------------------------------


def handle_list_agent_versions(arguments: dict, event: dict) -> dict:
    """List agent version snapshots for the authenticated user.

    Queries GSI1 with gsi1pk="USER#{userId}" and gsi1sk begins_with "VERSION#",
    sorted by createdAt descending.

    Requirements: 16.2, 16.3
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression=(
                Key("gsi1pk").eq(f"USER#{user_id}")
                & Key("gsi1sk").begins_with("VERSION#")
            ),
            ScanIndexForward=False,  # Descending order (most recent first)
        )
    except Exception as e:
        logger.error(f"Error listing agent versions for user {user_id}: {e}")
        return []

    items = response.get("Items", [])

    # Sort by createdAt descending as a safeguard (GSI1 sort key is timestamp-based)
    items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)

    versions = []
    for item in items:
        versions.append({
            "versionId": item.get("versionId"),
            "userId": item.get("userId"),
            "name": item.get("name"),
            "supervisorConfig": item.get("supervisorConfig"),
            "finalScore": item.get("finalScore"),
            "subAgentCount": item.get("subAgentCount"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        })

    return versions


# ---------------------------------------------------------------------------
# Sub-Agent CRUD Handlers
# Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
# ---------------------------------------------------------------------------

def handle_create_sub_agent(arguments: dict, event: dict) -> dict:
    """Create a new sub-agent with a generated agentId.

    Stores item with sk="SUBAGENT#{agentId}" and GSI1 keys for efficient listing.
    Fields: name, systemPrompt, modelId, lambdaTools.

    Requirements: 4.1, 4.6, 4.7, 4.8
    """
    user_id = _get_user_id(event)
    now = _now_iso()
    agent_id = str(uuid.uuid4())

    name = arguments.get("name", "")
    system_prompt = arguments.get("systemPrompt", "")
    model_id = arguments.get("modelId", "amazon.nova-lite-v1:0")
    lambda_tools = arguments.get("lambdaTools", [])

    item = {
        "userId": user_id,
        "sk": f"SUBAGENT#{agent_id}",
        "agentId": agent_id,
        "name": name,
        "systemPrompt": system_prompt,
        "modelId": model_id,
        "lambdaTools": lambda_tools,
        "gsi1pk": f"USER#{user_id}",
        "gsi1sk": f"SUBAGENT#{now}",
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error(f"Error creating sub-agent for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to create sub-agent: {e}"}

    return {
        "success": True,
        "statusCode": 200,
        "agentId": agent_id,
        "message": "Sub-agent created successfully",
    }


def handle_update_sub_agent(arguments: dict, event: dict) -> dict:
    """Update an existing sub-agent by agentId.

    Updates name, systemPrompt, modelId, and lambdaTools fields.
    Uses update_item to preserve existing fields not being updated.

    Requirements: 4.2, 4.6, 4.7
    """
    user_id = _get_user_id(event)
    now = _now_iso()
    agent_id = arguments.get("agentId")

    if not agent_id:
        return {"success": False, "statusCode": 400, "message": "agentId is required"}

    # Build update expression dynamically from provided fields
    update_parts = []
    expression_values = {}
    expression_names = {}

    if "name" in arguments:
        update_parts.append("#n = :name")
        expression_values[":name"] = arguments["name"]
        expression_names["#n"] = "name"

    if "systemPrompt" in arguments:
        update_parts.append("systemPrompt = :systemPrompt")
        expression_values[":systemPrompt"] = arguments["systemPrompt"]

    if "modelId" in arguments:
        update_parts.append("modelId = :modelId")
        expression_values[":modelId"] = arguments["modelId"]

    if "lambdaTools" in arguments:
        update_parts.append("lambdaTools = :lambdaTools")
        expression_values[":lambdaTools"] = arguments["lambdaTools"]

    # Always update updatedAt
    update_parts.append("updatedAt = :updatedAt")
    expression_values[":updatedAt"] = now

    if not update_parts:
        return {"success": False, "statusCode": 400, "message": "No fields to update"}

    update_expression = "SET " + ", ".join(update_parts)

    try:
        kwargs = {
            "Key": {"userId": user_id, "sk": f"SUBAGENT#{agent_id}"},
            "UpdateExpression": update_expression,
            "ExpressionAttributeValues": expression_values,
            "ConditionExpression": "attribute_exists(sk)",
            "ReturnValues": "ALL_NEW",
        }
        if expression_names:
            kwargs["ExpressionAttributeNames"] = expression_names

        response = agent_configurations_table.update_item(**kwargs)
    except agent_configurations_table.meta.client.exceptions.ConditionalCheckFailedException:
        return {"success": False, "statusCode": 404, "message": f"Sub-agent {agent_id} not found"}
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code == "ConditionalCheckFailedException":
            return {"success": False, "statusCode": 404, "message": f"Sub-agent {agent_id} not found"}
        logger.error(f"Error updating sub-agent {agent_id} for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to update sub-agent: {e}"}

    return {"success": True, "statusCode": 200, "message": "Sub-agent updated successfully",
            "agentId": agent_id, "name": arguments.get("name", ""), "systemPrompt": arguments.get("systemPrompt", ""),
            "modelId": arguments.get("modelId", ""), "lambdaTools": arguments.get("lambdaTools", [])}


def handle_delete_sub_agent(arguments: dict, event: dict) -> dict:
    """Delete a sub-agent by agentId.

    Removes the item from the AgentConfigurations table by (userId, sk="SUBAGENT#{agentId}").

    Requirements: 4.3
    """
    user_id = _get_user_id(event)
    agent_id = arguments.get("agentId")

    if not agent_id:
        return {"success": False, "statusCode": 400, "message": "agentId is required"}

    try:
        agent_configurations_table.delete_item(
            Key={"userId": user_id, "sk": f"SUBAGENT#{agent_id}"}
        )
    except Exception as e:
        logger.error(f"Error deleting sub-agent {agent_id} for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to delete sub-agent: {e}"}

    return {"success": True, "statusCode": 200, "message": "Sub-agent deleted successfully"}


def handle_list_sub_agents(arguments: dict, event: dict) -> list:
    """List all sub-agents for the authenticated user.

    Queries GSI1 with gsi1pk="USER#{userId}" and gsi1sk begins_with "SUBAGENT#".
    Returns a list of sub-agent summaries (agentId, name, modelId).

    Requirements: 4.4, 4.8
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "SUBAGENT#",
            },
        )
    except Exception as e:
        logger.error(f"Error listing sub-agents for user {user_id}: {e}")
        return []

    items = response.get("Items", [])
    return [
        {
            "agentId": item.get("agentId"),
            "userId": item.get("userId"),
            "name": item.get("name"),
            "systemPrompt": item.get("systemPrompt"),
            "modelId": item.get("modelId"),
            "lambdaTools": item.get("lambdaTools", []),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
        for item in items
    ]


def handle_get_sub_agent(arguments: dict, event: dict) -> dict:
    """Get a sub-agent's full configuration by agentId.

    Retrieves the item by (userId, sk="SUBAGENT#{agentId}").
    Returns the full sub-agent config including agentId, name, systemPrompt, modelId, lambdaTools.

    Requirements: 4.5
    """
    user_id = _get_user_id(event)
    agent_id = arguments.get("agentId")

    if not agent_id:
        return {"success": False, "statusCode": 400, "message": "agentId is required"}

    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"SUBAGENT#{agent_id}"}
        )
    except Exception as e:
        logger.error(f"Error getting sub-agent {agent_id} for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to get sub-agent: {e}"}

    item = response.get("Item")
    if not item:
        return {"success": False, "statusCode": 404, "message": f"Sub-agent {agent_id} not found"}

    return {
        "agentId": item.get("agentId"),
        "userId": item.get("userId"),
        "name": item.get("name"),
        "systemPrompt": item.get("systemPrompt"),
        "modelId": item.get("modelId"),
        "lambdaTools": item.get("lambdaTools", []),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


# ---------------------------------------------------------------------------
# Lambda Tool Handlers
# Requirements: 5.1, 5.2, 5.3, 5.5, 5.6
# ---------------------------------------------------------------------------


def handle_create_lambda_tool(arguments: dict, event: dict) -> dict:
    """Create a new Lambda tool with a hello-world handler.

    1. Derives functionName = f"AgentCoreGatewayTool-{name}"
    2. Creates Lambda function with Python 3.12 runtime, hello-world handler, shared LambdaToolRole
    3. On Lambda creation failure: returns error immediately, no DynamoDB write
    4. Generates toolId (uuid4), writes DynamoDB record
    5. Calls _auto_update_gateway_schema() for schema generation + Gateway target
    6. Returns LambdaTool response dict

    Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 13.3
    """
    import io
    import zipfile

    user_id = _get_user_id(event)
    now = _now_iso()

    name = arguments.get("name", "")
    if not name:
        return {"success": False, "statusCode": 400, "message": "name is required"}

    function_name = f"AgentCoreGatewayTool-{name}"
    runtime = "python3.12"

    # Get the shared Lambda Tool Role ARN from environment
    lambda_tool_role_arn = os.environ.get("LAMBDA_TOOL_ROLE_ARN", "")
    if not lambda_tool_role_arn:
        logger.error("LAMBDA_TOOL_ROLE_ARN environment variable not set")
        return {"success": False, "statusCode": 500, "message": "Lambda tool role not configured"}

    # Hello-world handler template
    hello_code = '''import json

def lambda_handler(event, context):
    """
    Hello World Lambda Tool

    A starter template for your AI League Lambda tool.
    Edit this code in the SageMaker Code Editor, then deploy.

    Parameters (read from event body):
      message: A greeting message to echo back

    Returns:
      JSON response with the greeting
    """
    if 'body' in event:
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
    else:
        body = event

    message = body.get('message', 'Hello from AI League!')

    result = {'response': message, 'status': 'ok'}
    return {'statusCode': 200, 'body': json.dumps(result)}
'''

    # Create ZIP archive with the hello-world handler
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("lambda_handler.py", hello_code)
    buf.seek(0)

    # Create the Lambda function — fail fast on error
    try:
        lambda_client = boto3.client("lambda")
        lambda_client.create_function(
            FunctionName=function_name,
            Runtime=runtime,
            Role=lambda_tool_role_arn,
            Handler="lambda_handler.lambda_handler",
            Code={"ZipFile": buf.read()},
            Timeout=300,
            MemorySize=128,
        )
        logger.info("Created Lambda function: %s", function_name)
    except Exception as e:
        logger.error("Failed to create Lambda function %s: %s", function_name, e)
        return {"success": False, "statusCode": 500, "message": f"Failed to create Lambda function: {e}"}

    # Generate toolId and write DynamoDB record
    tool_id = str(uuid.uuid4())

    item = {
        "userId": user_id,
        "sk": f"LAMBDA#{tool_id}",
        "toolId": tool_id,
        "name": name,
        "functionName": function_name,
        "runtime": runtime,
        "gsi1pk": f"USER#{user_id}",
        "gsi1sk": f"LAMBDA#{now}",
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error("DynamoDB put_item failed for CreateLambdaTool: %s", e)
        # Best-effort cleanup of the Lambda function we just created
        try:
            lambda_client.delete_function(FunctionName=function_name)
        except Exception:
            logger.warning("Failed to clean up Lambda function %s after DynamoDB error", function_name)
        return {"success": False, "statusCode": 500, "message": f"Failed to register Lambda tool: {e}"}

    # Auto-generate schema and create Gateway target
    _auto_update_gateway_schema(function_name, user_id=user_id)

    return {
        "toolId": tool_id,
        "userId": user_id,
        "name": name,
        "functionName": function_name,
        "runtime": runtime,
        "createdAt": now,
        "updatedAt": now,
    }


def _auto_update_gateway_schema(function_name: str, user_id: str = None) -> None:
    """Auto-generate MCP tool schema from Lambda code using Bedrock and update the Gateway target.

    1. Fetches the Lambda function code via lambda:GetFunction + download ZIP
    2. Extracts .py files, truncates combined source to 8000 characters
    3. Loads persisted Schema_Generation_Model from DynamoDB (SCHEMA_MODEL_CONFIG SK)
       - If not set, defaults to 'amazon.nova-lite-v1:0'
    4. Calls Bedrock Converse with configured model and schema generation prompt
    5. Parses JSON response into Tool_Schema (MCP-compatible: name, description, inputSchema)
    6. Finds or creates Gateway target with the schema
    On invalid response: logs warning, skips update (does not crash)

    Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.3, 14.1, 14.2, 14.3, 14.4
    """
    import io
    import re as _re
    import traceback
    import urllib.request
    import zipfile

    try:
        # Extract gateway ID from GATEWAY_URL environment variable
        gateway_url = os.environ.get("GATEWAY_URL", "")
        gw_match = _re.search(r'https://([^.]+)\.gateway', gateway_url)
        if not gw_match:
            logger.warning("Cannot extract gateway ID from GATEWAY_URL: %s", gateway_url)
            return
        gw_id = gw_match.group(1)

        # 1. Get Lambda source code
        lambda_client = boto3.client("lambda")
        fn_info = lambda_client.get_function(FunctionName=function_name)
        code_url = fn_info["Code"]["Location"]

        with urllib.request.urlopen(code_url) as resp:
            zip_bytes = resp.read()

        source_code = ""
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in zf.namelist():
                if name.endswith(".py"):
                    source_code += f"\n# --- {name} ---\n"
                    source_code += zf.read(name).decode("utf-8", errors="replace")

        if not source_code:
            logger.warning("No Python source found in Lambda %s", function_name)
            return

        # Truncate to avoid token limits (keep first 8000 chars)
        source_code = source_code[:8000]

        # 2. Load persisted schema generation model from DynamoDB
        model_id = "amazon.nova-lite-v1:0"
        if user_id:
            try:
                model_config_resp = agent_configurations_table.get_item(
                    Key={"userId": user_id, "sk": "SCHEMA_MODEL_CONFIG"}
                )
                model_config_item = model_config_resp.get("Item")
                if model_config_item and model_config_item.get("modelId"):
                    model_id = model_config_item["modelId"]
            except Exception as e:
                logger.warning("Failed to load schema model config for user %s: %s", user_id, e)

        # 3. Generate schema using Bedrock Converse
        bedrock = boto3.client("bedrock-runtime")
        prompt = f"""Analyze this Python Lambda function and generate an MCP tool schema as JSON.

The schema must have exactly this structure:
{{
  "name": "<short_descriptive_tool_name>",
  "description": "<one-line description of what the tool does, mentioning key capabilities>",
  "inputSchema": {{
    "type": "object",
    "properties": {{
      "<param_name>": {{"type": "<json_type>", "description": "<what this param does>", "default": "<default_value_if_any>"}}
    }},
    "required": ["<only_truly_required_params>"]
  }}
}}

Rules:
- The "name" should be a short descriptive verb/noun (e.g. "route", "scan", "fetch_url", "calc") derived from the tool's PURPOSE, not the function name
- Extract parameter names from how the handler reads them (body.get('param_name'), event.get('param_name'), etc.)
- Include "default" values where the code specifies them (e.g. body.get('mode', 'time_budget') means default is "time_budget")
- Use the docstring and comments to determine descriptions
- Only include parameters the function actually reads from the input body
- Do NOT include internal/computed parameters or framework params like 'body', 'event', 'context'
- "required" should only list params that have NO default and would cause an error if missing
- Output ONLY the JSON object, no markdown, no explanation, no code fences

Lambda source code:
```python
{source_code}
```"""

        converse_resp = bedrock.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 2048, "temperature": 0.0},
        )

        response_text = ""
        for block in converse_resp.get("output", {}).get("message", {}).get("content", []):
            if "text" in block:
                response_text += block["text"]

        # 4. Parse the JSON response
        json_match = _re.search(r'\{[\s\S]*\}', response_text)
        if not json_match:
            logger.warning("No JSON found in Bedrock schema response for %s", function_name)
            return

        try:
            schema = json.loads(json_match.group())
        except json.JSONDecodeError as e:
            logger.warning("Invalid JSON in Bedrock schema response for %s: %s", function_name, e)
            return

        # Validate schema has required fields
        if not isinstance(schema, dict):
            logger.warning("Schema response is not a dict for %s", function_name)
            return
        if not schema.get("name") or not schema.get("description") or not schema.get("inputSchema"):
            logger.warning("Schema missing required fields (name/description/inputSchema) for %s", function_name)
            return

        logger.info("Generated schema for %s: %s", function_name, json.dumps(schema)[:500])

        # 5. Find and update/create the Gateway target
        agentcore_ctrl = boto3.client("bedrock-agentcore-control")
        targets = agentcore_ctrl.list_gateway_targets(gatewayIdentifier=gw_id)
        target_id = None
        target_lambda_arn = None

        for t in targets.get("items", []):
            try:
                detail = agentcore_ctrl.get_gateway_target(
                    gatewayIdentifier=gw_id, targetId=t["targetId"]
                )
                tc = detail.get("targetConfiguration", {})
                mcp = tc.get("mcp", {})
                lam = mcp.get("lambda", {})
                if function_name in lam.get("lambdaArn", ""):
                    target_id = t["targetId"]
                    target_lambda_arn = lam["lambdaArn"]
                    break
            except Exception:
                continue

        if not target_id:
            # No existing target — create a new one
            logger.info("Creating new Gateway target for Lambda %s", function_name)
            try:
                fn_config = lambda_client.get_function_configuration(FunctionName=function_name)
                lambda_arn = fn_config["FunctionArn"]

                agentcore_ctrl.create_gateway_target(
                    gatewayIdentifier=gw_id,
                    name=function_name,
                    description=f"Lambda tool: {function_name}",
                    targetConfiguration={
                        "mcp": {
                            "lambda": {
                                "lambdaArn": lambda_arn,
                                "toolSchema": {
                                    "inlinePayload": [schema],
                                },
                            },
                        },
                    },
                    credentialProviderConfigurations=[
                        {"credentialProviderType": "GATEWAY_IAM_ROLE"}
                    ],
                )
                logger.info("Created new Gateway target for %s", function_name)
            except Exception:
                logger.error("Failed to create Gateway target for %s: %s", function_name, traceback.format_exc())
            return

        # Update existing target with new schema
        agentcore_ctrl.update_gateway_target(
            gatewayIdentifier=gw_id,
            targetId=target_id,
            targetConfiguration={
                "mcp": {
                    "lambda": {
                        "lambdaArn": target_lambda_arn,
                        "toolSchema": {
                            "inlinePayload": [schema],
                        },
                    },
                },
            },
            credentialProviderConfigurations=[
                {"credentialProviderType": "GATEWAY_IAM_ROLE"}
            ],
        )
        logger.info("Updated Gateway target %s schema for %s", target_id, function_name)

    except Exception:
        import traceback as _tb
        logger.error(
            "Failed to auto-update Gateway schema for %s: %s",
            function_name,
            _tb.format_exc(),
        )


def handle_delete_lambda_tool(arguments: dict, event: dict) -> dict:
    """Delete a Lambda tool with full cascade: Lambda function, Gateway target, DynamoDB record.

    1. Look up DynamoDB record by (userId, sk=LAMBDA#{toolId}) to get functionName
    2. If not found: return 404
    3. Delete AWS Lambda function (ResourceNotFoundException is OK, other errors → return error, preserve record)
    4. Find and delete Gateway target matching the Lambda function ARN (best effort)
    5. Delete DynamoDB record
    6. Return success

    Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4, 13.3
    """
    user_id = _get_user_id(event)
    tool_id = arguments.get("toolId")

    if not tool_id:
        return {"success": False, "statusCode": 400, "message": "toolId is required"}

    # Step 1: Look up DynamoDB record to get functionName
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"LAMBDA#{tool_id}"}
        )
    except Exception as e:
        logger.error("Error looking up Lambda tool %s for user %s: %s", tool_id, user_id, e)
        return {"success": False, "statusCode": 500, "message": f"Failed to look up Lambda tool: {e}"}

    item = response.get("Item")
    if not item:
        return {"success": False, "statusCode": 404, "message": f"Lambda tool {tool_id} not found"}

    function_name = item.get("functionName", "")

    # Step 2: Delete the AWS Lambda function
    if function_name:
        try:
            lambda_client = boto3.client("lambda")
            lambda_client.delete_function(FunctionName=function_name)
            logger.info("Deleted Lambda function: %s", function_name)
        except Exception as e:
            error_code = ""
            if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
                error_code = e.response["Error"].get("Code", "")
            if error_code == "ResourceNotFoundException":
                # Function already deleted — that's fine, proceed
                logger.info("Lambda function %s already deleted (ResourceNotFoundException)", function_name)
            else:
                # Any other error → preserve DynamoDB record and return error
                logger.error("Failed to delete Lambda function %s: [%s] %s", function_name, error_code, e)
                return {
                    "success": False,
                    "statusCode": 500,
                    "message": f"Failed to delete Lambda function: {e}",
                }

    # Step 3: Find and delete Gateway target (best effort)
    if function_name:
        try:
            gateway_url = os.environ.get("GATEWAY_URL", "")
            if gateway_url:
                # Extract gateway ID from URL: https://{gateway_id}.gateway.bedrock-agentcore.{region}.amazonaws.com/mcp
                gw_id = gateway_url.split("//")[1].split(".")[0] if "//" in gateway_url else ""
                if gw_id:
                    agentcore_ctrl = boto3.client("bedrock-agentcore-control")
                    # List targets and find the one matching our function
                    targets_response = agentcore_ctrl.list_gateway_targets(gatewayIdentifier=gw_id)
                    target_id_to_delete = None
                    for target in targets_response.get("items", []):
                        try:
                            detail = agentcore_ctrl.get_gateway_target(
                                gatewayIdentifier=gw_id, targetId=target["targetId"]
                            )
                            # Check if target's Lambda ARN matches our function name
                            target_config = detail.get("targetConfiguration", {})
                            mcp_config = target_config.get("mcp", {})
                            lambda_config = mcp_config.get("lambda", mcp_config.get("Lambda", {}))
                            lambda_arn = lambda_config.get("lambdaArn", lambda_config.get("LambdaArn", ""))
                            if function_name in lambda_arn:
                                target_id_to_delete = target["targetId"]
                                break
                        except Exception as detail_err:
                            logger.warning("Error getting target detail: %s", detail_err)
                            continue

                    if target_id_to_delete:
                        agentcore_ctrl.delete_gateway_target(
                            gatewayIdentifier=gw_id, targetId=target_id_to_delete
                        )
                        logger.info("Deleted Gateway target %s for %s", target_id_to_delete, function_name)
                    else:
                        logger.info("No Gateway target found for %s", function_name)
        except Exception as gw_err:
            # Best effort — log warning but continue with DynamoDB deletion
            logger.warning("Failed to delete Gateway target for %s: %s", function_name, gw_err)

    # Step 4: Delete DynamoDB record
    try:
        agent_configurations_table.delete_item(
            Key={"userId": user_id, "sk": f"LAMBDA#{tool_id}"}
        )
    except Exception as e:
        logger.error("Error deleting Lambda tool record %s for user %s: %s", tool_id, user_id, e)
        return {"success": False, "statusCode": 500, "message": f"Failed to delete Lambda tool record: {e}"}

    return {"success": True, "statusCode": 200, "message": "Lambda tool deleted successfully"}


def handle_list_lambda_tool(arguments: dict, event: dict) -> list:
    """List all Lambda tools for the authenticated user.

    Queries GSI1 with gsi1pk="USER#{userId}" and gsi1sk begins_with "LAMBDA#".
    Returns whatever tools exist (does NOT auto-seed; seeding only happens on
    first access via handle_get_supervisor_agent → _seed_defaults_for_user).

    Requirements: 5.2
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "LAMBDA#",
            },
        )
    except Exception as e:
        logger.error(f"Error listing Lambda tools for user {user_id}: {e}")
        return []

    items = response.get("Items", [])

    return [
        {
            "toolId": item.get("toolId"),
            "userId": item.get("userId"),
            "name": item.get("name"),
            "functionName": item.get("functionName"),
            "runtime": item.get("runtime"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
        for item in items
    ]


# ---------------------------------------------------------------------------
# Memory Tool Handlers
# Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
# ---------------------------------------------------------------------------

# Lazy-init boto3 client for bedrock-agentcore-control (memory operations)
_bedrock_agentcore_control_client = None


def _get_bedrock_agentcore_control_client():
    """Lazy-init the bedrock-agentcore-control client for Memory operations."""
    global _bedrock_agentcore_control_client
    if _bedrock_agentcore_control_client is None:
        _bedrock_agentcore_control_client = boto3.client("bedrock-agentcore-control")
    return _bedrock_agentcore_control_client


def handle_create_memory(arguments: dict, event: dict) -> dict:
    """Create an AgentCore Memory instance via Bedrock AgentCore API.

    Creates the memory via bedrock-agentcore-control client (create_memory),
    then stores the reference with sk="MEMORY#{toolId}", gsi1pk="USER#{userId}",
    gsi1sk="MEMORY#{timestamp}".

    Fields: toolId, userId, name, memoryId, description, status, createdAt, updatedAt.

    Requirements: 6.1
    """
    user_id = _get_user_id(event)
    now = _now_iso()

    name = arguments.get("name", "")
    description = arguments.get("description", "")

    if not name:
        return {"success": False, "statusCode": 400, "message": "name is required"}

    tool_id = str(uuid.uuid4())
    memory_id = None
    status = "CREATING"

    # Create memory via AgentCore API
    try:
        client = _get_bedrock_agentcore_control_client()
        create_response = client.create_memory(
            name=name,
            description=description or f"Memory for AI League agent",
            eventExpiryDuration=365,  # Maximum: 365 days
        )
        memory_id = create_response.get("memoryId", "")
        status = create_response.get("status", "ACTIVE")
    except Exception as e:
        error_code = ""
        if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
            error_code = e.response["Error"]["Code"]
        logger.error(
            f"Failed to create AgentCore Memory for user {user_id}: [{error_code}] {e}"
        )
        raise Exception(f"Failed to create memory: {e}")

    # Store reference in DynamoDB
    item = {
        "userId": user_id,
        "sk": f"MEMORY#{tool_id}",
        "toolId": tool_id,
        "name": name,
        "memoryId": memory_id or "",
        "description": description,
        "status": status,
        "gsi1pk": f"USER#{user_id}",
        "gsi1sk": f"MEMORY#{now}",
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error(f"Error storing memory tool reference for user {user_id}: {e}")
        raise Exception(f"Memory created but failed to store reference: {e}")

    return {
        "toolId": tool_id,
        "userId": user_id,
        "name": name,
        "memoryId": memory_id or "",
        "description": description,
        "status": status,
        "createdAt": now,
        "updatedAt": now,
    }


def handle_delete_memory(arguments: dict, event: dict) -> dict:
    """Delete a memory tool record.

    Removes the item from the AgentConfigurations table by (userId, sk="MEMORY#{toolId}").
    Optionally calls delete_memory on AgentCore if memoryId is available.

    Requirements: 6.3
    """
    user_id = _get_user_id(event)
    tool_id = arguments.get("toolId")

    if not tool_id:
        return {"success": False, "statusCode": 400, "message": "toolId is required"}

    # Try to retrieve the memory record first to get memoryId for cleanup
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"MEMORY#{tool_id}"}
        )
        item = response.get("Item")
        if item and item.get("memoryId"):
            # Best-effort delete from AgentCore
            try:
                client = _get_bedrock_agentcore_control_client()
                client.delete_memory(memoryId=item["memoryId"])
            except Exception as e:
                error_code = ""
                if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
                    error_code = e.response["Error"]["Code"]
                logger.warning(
                    f"Failed to delete AgentCore Memory {item['memoryId']}: [{error_code}] {e}"
                )
    except Exception as e:
        logger.warning(f"Could not retrieve memory record for cleanup: {e}")

    # Delete the DynamoDB record regardless
    try:
        agent_configurations_table.delete_item(
            Key={"userId": user_id, "sk": f"MEMORY#{tool_id}"}
        )
    except Exception as e:
        logger.error(f"Error deleting memory tool {tool_id} for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to delete memory tool: {e}"}

    return {"success": True, "statusCode": 200, "message": "Memory tool deleted successfully"}


def handle_list_memory(arguments: dict, event: dict) -> list:
    """List all memory tools for the authenticated user.

    Queries GSI1 with gsi1pk="USER#{userId}" and gsi1sk begins_with "MEMORY#".

    Requirements: 6.2
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "MEMORY#",
            },
        )
    except Exception as e:
        logger.error(f"Error listing memory tools for user {user_id}: {e}")
        return []

    items = response.get("Items", [])
    return [
        {
            "toolId": item.get("toolId"),
            "userId": item.get("userId"),
            "name": item.get("name"),
            "memoryId": item.get("memoryId"),
            "description": item.get("description"),
            "status": item.get("status"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
        for item in items
    ]


# ---------------------------------------------------------------------------
# Guardrail Tool Handlers
# Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
# ---------------------------------------------------------------------------

# Lazy-init boto3 client for Bedrock (guardrail operations)
_bedrock_client = None


def _get_bedrock_client():
    """Lazy-init the Bedrock client for Guardrail operations."""
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock")
    return _bedrock_client


def handle_create_guardrail(arguments: dict, event: dict) -> dict:
    """Create a Bedrock Guardrail via the Bedrock API.

    Creates a guardrail with the provided configuration, then stores the reference
    with sk="GUARDRAIL#{toolId}", gsi1pk="USER#{userId}", gsi1sk="GUARDRAIL#{timestamp}".

    Arguments:
        name: Guardrail name
        description: Guardrail description
        blockedInputMessaging: Message shown when input is blocked
        blockedOutputsMessaging: Message shown when output is blocked
        contentPolicyConfig: JSON string of filtersConfig for content policy

    Fields: toolId, userId, name, guardrailId, description, status, createdAt, updatedAt.

    Requirements: 7.1, 7.5, 7.6
    """
    user_id = _get_user_id(event)
    now = _now_iso()

    name = arguments.get("name", "")
    description = arguments.get("description", "")
    blocked_input_messaging = arguments.get(
        "blockedInputMessaging", "Sorry, this input has been blocked by the guardrail."
    )
    blocked_outputs_messaging = arguments.get(
        "blockedOutputsMessaging", "Sorry, this output has been blocked by the guardrail."
    )
    content_policy_config_str = arguments.get("contentPolicyConfig", "")

    if not name:
        return {"success": False, "statusCode": 400, "message": "name is required"}

    tool_id = str(uuid.uuid4())
    guardrail_id = None
    status = "CREATING"

    # Build the create_guardrail kwargs
    create_kwargs = {
        "name": name,
        "description": description or f"Guardrail for AI League agent ({user_id})",
        "blockedInputMessaging": blocked_input_messaging,
        "blockedOutputsMessaging": blocked_outputs_messaging,
    }

    # Parse contentPolicyConfig if provided (supports combined format with filtersConfig + topicsConfig)
    if content_policy_config_str:
        try:
            config = (
                json.loads(content_policy_config_str)
                if isinstance(content_policy_config_str, str)
                else content_policy_config_str
            )

            # Support combined format: { filtersConfig: [...], topicsConfig: [...] }
            if isinstance(config, dict) and ("filtersConfig" in config or "topicsConfig" in config):
                # Content policy filters
                if config.get("filtersConfig"):
                    create_kwargs["contentPolicyConfig"] = {"filtersConfig": config["filtersConfig"]}

                # Topic policy
                if config.get("topicsConfig"):
                    create_kwargs["topicPolicyConfig"] = {"topicsConfig": config["topicsConfig"]}
            elif isinstance(config, list):
                # Legacy format: plain array of filter objects
                create_kwargs["contentPolicyConfig"] = {"filtersConfig": config}
        except (json.JSONDecodeError, TypeError) as e:
            return {
                "success": False,
                "statusCode": 400,
                "message": f"Invalid contentPolicyConfig JSON: {e}",
            }

    # Create guardrail via Bedrock API
    try:
        client = _get_bedrock_client()
        create_response = client.create_guardrail(**create_kwargs)
        guardrail_id = create_response.get("guardrailId", "")
        status = create_response.get("status", "READY")
    except Exception as e:
        error_code = ""
        if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
            error_code = e.response["Error"]["Code"]
        logger.error(
            f"Failed to create Bedrock Guardrail for user {user_id}: [{error_code}] {e}"
        )
        raise Exception(f"Failed to create guardrail: {e}")

    # Store reference in DynamoDB
    item = {
        "userId": user_id,
        "sk": f"GUARDRAIL#{tool_id}",
        "toolId": tool_id,
        "name": name,
        "guardrailId": guardrail_id or "",
        "description": description,
        "status": status,
        "gsi1pk": f"USER#{user_id}",
        "gsi1sk": f"GUARDRAIL#{now}",
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error(f"Error storing guardrail tool reference for user {user_id}: {e}")
        raise Exception(f"Guardrail created but failed to store reference: {e}")

    return {
        "toolId": tool_id,
        "userId": user_id,
        "name": name,
        "guardrailId": guardrail_id or "",
        "description": description,
        "status": status,
        "createdAt": now,
        "updatedAt": now,
    }


def handle_delete_guardrail(arguments: dict, event: dict) -> dict:
    """Delete a guardrail tool record.

    Removes the item from the AgentConfigurations table by (userId, sk="GUARDRAIL#{toolId}").
    Optionally calls delete_guardrail on Bedrock if guardrailId is available.

    Requirements: 7.3
    """
    user_id = _get_user_id(event)
    tool_id = arguments.get("toolId")

    if not tool_id:
        return {"success": False, "statusCode": 400, "message": "toolId is required"}

    # Try to retrieve the guardrail record first to get guardrailId for cleanup
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"GUARDRAIL#{tool_id}"}
        )
        item = response.get("Item")
        if item and item.get("guardrailId"):
            # Best-effort delete from Bedrock
            try:
                client = _get_bedrock_client()
                client.delete_guardrail(guardrailIdentifier=item["guardrailId"])
            except Exception as e:
                error_code = ""
                if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
                    error_code = e.response["Error"]["Code"]
                logger.warning(
                    f"Failed to delete Bedrock Guardrail {item['guardrailId']}: [{error_code}] {e}"
                )
    except Exception as e:
        logger.warning(f"Could not retrieve guardrail record for cleanup: {e}")

    # Delete the DynamoDB record regardless
    try:
        agent_configurations_table.delete_item(
            Key={"userId": user_id, "sk": f"GUARDRAIL#{tool_id}"}
        )
    except Exception as e:
        logger.error(f"Error deleting guardrail tool {tool_id} for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to delete guardrail tool: {e}"}

    return {"success": True, "statusCode": 200, "message": "Guardrail tool deleted successfully"}


def handle_list_guardrail(arguments: dict, event: dict) -> list:
    """List all guardrail tools for the authenticated user.

    Queries GSI1 with gsi1pk="USER#{userId}" and gsi1sk begins_with "GUARDRAIL#".

    Requirements: 7.2
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "GUARDRAIL#",
            },
        )
    except Exception as e:
        logger.error(f"Error listing guardrail tools for user {user_id}: {e}")
        return []

    items = response.get("Items", [])
    return [
        {
            "toolId": item.get("toolId"),
            "userId": item.get("userId"),
            "name": item.get("name"),
            "guardrailId": item.get("guardrailId"),
            "description": item.get("description"),
            "status": item.get("status"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
        for item in items
    ]


# ---------------------------------------------------------------------------
# SageMaker IDE Management Handlers
# Requirements: 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3
# ---------------------------------------------------------------------------


def handle_start_code_editor(arguments: dict, event: dict) -> dict:
    """Start the SageMaker Code Editor app in the configured space.

    Checks current app status first:
    - InService or Pending: returns current status (already running/starting)
    - Deleting: returns message to try again later
    - Otherwise: calls create_app to start the IDE

    Requirements: 9.1, 9.2, 10.1, 10.2
    """
    domain_id = os.environ.get("SAGEMAKER_DOMAIN_ID", "")
    space_name = os.environ.get("SAGEMAKER_SPACE_NAME", "")

    if not domain_id or not space_name:
        return {"status": "Error", "message": "SageMaker domain or space not configured"}

    try:
        sm = boto3.client("sagemaker")

        # Check current status first
        try:
            app_resp = sm.describe_app(
                DomainId=domain_id,
                SpaceName=space_name,
                AppType="CodeEditor",
                AppName="default",
            )
            status = app_resp.get("Status", "")
            if status in ("InService", "Pending"):
                return {"status": status, "message": f"Code Editor is {status}"}
            if status == "Deleting":
                return {"status": "Deleting", "message": "Code Editor is stopping, please try again later"}
            # Any other status (Failed, Deleted, etc.) — proceed to create
        except Exception as e:
            # Any exception from describe_app means we should try to create
            # ResourceNotFound, ValidationException, or unexpected errors all handled here
            error_code = ""
            if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
                error_code = e.response["Error"].get("Code", "")
            logger.info("describe_app returned error [%s]: %s — proceeding to create_app", error_code, e)

        # Create the app
        sm.create_app(
            DomainId=domain_id,
            SpaceName=space_name,
            AppType="CodeEditor",
            AppName="default",
            ResourceSpec={
                "SageMakerImageArn": "arn:aws:sagemaker:us-east-1:885854791233:image/sagemaker-distribution-cpu",
                "SageMakerImageVersionAlias": "4",
                "InstanceType": "ml.t3.medium",
            },
        )
        return {"status": "Pending", "message": "Code Editor starting"}

    except Exception as e:
        logger.error("Failed to start Code Editor: %s", e)
        return {"status": "Error", "message": f"Failed to start Code Editor: {e}"}


def handle_stop_code_editor(arguments: dict, event: dict) -> dict:
    """Stop the SageMaker Code Editor app to save costs.

    Calls delete_app which terminates the running instance.

    Requirements: 9.3, 9.4, 10.3
    """
    domain_id = os.environ.get("SAGEMAKER_DOMAIN_ID", "")
    space_name = os.environ.get("SAGEMAKER_SPACE_NAME", "")

    if not domain_id or not space_name:
        return {"status": "Error", "message": "SageMaker domain or space not configured"}

    try:
        sm = boto3.client("sagemaker")
        sm.delete_app(
            DomainId=domain_id,
            SpaceName=space_name,
            AppType="CodeEditor",
            AppName="default",
        )
        return {"status": "Deleting", "message": "Code Editor stopping"}

    except Exception as e:
        error_code = ""
        if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
            error_code = e.response["Error"].get("Code", "")
        if error_code == "ResourceNotFound":
            return {"status": "Stopped", "message": "Code Editor is already stopped"}
        logger.error("Failed to stop Code Editor: [%s] %s", error_code, e)
        return {"status": "Error", "message": f"Failed to stop Code Editor: {e}"}


def handle_get_code_editor_status(arguments: dict, event: dict) -> dict:
    """Get the current status of the SageMaker Code Editor app.

    Maps describe_app response to one of: InService, Pending, Deleting, Stopped.
    ResourceNotFoundException maps to Stopped.

    Requirements: 11.1, 11.2, 11.3
    """
    domain_id = os.environ.get("SAGEMAKER_DOMAIN_ID", "")
    space_name = os.environ.get("SAGEMAKER_SPACE_NAME", "")

    if not domain_id or not space_name:
        return {"status": "Stopped", "message": "SageMaker domain or space not configured"}

    try:
        sm = boto3.client("sagemaker")
        app_resp = sm.describe_app(
            DomainId=domain_id,
            SpaceName=space_name,
            AppType="CodeEditor",
            AppName="default",
        )
        status = app_resp.get("Status", "")
        # Map SageMaker statuses to our simplified set
        status = _map_ide_status(status)
        return {"status": status, "message": ""}

    except Exception as e:
        error_code = ""
        if hasattr(e, "response") and "Error" in getattr(e, "response", {}):
            error_code = e.response["Error"].get("Code", "")
        if error_code in ("ResourceNotFound", "ValidationException"):
            return {"status": "Stopped", "message": ""}
        logger.error("Failed to get Code Editor status: [%s] %s", error_code, e)
        return {"status": "Stopped", "message": f"Unable to determine status: {e}"}


def _map_ide_status(raw_status: str) -> str:
    """Map SageMaker app status to simplified IDE status.

    Returns exactly one of: InService, Pending, Deleting, Stopped.
    Any unrecognized status maps to Stopped.

    Requirements: 11.1, 11.2
    """
    if raw_status == "InService":
        return "InService"
    elif raw_status in ("Pending", "Creating"):
        return "Pending"
    elif raw_status in ("Deleting", "Stopping"):
        return "Deleting"
    else:
        # Deleted, Failed, Unknown, or any other status → Stopped
        return "Stopped"


def handle_get_presigned_domain_url(arguments: dict, event: dict) -> dict:
    """Generate a presigned URL for the SageMaker domain IDE.

    Uses create_presigned_domain_url to get a short-lived authenticated URL
    that opens the Code Editor space directly in the browser.
    """
    domain_id = os.environ.get("SAGEMAKER_DOMAIN_ID", "")
    user_profile_name = os.environ.get("SAGEMAKER_USER_PROFILE", "")
    space_name = os.environ.get("SAGEMAKER_SPACE_NAME", "ai-league-codeeditor")

    if not domain_id or not user_profile_name:
        return {"authorizedUrl": "", "error": "SageMaker not configured"}

    try:
        sm = boto3.client("sagemaker")
        resp = sm.create_presigned_domain_url(
            DomainId=domain_id,
            UserProfileName=user_profile_name,
            SpaceName=space_name,
            ExpiresInSeconds=300,
            SessionExpirationDurationInSeconds=43200,
        )
        return {"authorizedUrl": resp.get("AuthorizedUrl", "")}
    except Exception as e:
        logger.error("Failed to generate presigned URL: %s", e)
        return {"authorizedUrl": "", "error": str(e)}


# ---------------------------------------------------------------------------
# Schema Model Configuration Persistence
# Requirements: 8.1, 8.2
# ---------------------------------------------------------------------------


def handle_save_schema_model_config(arguments: dict, event: dict) -> dict:
    """Persist the user's chosen schema generation model to DynamoDB.

    Writes to AgentConfigurations table with sk="SCHEMA_MODEL_CONFIG".
    The modelId is used by _auto_update_gateway_schema when generating tool schemas.

    Requirements: 8.1
    """
    user_id = _get_user_id(event)
    now = _now_iso()

    model_id = arguments.get("modelId", "amazon.nova-lite-v1:0")

    item = {
        "userId": user_id,
        "sk": "SCHEMA_MODEL_CONFIG",
        "modelId": model_id,
        "updatedAt": now,
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error("Error saving schema model config for user %s: %s", user_id, e)
        return {"success": False, "statusCode": 500, "message": f"Failed to save schema model config: {e}"}

    return {"success": True, "statusCode": 200, "modelId": model_id, "message": "Schema model config saved"}


def handle_get_schema_model_config(arguments: dict, event: dict) -> dict:
    """Retrieve the user's chosen schema generation model from DynamoDB.

    Returns the persisted modelId, or the default (amazon.nova-lite-v1:0) if not set.

    Requirements: 8.2
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "SCHEMA_MODEL_CONFIG"}
        )
    except Exception as e:
        logger.error("Error loading schema model config for user %s: %s", user_id, e)
        return {"modelId": "amazon.nova-lite-v1:0"}

    item = response.get("Item")
    if not item:
        return {"modelId": "amazon.nova-lite-v1:0"}

    return {"modelId": item.get("modelId", "amazon.nova-lite-v1:0")}


# ---------------------------------------------------------------------------
# Reset Configuration Handler
# Requirements: 15.3, 15.4, 15.5
# ---------------------------------------------------------------------------


def handle_reset_configuration(arguments: dict, event: dict) -> dict:
    """Reset the user's agent configuration to defaults.

    1. Get userId
    2. Query all SUBAGENT# records for user, delete all except pathfinder-specialist-default
    3. Query all LAMBDA# records for user, for each non-pathfinder tool:
       delete AWS Lambda function, delete Gateway target, delete DynamoDB record
    4. Re-seed defaults via _seed_defaults_for_user(user_id)
    5. Return success

    Requirements: 15.3, 15.4, 15.5
    """
    user_id = _get_user_id(event)

    try:
        # Step 1: Delete all sub-agents except the default pathfinder
        sub_agents = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "SUBAGENT#",
            },
        ).get("Items", [])

        for item in sub_agents:
            agent_id = item.get("agentId", "")
            if agent_id != DEFAULT_PATHFINDER_SUBAGENT_ID:
                try:
                    agent_configurations_table.delete_item(
                        Key={"userId": user_id, "sk": f"SUBAGENT#{agent_id}"}
                    )
                except Exception as e:
                    logger.warning("Failed to delete sub-agent %s during reset: %s", agent_id, e)

        # Step 2: Delete all Lambda tools except pathfinder-default
        lambda_tools = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "LAMBDA#",
            },
        ).get("Items", [])

        lambda_client = boto3.client("lambda")
        gateway_url = os.environ.get("GATEWAY_URL", "")
        gw_id = ""
        if gateway_url and "//" in gateway_url:
            gw_id = gateway_url.split("//")[1].split(".")[0]

        for item in lambda_tools:
            tool_id = item.get("toolId", "")
            if tool_id == "pathfinder-default":
                continue

            function_name = item.get("functionName", "")

            # Delete Lambda function (best effort)
            if function_name:
                try:
                    lambda_client.delete_function(FunctionName=function_name)
                    logger.info("Reset: Deleted Lambda function %s", function_name)
                except Exception as e:
                    error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
                    if error_code != "ResourceNotFoundException":
                        logger.warning("Reset: Failed to delete Lambda %s: %s", function_name, e)

                # Delete Gateway target (best effort)
                if gw_id:
                    try:
                        agentcore_ctrl = boto3.client("bedrock-agentcore-control")
                        targets = agentcore_ctrl.list_gateway_targets(gatewayIdentifier=gw_id)
                        for target in targets.get("items", []):
                            try:
                                detail = agentcore_ctrl.get_gateway_target(
                                    gatewayIdentifier=gw_id, targetId=target["targetId"]
                                )
                                tc = detail.get("targetConfiguration", {})
                                mcp = tc.get("mcp", {})
                                lam = mcp.get("lambda", {})
                                if function_name in lam.get("lambdaArn", ""):
                                    agentcore_ctrl.delete_gateway_target(
                                        gatewayIdentifier=gw_id, targetId=target["targetId"]
                                    )
                                    logger.info("Reset: Deleted Gateway target for %s", function_name)
                                    break
                            except Exception:
                                continue
                    except Exception as gw_err:
                        logger.warning("Reset: Failed to delete Gateway target for %s: %s", function_name, gw_err)

            # Delete DynamoDB record
            try:
                agent_configurations_table.delete_item(
                    Key={"userId": user_id, "sk": f"LAMBDA#{tool_id}"}
                )
            except Exception as e:
                logger.warning("Reset: Failed to delete Lambda tool record %s: %s", tool_id, e)

        # Step 3: Delete all MEMORY# records — query main table directly to get memoryId
        # Collect memoryIds FIRST, then delete AWS resources, then delete DynamoDB records
        try:
            memory_response = agent_configurations_table.query(
                KeyConditionExpression="userId = :uid AND begins_with(sk, :prefix)",
                ExpressionAttributeValues={
                    ":uid": user_id,
                    ":prefix": "MEMORY#",
                },
            )
            memory_tools = memory_response.get("Items", [])
        except Exception as e:
            logger.warning("Reset: Failed to query memory tools: %s", e)
            memory_tools = []

        for item in memory_tools:
            mem_tool_id = item.get("toolId", "")
            memory_id = item.get("memoryId", "")

            # Delete AgentCore memory instance FIRST (before DynamoDB record)
            if memory_id:
                try:
                    client = _get_bedrock_agentcore_control_client()
                    client.delete_memory(memoryId=memory_id)
                    logger.info("Reset: Deleted AgentCore Memory %s", memory_id)
                except Exception as e:
                    logger.warning("Reset: Failed to delete AgentCore Memory %s: %s", memory_id, e)

            # Delete DynamoDB record only after AWS resource deletion attempted
            try:
                agent_configurations_table.delete_item(
                    Key={"userId": user_id, "sk": f"MEMORY#{mem_tool_id}"}
                )
            except Exception as e:
                logger.warning("Reset: Failed to delete memory tool record %s: %s", mem_tool_id, e)

        # Step 4: Delete all GUARDRAIL# records — query main table directly to get guardrailId
        try:
            guardrail_response = agent_configurations_table.query(
                KeyConditionExpression="userId = :uid AND begins_with(sk, :prefix)",
                ExpressionAttributeValues={
                    ":uid": user_id,
                    ":prefix": "GUARDRAIL#",
                },
            )
            guardrail_tools = guardrail_response.get("Items", [])
        except Exception as e:
            logger.warning("Reset: Failed to query guardrail tools: %s", e)
            guardrail_tools = []

        for item in guardrail_tools:
            gr_tool_id = item.get("toolId", "")
            guardrail_id = item.get("guardrailId", "")

            # Delete Bedrock guardrail (best effort)
            if guardrail_id:
                try:
                    client = _get_bedrock_client()
                    client.delete_guardrail(guardrailIdentifier=guardrail_id)
                    logger.info("Reset: Deleted Bedrock Guardrail %s", guardrail_id)
                except Exception as e:
                    logger.warning("Reset: Failed to delete Bedrock Guardrail %s: %s", guardrail_id, e)

            # Delete DynamoDB record
            try:
                agent_configurations_table.delete_item(
                    Key={"userId": user_id, "sk": f"GUARDRAIL#{gr_tool_id}"}
                )
            except Exception as e:
                logger.warning("Reset: Failed to delete guardrail tool record %s: %s", gr_tool_id, e)

        # Step 5: Delete SUPERVISOR record so it gets re-seeded
        try:
            agent_configurations_table.delete_item(
                Key={"userId": user_id, "sk": "SUPERVISOR"}
            )
        except Exception as e:
            logger.warning("Reset: Failed to delete supervisor config: %s", e)

        # Delete pathfinder default sub-agent and tool records so they get re-seeded fresh
        try:
            agent_configurations_table.delete_item(
                Key={"userId": user_id, "sk": f"SUBAGENT#{DEFAULT_PATHFINDER_SUBAGENT_ID}"}
            )
        except Exception:
            pass
        try:
            agent_configurations_table.delete_item(
                Key={"userId": user_id, "sk": "LAMBDA#pathfinder-default"}
            )
        except Exception:
            pass

        # Step 6: Re-seed defaults
        _seed_defaults_for_user(user_id)

        # Force overwrite the supervisor to ensure correct state (pathfinder attached)
        agent_configurations_table.put_item(Item={
            "userId": user_id,
            "sk": "SUPERVISOR",
            "name": DEFAULT_SUPERVISOR_CONFIG["name"],
            "systemPrompt": DEFAULT_SUPERVISOR_CONFIG["systemPrompt"],
            "modelId": DEFAULT_SUPERVISOR_CONFIG["modelId"],
            "subAgents": [DEFAULT_PATHFINDER_SUBAGENT_ID],
            "lambdaTools": DEFAULT_SUPERVISOR_CONFIG["lambdaTools"],
            "memoryTool": None,
            "guardrailTool": None,
            "createdAt": _now_iso(),
            "updatedAt": _now_iso(),
        })

        # Ensure the Pathfinder Lambda function exists in AWS (recreate if user deleted it)
        try:
            lambda_client.get_function(FunctionName="AgentCoreGatewayTool-Pathfinder")
            logger.info("Reset: Pathfinder Lambda exists")
        except Exception:
            # Pathfinder doesn't exist — recreate it from the CDK-deployed code
            # We can't easily recreate the full pathfinder code here, but we can create a placeholder
            # that will be replaced on next CDK deploy. For now, create with hello-world.
            logger.info("Reset: Pathfinder Lambda missing, recreating...")
            lambda_tool_role_arn = os.environ.get("LAMBDA_TOOL_ROLE_ARN", "")
            if lambda_tool_role_arn:
                import io, zipfile
                hello_code = 'import json\ndef lambda_handler(event, context):\n    return {"statusCode": 200, "body": json.dumps({"error": "Pathfinder needs redeployment. Run cdk deploy."})}\n'
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                    zf.writestr("lambda_handler.py", hello_code)
                buf.seek(0)
                try:
                    lambda_client.create_function(
                        FunctionName="AgentCoreGatewayTool-Pathfinder",
                        Runtime="python3.12",
                        Role=lambda_tool_role_arn,
                        Handler="lambda_handler.lambda_handler",
                        Code={"ZipFile": buf.read()},
                        Timeout=30,
                        MemorySize=256,
                    )
                    logger.info("Reset: Recreated Pathfinder Lambda (placeholder)")
                except Exception as e2:
                    logger.warning("Reset: Failed to recreate Pathfinder Lambda: %s", e2)

        return {"success": True, "statusCode": 200, "message": "Configuration reset successfully"}

    except Exception as e:
        logger.error("Error resetting configuration for user %s: %s", user_id, e)
        return {"success": False, "statusCode": 500, "message": f"Failed to reset configuration: {e}"}


def handle_regenerate_tool_schema(arguments: dict, event: dict) -> dict:
    """Regenerate the MCP Gateway tool schema for an existing Lambda tool.

    Called by the schema generator EventBridge rule when Lambda code is updated.
    Only regenerates the schema — does NOT create the Lambda function.

    Args:
        arguments.name: Tool name (without AgentCoreGatewayTool- prefix)
    """
    name = arguments.get("name", "")
    if not name:
        return {"success": False, "statusCode": 400, "message": "name is required"}

    function_name = f"AgentCoreGatewayTool-{name}"

    try:
        _auto_update_gateway_schema(function_name, user_id=_get_user_id(event))
        return {"success": True, "message": f"Schema regenerated for {function_name}"}
    except Exception as e:
        logger.error("Failed to regenerate schema for %s: %s", function_name, e)
        return {"success": False, "statusCode": 500, "message": f"Failed to regenerate schema: {e}"}
