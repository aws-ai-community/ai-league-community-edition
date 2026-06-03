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
                "functionName": "ai-league-pathfinder-tool",
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


def handle_update_lambda_tool(arguments: dict, event: dict) -> dict:
    """Register or update a Lambda tool.

    If no existing tool with the same functionName exists for this user,
    generates a new toolId (uuid4). Otherwise updates the existing record.
    Stores with sk="LAMBDA#{toolId}", gsi1pk="USER#{userId}", gsi1sk="LAMBDA#{timestamp}".

    Fields: toolId, userId, name, functionName, runtime, createdAt, updatedAt.

    Requirements: 5.1, 5.2
    """
    user_id = _get_user_id(event)
    now = _now_iso()

    name = arguments.get("name", "")
    function_name = arguments.get("functionName", "")
    runtime = arguments.get("runtime", "python3.12")

    if not function_name:
        return {"success": False, "statusCode": 400, "message": "functionName is required"}

    # Check if a tool with this functionName already exists
    tool_id = None
    created_at = now
    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "LAMBDA#",
            },
        )
        for item in response.get("Items", []):
            if item.get("functionName") == function_name:
                tool_id = item.get("toolId")
                created_at = item.get("createdAt", now)
                break
    except Exception as e:
        logger.error(f"Error querying Lambda tools for user {user_id}: {e}")
        # Proceed with creating a new tool

    # Generate new toolId if not found
    if not tool_id:
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
        "createdAt": created_at,
        "updatedAt": now,
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error(f"Error registering Lambda tool for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to register Lambda tool: {e}"}

    return {
        "success": True,
        "statusCode": 200,
        "toolId": tool_id,
        "name": name,
        "functionName": function_name,
    }


def handle_delete_lambda_tool(arguments: dict, event: dict) -> dict:
    """Delete a Lambda tool by toolId.

    Removes the item from the AgentConfigurations table by (userId, sk="LAMBDA#{toolId}").

    Requirements: 5.3
    """
    user_id = _get_user_id(event)
    tool_id = arguments.get("toolId")

    if not tool_id:
        return {"success": False, "statusCode": 400, "message": "toolId is required"}

    try:
        agent_configurations_table.delete_item(
            Key={"userId": user_id, "sk": f"LAMBDA#{tool_id}"}
        )
    except Exception as e:
        logger.error(f"Error deleting Lambda tool {tool_id} for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to delete Lambda tool: {e}"}

    return {"success": True, "statusCode": 200, "message": "Lambda tool deleted successfully"}


def handle_list_lambda_tool(arguments: dict, event: dict) -> list:
    """List all Lambda tools for the authenticated user.

    Queries GSI1 with gsi1pk="USER#{userId}" and gsi1sk begins_with "LAMBDA#".
    If no tools exist, seeds the default Pathfinder tool so it shows up.

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

    # If no Lambda tools exist, seed the default Pathfinder tool
    if not items:
        now = _now_iso()
        default_tool = {
            "userId": user_id,
            "sk": "LAMBDA#pathfinder-default",
            "toolId": "pathfinder-default",
            "name": "Pathfinder",
            "functionName": "ai-league-pathfinder-tool",
            "runtime": "python3.12",
            "gsi1pk": f"USER#{user_id}",
            "gsi1sk": f"LAMBDA#{now}",
            "createdAt": now,
            "updatedAt": now,
        }
        try:
            agent_configurations_table.put_item(
                Item=default_tool,
                ConditionExpression="attribute_not_exists(sk)",
            )
            items = [default_tool]
        except Exception:
            # Already exists or write failed — try reading directly
            try:
                direct = agent_configurations_table.get_item(
                    Key={"userId": user_id, "sk": "LAMBDA#pathfinder-default"}
                )
                if direct.get("Item"):
                    items = [direct["Item"]]
            except Exception:
                pass

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
