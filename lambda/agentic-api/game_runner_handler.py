"""Async Game Runner Lambda — invoked asynchronously by the resolver.

This handler runs in a separate Lambda function with a 10-minute timeout,
allowing long-running game sessions to complete without hitting the AppSync
resolver timeout (30s) or API Gateway timeout (29s).

The resolver creates the session in DynamoDB, then invokes this Lambda with
InvocationType="Event" (fire-and-forget). The frontend polls GetGameSession.
"""

import json
import os
import logging
import traceback

import boto3

from agentcore_client import invoke_agent_runtime, AgentCoreTimeoutError
import path_parser
import game_runner

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GAME_SESSIONS_TABLE = os.environ.get("GAME_SESSIONS_TABLE", "")


def handler(event, context):
    """Async game runner — invoked asynchronously by the resolver."""
    session_id = event.get("session_id", "")
    user_id = event.get("user_id", "")
    prompt = event.get("prompt", "")
    runtime_arn = event.get("runtime_arn", "")
    invoke_payload = event.get("invoke_payload", {})
    custom_model_count = event.get("custom_model_count", 0)
    navigation_prompt = event.get("navigation_prompt", "")
    user_prompt = event.get("user_prompt", "")

    dynamodb = boto3.resource("dynamodb")
    gs_table = dynamodb.Table(GAME_SESSIONS_TABLE)

    try:
        # Update session status to "invoking"
        _update_session(gs_table, session_id, {"status": "invoking"})

        # Step 1: Invoke AgentCore Runtime for pathfinding (with retry on empty/unparseable response)
        agent_response = ""
        nav_path = None
        map_data_raw = event.get("map_data", "{}")
        map_data = json.loads(map_data_raw) if isinstance(map_data_raw, str) else map_data_raw
        player_start = map_data.get("playerStart")
        if not player_start:
            # Scan grid for the 'start' tile
            grid = map_data.get("grid", [])
            player_start = {"row": 0, "col": 0}
            for r, row in enumerate(grid):
                for c, cell in enumerate(row):
                    if cell == "start":
                        player_start = {"row": r, "col": c}
                        break
                else:
                    continue
                break
        start_pos = (player_start["row"], player_start["col"])

        for attempt in range(3):
            agent_response = invoke_agent_runtime(
                runtime_arn=runtime_arn,
                payload=invoke_payload,
                timeout=90,
                session_id=f"{session_id}-attempt{attempt}" if attempt > 0 else session_id,
            )
            if agent_response:
                # Try to parse immediately — if parseable, we're done
                nav_path = path_parser.parse_navigation_path(agent_response, start=start_pos)
                if nav_path:
                    break
                logger.warning("Attempt %d: agent response not parseable (%d chars), retrying...", attempt + 1, len(agent_response))
            else:
                logger.warning("Attempt %d: empty agent response, retrying...", attempt + 1)
            import time
            time.sleep(3)

        logger.info("Agent response length: %d chars", len(agent_response) if agent_response else 0)

        if not agent_response:
            _update_session(gs_table, session_id, {
                "status": "error",
                "error": "Agent returned empty response after 3 attempts — runtime may be cold starting. Please try again.",
                "agentResponse": "",
            })
            return

        _update_session(gs_table, session_id, {
            "status": "parsing",
            "agentResponse": agent_response[:5000],
        })

        # Step 2: nav_path already parsed in retry loop above
        if not nav_path:
            _update_session(gs_table, session_id, {
                "status": "error",
                "error": "Could not parse agent response into navigation path",
                "agentResponse": agent_response[:5000],
            })
            return

        # Step 3: Write planned path
        planned_path = [{"row": p[0], "col": p[1]} for p in nav_path]
        _update_session(gs_table, session_id, {
            "status": "playing",
            "plannedPath": json.dumps(planned_path),
        })

        # Step 4: Run game session with incremental flush
        def db_flush_fn(sid, game_events, consumed_tiles, status):
            """Write current game state to GameSessions table for incremental polling."""
            try:
                _update_session(gs_table, sid, {
                    "gameEvents": json.dumps(game_events),
                    "consumedTiles": json.dumps(list(consumed_tiles)),
                    "status": status,
                })
            except Exception as e:
                logger.error("Flush error: %s", e)

        results = game_runner.run_game_session_v2(
            session_id=session_id,
            map_data=map_data,
            navigation_path=nav_path,
            custom_model_count=custom_model_count,
            runtime_arn=runtime_arn,
            db_flush_fn=db_flush_fn,
            navigation_prompt=navigation_prompt,
            agent_response=agent_response,
            user_prompt=user_prompt,
            invoke_payload=invoke_payload,
        )

        # Step 5: Persist final results
        _update_session(gs_table, session_id, {
            "status": results["status"],
            "gameEvents": json.dumps(results["gameEvents"]),
            "consumedTiles": json.dumps(results["consumedTiles"]),
            "plannedPath": json.dumps(results["plannedPath"]),
            "finalScore": int(results["finalScore"]),
            "qaScore": int(results["qaScore"]),
            "lifeBonusScore": int(results["lifeBonusScore"]),
            "givenTokenBonus": int(results["givenTokenBonus"]),
            "treasureBonus": int(results["treasureBonus"]),
            "livesRemaining": int(results["livesRemaining"]),
            "reachedTreasure": results["reachedTreasure"],
            "customModelCount": int(custom_model_count),
        })
        logger.info(
            "Game complete: session=%s, status=%s, score=%s",
            session_id, results["status"], results["finalScore"],
        )

    except AgentCoreTimeoutError:
        logger.error("AgentCore timeout for session %s", session_id)
        try:
            _update_session(gs_table, session_id, {
                "status": "error",
                "error": "Agent pathfinding timed out after 90 seconds",
            })
        except Exception:
            pass

    except Exception as e:
        logger.error("Game runner failed: %s", str(e))
        logger.error(traceback.format_exc())
        try:
            _update_session(gs_table, session_id, {
                "status": "error",
                "error": str(e)[:500],
            })
        except Exception:
            pass


def _update_session(table, session_id, updates):
    """Update a game session in DynamoDB with arbitrary fields."""
    expr_parts = []
    attr_names = {}
    attr_values = {}
    for i, (k, v) in enumerate(updates.items()):
        alias = f"#k{i}"
        val_alias = f":v{i}"
        expr_parts.append(f"{alias} = {val_alias}")
        attr_names[alias] = k
        attr_values[val_alias] = v

    kwargs = {
        "Key": {"sessionId": session_id},
        "UpdateExpression": "SET " + ", ".join(expr_parts),
        "ExpressionAttributeNames": attr_names,
        "ExpressionAttributeValues": attr_values,
    }
    table.update_item(**kwargs)
