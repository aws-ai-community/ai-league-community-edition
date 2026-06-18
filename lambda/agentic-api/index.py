"""
AI League Agentic API - Lambda Resolver for AppSync GraphQL API.

Routes AppSync events to handler functions based on the resolved field name.
All DynamoDB operations use boto3 resource (Table) interface.

Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3
"""

import os
import json
import uuid
import logging
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key, Attr

import game_runner
import agent_config_handlers
import prompt_formatter

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


# Fail fast on cold start if any required env vars are missing
GAME_SESSIONS_TABLE = _get_required_env("GAME_SESSIONS_TABLE")
LEADERBOARD_TABLE = _get_required_env("LEADERBOARD_TABLE")
SUBMISSIONS_TABLE = _get_required_env("SUBMISSIONS_TABLE")
AGENT_CONFIGURATIONS_TABLE = _get_required_env("AGENT_CONFIGURATIONS_TABLE")
MAPS_TABLE = _get_required_env("MAPS_TABLE")

# DynamoDB resource and table references
dynamodb = boto3.resource("dynamodb")
game_sessions_table = dynamodb.Table(GAME_SESSIONS_TABLE)
leaderboard_table = dynamodb.Table(LEADERBOARD_TABLE)
submissions_table = dynamodb.Table(SUBMISSIONS_TABLE)
agent_configurations_table = dynamodb.Table(AGENT_CONFIGURATIONS_TABLE)
maps_table = dynamodb.Table(MAPS_TABLE)


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


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _decimal_default(obj):
    """JSON serializer for DynamoDB Decimal types."""
    from decimal import Decimal
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def handler(event, context):
    """
    AppSync Lambda resolver entry point.

    Routes requests based on event['info']['fieldName'] to the appropriate handler.
    """
    info = event.get("info", {})
    field_name = info.get("fieldName")
    arguments = event.get("arguments", {})

    handlers = {
        # Queries
        "GetMap": handle_get_map,
        "GetGameSession": handle_get_game_session,
        "GetLeaderboardSubmissions": handle_get_leaderboard_submissions,
        "GetSubmissionHistory": handle_get_submission_history,
        "GetLlmConfiguration": handle_get_llm_configuration,
        # Phase 2 Queries
        "GetSupervisorAgent": agent_config_handlers.handle_get_supervisor_agent,
        "ListSubAgents": agent_config_handlers.handle_list_sub_agents,
        "GetSubAgent": agent_config_handlers.handle_get_sub_agent,
        "ListLambdaTool": agent_config_handlers.handle_list_lambda_tool,
        "ListMemory": agent_config_handlers.handle_list_memory,
        "ListGuardrail": agent_config_handlers.handle_list_guardrail,
        "GetAgentCoreRuntime": agent_config_handlers.handle_get_agent_core_runtime,
        "ListAgentVersions": agent_config_handlers.handle_list_agent_versions,
        # Phase 3 Queries
        "GetCodeEditorStatus": agent_config_handlers.handle_get_code_editor_status,
        "GetSchemaModelConfig": agent_config_handlers.handle_get_schema_model_config,
        "GetPresignedDomainUrl": agent_config_handlers.handle_get_presigned_domain_url,
        # Mutations
        "InvokeAgentCoreRuntime": handle_invoke_agent_core_runtime,
        "SubmitToLeaderboard": handle_submit_to_leaderboard,
        "SaveLlmConfiguration": handle_save_llm_configuration,
        # Phase 2 Mutations
        "UpdateSupervisorAgent": agent_config_handlers.handle_update_supervisor_agent,
        "CreateSubAgent": agent_config_handlers.handle_create_sub_agent,
        "UpdateSubAgent": agent_config_handlers.handle_update_sub_agent,
        "DeleteSubAgent": agent_config_handlers.handle_delete_sub_agent,
        "CreateLambdaTool": agent_config_handlers.handle_create_lambda_tool,
        "DeleteLambdaTool": agent_config_handlers.handle_delete_lambda_tool,
        "CreateMemory": agent_config_handlers.handle_create_memory,
        "DeleteMemory": agent_config_handlers.handle_delete_memory,
        "CreateGuardrail": agent_config_handlers.handle_create_guardrail,
        "DeleteGuardrail": agent_config_handlers.handle_delete_guardrail,
        "CreateModel": agent_config_handlers.handle_create_model,
        # Phase 3 Mutations
        "StartCodeEditor": agent_config_handlers.handle_start_code_editor,
        "StopCodeEditor": agent_config_handlers.handle_stop_code_editor,
        "ResetConfiguration": agent_config_handlers.handle_reset_configuration,
        "SaveSchemaModelConfig": agent_config_handlers.handle_save_schema_model_config,
        "RegenerateToolSchema": agent_config_handlers.handle_regenerate_tool_schema,
    }

    handler_fn = handlers.get(field_name)
    if not handler_fn:
        raise ValueError(f"Unknown field name: {field_name}")

    return handler_fn(arguments, event)


def handle_get_map(arguments, event):
    """Handle GetMap query - load map from Maps table by mapId.

    The Maps table uses userId (PK) + mapId (SK), so we need to scan/query
    to find a map by mapId alone (maps are shared resources for gameplay).
    """
    map_id = arguments.get("mapId")
    if not map_id:
        return {"mapData": None}

    try:
        # Scan for the map by mapId (sort key) since we don't know the owner userId
        response = maps_table.scan(
            FilterExpression=Attr("mapId").eq(map_id),
        )
    except Exception as e:
        logger.error(f"Error loading map {map_id}: {e}")
        return {"mapData": None}

    items = response.get("Items", [])
    if not items:
        return {"mapData": None}

    return {"mapData": json.dumps(items[0], default=str)}


def handle_get_game_session(arguments, event):
    """Handle GetGameSession query - load session from GameSessions table by sessionId.

    Returns all session fields including status, gameEvents, consumedTiles,
    plannedPath, finalScore, and agentResponse.
    """
    session_id = arguments.get("sessionId")
    if not session_id:
        return {
            "sessionId": None,
            "status": "not_found",
            "gameEvents": None,
            "consumedTiles": None,
            "plannedPath": None,
            "agentResponse": None,
            "finalScore": None,
            "error": "sessionId is required",
        }

    try:
        response = game_sessions_table.get_item(Key={"sessionId": session_id})
    except Exception as e:
        logger.error(f"Error loading session {session_id}: {e}")
        return {
            "sessionId": session_id,
            "status": "error",
            "gameEvents": None,
            "consumedTiles": None,
            "plannedPath": None,
            "agentResponse": None,
            "finalScore": None,
            "error": str(e),
        }

    item = response.get("Item")
    if not item:
        return {
            "sessionId": session_id,
            "status": "not_found",
            "gameEvents": None,
            "consumedTiles": None,
            "plannedPath": None,
            "agentResponse": None,
            "finalScore": None,
            "error": "Session not found",
        }

    return {
        "sessionId": item.get("sessionId"),
        "status": item.get("status"),
        "gameEvents": item.get("gameEvents"),
        "consumedTiles": item.get("consumedTiles"),
        "plannedPath": item.get("plannedPath"),
        "agentResponse": item.get("agentResponse"),
        "finalScore": item.get("finalScore"),
        "error": item.get("error"),
    }


def handle_get_leaderboard_submissions(arguments, event):
    """Handle GetLeaderboardSubmissions query.

    Query leaderboard entries from AgenticLeaderboard table by leaderboardId,
    sort by bestScore descending, return ranked entries.
    """
    leaderboard_id = arguments.get("leaderboardId")
    if not leaderboard_id:
        return {"entries": []}

    try:
        response = leaderboard_table.query(
            KeyConditionExpression=Key("leaderboardId").eq(leaderboard_id)
            & Key("sk").begins_with("ENTRY#"),
        )
    except Exception as e:
        logger.error(f"Error querying leaderboard {leaderboard_id}: {e}")
        return {"entries": []}

    items = response.get("Items", [])

    # Sort by bestScore descending
    items.sort(key=lambda x: float(x.get("bestScore", 0)), reverse=True)

    # Build ranked entries
    entries = []
    for rank, item in enumerate(items, start=1):
        entries.append({
            "userId": item.get("userId"),
            "alias": item.get("alias"),
            "avatar": item.get("avatar"),
            "bestScore": item.get("bestScore"),
            "lastScore": item.get("lastScore"),
            "totalSubmissions": item.get("totalSubmissions"),
            "modelId": item.get("modelId"),
            "rank": rank,
        })

    return {"entries": entries}


def handle_get_submission_history(arguments, event):
    """Handle GetSubmissionHistory query.

    Query user's submissions from AgenticSubmissions table,
    filtered by mapId if provided.
    """
    user_id = _get_user_id(event)
    map_id = arguments.get("mapId") if arguments else None

    try:
        if map_id:
            response = submissions_table.query(
                KeyConditionExpression=Key("userId").eq(user_id),
                FilterExpression=Attr("mapId").eq(map_id),
                ScanIndexForward=False,
            )
        else:
            response = submissions_table.query(
                KeyConditionExpression=Key("userId").eq(user_id),
                ScanIndexForward=False,
            )
    except Exception as e:
        logger.error(f"Error querying submissions for user {user_id}: {e}")
        return {"items": []}

    items = response.get("Items", [])
    return {"items": items}


def handle_invoke_agent_core_runtime(arguments, event):
    """Handle InvokeAgentCoreRuntime mutation.

    Invokes the user's AgentCore Runtime for pathfinding via the async Game Runner
    Lambda. The navigationPath field carries the user's prompt text (e.g., "use strategy swift")
    which gets appended to the fixed navigation prompt.

    Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 9.8
    """
    map_id = arguments.get("mapId")
    navigation_path_json = arguments.get("navigationPath")  # User's prompt text (e.g., "use strategy swift")
    custom_model_count = arguments.get("customModelCount", 0) or 0
    map_data_json = arguments.get("mapData")  # Optional: inline map data for predefined maps
    user_id = _get_user_id(event)

    # navigationPath is always the user's prompt text for the agent (e.g., "use strategy swift")
    user_prompt = (navigation_path_json or "").strip()

    if not map_id:
        return {
            "sessionId": "error",
            "status": "error",
            "message": "mapId is required",
        }

    # Always use AgentCore Runtime invocation
    return _handle_agentcore_flow(
        map_id=map_id,
        custom_model_count=custom_model_count,
        map_data_json=map_data_json,
        user_id=user_id,
        event=event,
        user_prompt=user_prompt,
    )


def _resolve_tool_targets(user_id: str, tool_ids: list) -> list:
    """Resolve Lambda tool IDs to their function names (used as gateway target name prefixes).

    Each tool ID maps to a DynamoDB record (sk=LAMBDA#{toolId}) with a functionName field.
    The function name (e.g. 'AgentCoreGatewayTool-P') is used as a prefix to match
    gateway tools (e.g. 'AgentCoreGatewayTool-P___route').

    The container runtime appends '___' separator in startswith checks to prevent
    prefix collisions (e.g. 'P' matching 'Pathfinder').
    """
    targets = []
    for tool_id in tool_ids:
        try:
            resp = agent_configurations_table.get_item(
                Key={"userId": user_id, "sk": f"LAMBDA#{tool_id}"}
            )
            item = resp.get("Item")
            if item and item.get("functionName"):
                targets.append(item["functionName"])
        except Exception:
            pass
    return targets if targets else ["AgentCoreGatewayTool-Pathfinder"]


def _handle_agentcore_flow(
    map_id: str,
    custom_model_count: int,
    map_data_json: str,
    user_id: str,
    event: dict = None,
    user_prompt: str = "",
) -> dict:
    """Phase 2 flow: async Game Runner Lambda pattern.

    Creates a session, builds the invoke payload, and fires off the Game Runner
    Lambda asynchronously. Returns immediately with the session ID so the
    frontend can poll GetGameSession for updates.

    Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 9.8
    """
    # Step 1: Load user's runtime ARN from AgentConfigurations table
    # Falls back to AGENT_RUNTIME_ARN env var if not in DynamoDB
    runtime_arn = None
    try:
        runtime_response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "RUNTIME"}
        )
        runtime_item = runtime_response.get("Item")
        if runtime_item and runtime_item.get("runtimeArn"):
            runtime_arn = runtime_item["runtimeArn"]
    except Exception as e:
        logger.error(f"Error loading runtime config for user {user_id}: {e}")

    # Fallback: check AGENT_RUNTIME_ARN env var
    if not runtime_arn:
        runtime_arn = os.environ.get("AGENT_RUNTIME_ARN", "")

    if not runtime_arn:
        # Last resort: try auto-provisioning via handle_get_agent_core_runtime
        provision_event = event if event else {"identity": {"sub": user_id}}
        runtime_result = agent_config_handlers.handle_get_agent_core_runtime({}, provision_event)
        runtime_arn = runtime_result.get("runtimeArn")
        if not runtime_arn:
            return {
                "sessionId": "error",
                "status": "error",
                "message": runtime_result.get("message", "No AgentCore Runtime configured. Please set up your agent runtime in the Agent Builder or ask your admin to configure the AGENT_RUNTIME_ARN environment variable."),
            }

    # Step 2: Generate session ID and create initial session record
    session_id = str(uuid.uuid4())
    now = _now_iso()

    try:
        game_sessions_table.put_item(Item={
            "sessionId": session_id,
            "userId": user_id,
            "mapId": map_id,
            "status": "starting",
            "createdAt": now,
            "updatedAt": now,
        })
    except Exception as e:
        logger.error(f"Error creating game session: {e}")
        return {
            "sessionId": session_id,
            "status": "error",
            "message": f"Failed to create game session: {e}",
        }

    # Step 3: Load map data
    map_data = _load_map_data(map_id, map_data_json, session_id)
    if map_data is None:
        return {
            "sessionId": session_id,
            "status": "error",
            "message": "Failed to load map data",
        }
    if isinstance(map_data, dict) and map_data.get("__error"):
        return {
            "sessionId": session_id,
            "status": "error",
            "message": map_data["__error"],
        }

    # Step 4: Construct navigation prompt (with user's prompt appended)
    navigation_prompt = prompt_formatter.format_navigation_prompt(map_data)
    if user_prompt:
        navigation_prompt = navigation_prompt + " " + user_prompt

    # Step 5: Build invoke payload (for the orchestrator agent)
    invoke_payload = {
        "prompt": navigation_prompt,
        "task_type": "pathfinding",
        "session_id": session_id,
        "actor_id": user_id,
        "gateway_url": os.environ.get("GATEWAY_URL", ""),
    }

    # Load supervisor config for model_id and targets
    try:
        sup_response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "SUPERVISOR"}
        )
        sup_item = sup_response.get("Item")
        if not sup_item:
            # No config found — seed defaults for this user and use them
            agent_config_handlers._seed_defaults_for_user(user_id)
            sup_item = {
                "modelId": agent_config_handlers.DEFAULT_SUPERVISOR_CONFIG["modelId"],
                "systemPrompt": agent_config_handlers.DEFAULT_SUPERVISOR_CONFIG["systemPrompt"],
                "lambdaTools": agent_config_handlers.DEFAULT_SUPERVISOR_CONFIG["lambdaTools"],
                "subAgents": [agent_config_handlers.DEFAULT_PATHFINDER_SUBAGENT_ID],
            }

        configured_model = sup_item.get("modelId")
        if configured_model:
            invoke_payload["model_id"] = configured_model
        if sup_item.get("systemPrompt"):
            invoke_payload["supervisor_system_prompt"] = sup_item["systemPrompt"]
        # Resolve guardrail tool ID to Bedrock guardrail ID
        guardrail_tool_id = sup_item.get("guardrailTool")
        if guardrail_tool_id:
            try:
                gr_resp = agent_configurations_table.get_item(
                    Key={"userId": user_id, "sk": f"GUARDRAIL#{guardrail_tool_id}"}
                )
                gr_item = gr_resp.get("Item")
                if gr_item and gr_item.get("guardrailId"):
                    invoke_payload["guardrail_id"] = gr_item["guardrailId"]
                    invoke_payload["guardrail_version"] = "DRAFT"
            except Exception as e:
                logger.warning("Failed to resolve guardrail tool %s for user %s: %s", guardrail_tool_id, user_id, e)
        # Supervisor's own Lambda tool targets (if any attached directly)
        if sup_item.get("lambdaTools"):
            # Resolve tool IDs to function names (= gateway target names)
            supervisor_targets = _resolve_tool_targets(user_id, sup_item["lambdaTools"])
            if supervisor_targets:
                invoke_payload["supervisor_targets"] = supervisor_targets
        # Load sub-agents and pass them with their tool targets
        sub_agent_ids = sup_item.get("subAgents", [])
        if sub_agent_ids:
            sub_agents_config = []
            for sa_id in sub_agent_ids:
                try:
                    sa_resp = agent_configurations_table.get_item(
                        Key={"userId": user_id, "sk": f"SUBAGENT#{sa_id}"}
                    )
                    sa_item = sa_resp.get("Item")
                    if sa_item:
                        # Resolve Lambda tool IDs to Gateway target prefixes
                        targets = None
                        if sa_item.get("lambdaTools"):
                            targets = _resolve_tool_targets(user_id, sa_item["lambdaTools"])
                        sub_agents_config.append({
                            "id": sa_id,
                            "name": sa_item.get("name", "").replace(" ", "_"),
                            "system_prompt": sa_item.get("systemPrompt", ""),
                            "description": sa_item.get("name", "specialist agent"),
                            "model_id": sa_item.get("modelId", ""),
                            "targets": targets,
                        })
                except Exception:
                    pass
            if sub_agents_config:
                invoke_payload["subagents"] = sub_agents_config
    except Exception:
        pass

    # Step 6: Invoke Game Runner Lambda ASYNCHRONOUSLY (fire-and-forget)
    game_runner_fn = os.environ.get("GAME_RUNNER_FUNCTION", "")
    if not game_runner_fn:
        _update_session_error(session_id, "GAME_RUNNER_FUNCTION not configured")
        return {
            "sessionId": session_id,
            "status": "error",
            "message": "Game runner not configured",
        }

    try:
        lambda_client = boto3.client("lambda")
        lambda_client.invoke(
            FunctionName=game_runner_fn,
            InvocationType="Event",  # Async — fire and forget
            Payload=json.dumps({
                "session_id": session_id,
                "user_id": user_id,
                "prompt": navigation_prompt,
                "runtime_arn": runtime_arn,
                "invoke_payload": invoke_payload,
                "custom_model_count": custom_model_count,
                "map_data": json.dumps(map_data, default=_decimal_default) if isinstance(map_data, dict) else map_data_json,
                "navigation_prompt": navigation_prompt,
                "user_prompt": user_prompt,
            }).encode("utf-8"),
        )
    except Exception as e:
        logger.error(f"Error invoking Game Runner Lambda: {e}")
        _update_session_error(session_id, f"Failed to start game runner: {e}")
        return {
            "sessionId": session_id,
            "status": "error",
            "message": f"Failed to start game runner: {e}",
        }

    # Return immediately — frontend polls GetGameSession for updates
    return {
        "sessionId": session_id,
        "status": "starting",
        "message": "Game session started",
    }


def handle_submit_to_leaderboard(arguments, event):
    """Handle SubmitToLeaderboard mutation.

    Validates the session is completed, requires modelId, loads SUPERVISOR config,
    creates a version snapshot, upserts leaderboard entry (with modelId),
    and writes submission record (with modelId).

    Requirements: 16.1, 16.3, 17.3, 17.5
    """
    leaderboard_id = arguments.get("leaderboardId")
    session_id = arguments.get("sessionId")
    model_id = arguments.get("modelId")
    user_id = _get_user_id(event)

    if not leaderboard_id or not session_id:
        return {"success": False, "statusCode": 400, "message": "leaderboardId and sessionId are required"}

    # Require modelId parameter (Requirement 17.3)
    if not model_id:
        return {"success": False, "statusCode": 400, "message": "modelId is required for leaderboard submission"}

    # Load GameSession by sessionId
    try:
        session_response = game_sessions_table.get_item(Key={"sessionId": session_id})
    except Exception as e:
        logger.error(f"Error loading session {session_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to load session: {e}"}

    session = session_response.get("Item")
    if not session:
        return {"success": False, "statusCode": 404, "message": "Session not found"}

    # Validate status is "completed"
    if session.get("status") != "completed":
        return {
            "success": False,
            "statusCode": 400,
            "message": "Session must be completed before submission",
        }

    final_score = float(session.get("finalScore", 0))
    map_id = session.get("mapId", "")
    now = _now_iso()

    # Load SUPERVISOR config for the user (Requirement 16.1)
    supervisor_config = {}
    try:
        config_response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "SUPERVISOR"}
        )
        supervisor_config = config_response.get("Item", {})
    except Exception as e:
        logger.error(f"Error loading supervisor config for user {user_id}: {e}")
        # Continue with empty config — version snapshot will have minimal data

    # Create VERSION snapshot record (Requirements 16.1, 16.3)
    version_id = str(uuid.uuid4())
    try:
        version_record = {
            "userId": user_id,
            "sk": f"VERSION#{leaderboard_id}#{version_id}",
            "versionId": version_id,
            "name": supervisor_config.get("name", ""),
            "supervisorConfig": json.dumps(supervisor_config),
            "finalScore": final_score,
            "subAgentCount": len(supervisor_config.get("subAgents", [])),
            "gsi1pk": f"USER#{user_id}",
            "gsi1sk": f"VERSION#{now}",
            "createdAt": now,
            "updatedAt": now,
        }
        agent_configurations_table.put_item(Item=version_record)
    except Exception as e:
        logger.error(f"Error creating version snapshot: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to create version snapshot: {e}"}

    # Upsert leaderboard entry (include modelId per Requirement 17.5)
    sk = f"ENTRY#{user_id}"
    try:
        # Try to get existing entry
        existing_response = leaderboard_table.get_item(
            Key={"leaderboardId": leaderboard_id, "sk": sk}
        )
        existing = existing_response.get("Item")

        if existing:
            # Update: bestScore if higher, always update lastScore, increment totalSubmissions
            current_best = float(existing.get("bestScore", 0))
            update_expr = (
                "SET lastScore = :lastScore, "
                "totalSubmissions = totalSubmissions + :inc, "
                "updatedAt = :updatedAt, "
                "modelId = :modelId"
            )
            expr_values = {
                ":lastScore": final_score,
                ":inc": 1,
                ":updatedAt": now,
                ":modelId": model_id,
            }

            if final_score > current_best:
                update_expr += ", bestScore = :bestScore, bestSubmissionTime = :bestTime"
                expr_values[":bestScore"] = final_score
                expr_values[":bestTime"] = now

            leaderboard_table.update_item(
                Key={"leaderboardId": leaderboard_id, "sk": sk},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
            )
        else:
            # Create new entry (include modelId)
            leaderboard_table.put_item(Item={
                "leaderboardId": leaderboard_id,
                "sk": sk,
                "userId": user_id,
                "alias": user_id,
                "avatar": None,
                "bestScore": final_score,
                "lastScore": final_score,
                "totalSubmissions": 1,
                "bestSubmissionTime": now,
                "modelId": model_id,
                "createdAt": now,
                "updatedAt": now,
            })
    except Exception as e:
        logger.error(f"Error upserting leaderboard entry: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to update leaderboard: {e}"}

    # Write submission record to AgenticSubmissions table (include modelId per Requirement 17.5)
    try:
        submissions_table.put_item(Item={
            "userId": user_id,
            "updatedTime": now,
            "mapId": map_id,
            "leaderboardId": leaderboard_id,
            "sessionId": session_id,
            "finalScore": final_score,
            "modelId": model_id,
            "correctAnswers": session.get("correctAnswers", 0),
            "totalChallenges": session.get("totalChallenges", 0),
            "qaScore": session.get("qaScore", 0),
            "lifeBonusScore": session.get("lifeBonusScore", 0),
            "givenTokenBonus": session.get("givenTokenBonus", 0),
            "livesRemaining": session.get("livesRemaining", 0),
            "treasureBonus": session.get("treasureBonus", 0),
        })
    except Exception as e:
        logger.error(f"Error writing submission record: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to write submission: {e}"}

    return {"success": True, "statusCode": 200, "message": "Successfully submitted to leaderboard"}


def handle_get_llm_configuration(arguments, event):
    """Handle GetLlmConfiguration query.

    Read from AgentConfigurations table (userId from event identity, sk="LLM_CONFIG").
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "LLM_CONFIG"}
        )
    except Exception as e:
        logger.error(f"Error loading LLM config for user {user_id}: {e}")
        return {
            "defaultModel": None,
            "challengeGeneration": None,
            "challengeGrading": None,
            "gameCommentary": None,
        }

    item = response.get("Item")
    if not item:
        return {
            "defaultModel": None,
            "challengeGeneration": None,
            "challengeGrading": None,
            "gameCommentary": None,
        }

    data = item.get("data", {})
    return {
        "defaultModel": data.get("defaultModel"),
        "challengeGeneration": data.get("challengeGeneration"),
        "challengeGrading": data.get("challengeGrading"),
        "gameCommentary": data.get("gameCommentary"),
    }


def handle_save_llm_configuration(arguments, event):
    """Handle SaveLlmConfiguration mutation.

    Write to AgentConfigurations table (userId from event identity, sk="LLM_CONFIG").
    """
    user_id = _get_user_id(event)
    now = _now_iso()

    data = {
        "defaultModel": arguments.get("defaultModel"),
        "challengeGeneration": arguments.get("challengeGeneration"),
        "challengeGrading": arguments.get("challengeGrading"),
        "gameCommentary": arguments.get("gameCommentary"),
    }

    try:
        agent_configurations_table.put_item(Item={
            "userId": user_id,
            "sk": "LLM_CONFIG",
            "data": data,
            "updatedAt": now,
        })
    except Exception as e:
        logger.error(f"Error saving LLM config for user {user_id}: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to save configuration: {e}"}

    return {"success": True, "statusCode": 200, "message": "Configuration saved successfully"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_map_data(map_id: str, map_data_json: str, session_id: str):
    """Load map data from inline JSON or DynamoDB.

    Returns the map_data dict, or a dict with '__error' key on failure.
    """
    if map_data_json:
        try:
            return json.loads(map_data_json)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Error parsing inline mapData: {e}")
            _update_session_error(session_id, f"Invalid inline map data: {e}")
            return {"__error": f"Invalid inline map data: {e}"}
    else:
        # Load from Maps table (scan by mapId since table uses userId+mapId composite key)
        try:
            map_response = maps_table.scan(
                FilterExpression=Attr("mapId").eq(map_id),
            )
        except Exception as e:
            logger.error(f"Error loading map {map_id}: {e}")
            _update_session_error(session_id, f"Failed to load map: {e}")
            return {"__error": f"Failed to load map: {e}"}

        map_items = map_response.get("Items", [])
        if not map_items:
            _update_session_error(session_id, "Map not found")
            return {"__error": "Map not found"}

        return map_items[0]


def _persist_game_results(session_id: str, results: dict, custom_model_count: int):
    """Persist final game results to GameSessions table."""
    try:
        game_sessions_table.update_item(
            Key={"sessionId": session_id},
            UpdateExpression=(
                "SET #status = :status, "
                "gameEvents = :gameEvents, "
                "consumedTiles = :consumedTiles, "
                "plannedPath = :plannedPath, "
                "finalScore = :finalScore, "
                "qaScore = :qaScore, "
                "lifeBonusScore = :lifeBonusScore, "
                "givenTokenBonus = :givenTokenBonus, "
                "treasureBonus = :treasureBonus, "
                "livesRemaining = :livesRemaining, "
                "reachedTreasure = :reachedTreasure, "
                "customModelCount = :customModelCount, "
                "updatedAt = :updatedAt"
            ),
            ExpressionAttributeNames={
                "#status": "status",
            },
            ExpressionAttributeValues={
                ":status": results["status"],
                ":gameEvents": json.dumps(results["gameEvents"]),
                ":consumedTiles": json.dumps(results["consumedTiles"]),
                ":plannedPath": json.dumps(results["plannedPath"]),
                ":finalScore": results["finalScore"],
                ":qaScore": results["qaScore"],
                ":lifeBonusScore": results["lifeBonusScore"],
                ":givenTokenBonus": results["givenTokenBonus"],
                ":treasureBonus": results["treasureBonus"],
                ":livesRemaining": results["livesRemaining"],
                ":reachedTreasure": results["reachedTreasure"],
                ":customModelCount": custom_model_count,
                ":updatedAt": _now_iso(),
            },
        )
    except Exception as e:
        logger.error(f"Error updating game session {session_id}: {e}")


def _update_session_error(session_id: str, error_message: str):
    """Update a game session with error status."""
    try:
        game_sessions_table.update_item(
            Key={"sessionId": session_id},
            UpdateExpression="SET #status = :status, #error = :error, updatedAt = :updatedAt",
            ExpressionAttributeNames={
                "#status": "status",
                "#error": "error",
            },
            ExpressionAttributeValues={
                ":status": "error",
                ":error": error_message,
                ":updatedAt": _now_iso(),
            },
        )
    except Exception as e:
        logger.error(f"Error updating session {session_id} with error: {e}")
