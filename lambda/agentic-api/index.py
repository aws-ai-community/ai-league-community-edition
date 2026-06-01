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
    """Extract user identity from AppSync event, defaulting to 'anonymous'."""
    return event.get("identity", {}).get("sub", "anonymous") if event.get("identity") else "anonymous"


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


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
        # Mutations
        "InvokeAgentCoreRuntime": handle_invoke_agent_core_runtime,
        "SubmitToLeaderboard": handle_submit_to_leaderboard,
        "SaveLlmConfiguration": handle_save_llm_configuration,
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
            Limit=1,
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

    Creates a GameSession record, loads the map, runs the game session,
    updates the session with results, and returns InvokeRuntimeResponse.
    """
    map_id = arguments.get("mapId")
    navigation_path_json = arguments.get("navigationPath")
    custom_model_count = arguments.get("customModelCount", 0) or 0
    map_data_json = arguments.get("mapData")  # Optional: inline map data for predefined maps
    user_id = _get_user_id(event)

    if not map_id or not navigation_path_json:
        return {
            "sessionId": "error",
            "status": "error",
            "message": "mapId and navigationPath are required",
        }

    # Parse navigation path from JSON string to list of [row, col]
    try:
        navigation_path = json.loads(navigation_path_json)
    except (json.JSONDecodeError, TypeError) as e:
        return {
            "sessionId": "error",
            "status": "error",
            "message": f"Invalid navigationPath JSON: {e}",
        }

    # Convert to list of tuples
    navigation_path_tuples = [(step[0], step[1]) for step in navigation_path]

    # Generate session ID
    session_id = str(uuid.uuid4())
    now = _now_iso()

    # Create GameSession record with status "in_progress"
    try:
        game_sessions_table.put_item(Item={
            "sessionId": session_id,
            "userId": user_id,
            "mapId": map_id,
            "status": "in_progress",
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

    # Load map: use inline mapData if provided (predefined maps), otherwise load from DynamoDB
    if map_data_json:
        try:
            map_data = json.loads(map_data_json)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Error parsing inline mapData: {e}")
            _update_session_error(session_id, f"Invalid inline map data: {e}")
            return {
                "sessionId": session_id,
                "status": "error",
                "message": f"Invalid inline map data: {e}",
            }
    else:
        # Load from Maps table (scan by mapId since table uses userId+mapId composite key)
        try:
            map_response = maps_table.scan(
                FilterExpression=Attr("mapId").eq(map_id),
                Limit=1,
            )
        except Exception as e:
            logger.error(f"Error loading map {map_id}: {e}")
            _update_session_error(session_id, f"Failed to load map: {e}")
            return {
                "sessionId": session_id,
                "status": "error",
                "message": f"Failed to load map: {e}",
            }

        map_items = map_response.get("Items", [])
        if not map_items:
            _update_session_error(session_id, "Map not found")
            return {
                "sessionId": session_id,
                "status": "error",
                "message": "Map not found",
            }

        map_data = map_items[0]

    # Run the game session
    try:
        results = game_runner.run_game_session(
            session_id=session_id,
            map_data=map_data,
            navigation_path=navigation_path_tuples,
            custom_model_count=custom_model_count,
        )
    except Exception as e:
        logger.error(f"Error running game session: {e}")
        _update_session_error(session_id, f"Game runner error: {e}")
        return {
            "sessionId": session_id,
            "status": "error",
            "message": f"Game runner error: {e}",
        }

    # Update GameSession with results
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

    return {
        "sessionId": session_id,
        "status": results["status"],
        "message": "Game session completed",
    }


def handle_submit_to_leaderboard(arguments, event):
    """Handle SubmitToLeaderboard mutation.

    Validates the session is completed, upserts leaderboard entry
    (update bestScore if new score is higher, always update lastScore,
    increment totalSubmissions), and writes submission record.
    """
    leaderboard_id = arguments.get("leaderboardId")
    session_id = arguments.get("sessionId")
    user_id = _get_user_id(event)

    if not leaderboard_id or not session_id:
        return {"success": False, "statusCode": 400, "message": "leaderboardId and sessionId are required"}

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

    # Upsert leaderboard entry
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
                "updatedAt = :updatedAt"
            )
            expr_values = {
                ":lastScore": final_score,
                ":inc": 1,
                ":updatedAt": now,
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
            # Create new entry
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
                "createdAt": now,
                "updatedAt": now,
            })
    except Exception as e:
        logger.error(f"Error upserting leaderboard entry: {e}")
        return {"success": False, "statusCode": 500, "message": f"Failed to update leaderboard: {e}"}

    # Write submission record to AgenticSubmissions table (include mapId)
    try:
        submissions_table.put_item(Item={
            "userId": user_id,
            "updatedTime": now,
            "mapId": map_id,
            "leaderboardId": leaderboard_id,
            "sessionId": session_id,
            "finalScore": final_score,
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
