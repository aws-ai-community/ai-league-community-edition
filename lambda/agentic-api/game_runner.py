"""Game Runner — orchestrates a complete game session.

Contains two entry points:
- run_game_session: Phase 1 pure function (no DynamoDB writes, uses PLACEHOLDER_RESPONSE)
- run_game_session_v2: Phase 2 with AgentCore invocations and incremental DB flush

Phase 1 processes a navigation path step by step through a map, handling challenges,
passive tiles, doors/keys, and scoring as a PURE function — no DynamoDB writes happen.

Phase 2 (run_game_session_v2) invokes the user's AgentCore Runtime for each challenge,
flushes events incrementally to DynamoDB via db_flush_fn callback, and tracks token usage.

Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Set, Tuple

from challenge_grader import grade_response
from score_calculator import compute_final_score
from agentcore_client import invoke_agent_runtime, AgentCoreTimeoutError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PASSIVE_COINS = "c7"
PASSIVE_SPIKES = "c8"

# Treasure tile identifier
TREASURE_TILE = "treasure"

# Door tiles and their matching key tiles
DOOR_TILES = {"c30", "c31", "c32", "c33"}
KEY_TILES = {"c40", "c41", "c42", "c43"}

# Key → Door mapping (collecting a key unlocks the corresponding door)
KEY_TO_DOOR: Dict[str, str] = {
    "c40": "c30",  # Red key → Red door
    "c41": "c31",  # Green key → Green door
    "c42": "c32",  # Grey key → Grey door
    "c43": "c33",  # Yellow key → Yellow door
}

# Challenge tile types that require grading
CHALLENGE_TILES = {
    "c1", "c2", "c3", "c4", "c5", "c6",
    "c17", "c18",
    "c30", "c31", "c32", "c33",
    "c40", "c41", "c42", "c43",
}

# Human-readable challenge names (matching real AWS AI League game format)
CHALLENGE_NAMES: Dict[str, str] = {
    "c1": "Violent Violet",
    "c2": "Code Challenge Challenge",
    "c3": "Memento Challenge",
    "c4": "Web Search Challenge",
    "c5": "Simple Question Challenge",
    "c6": "Boss Challenge",
    "c7": "some Coins",
    "c8": "a Spike trap",
    "c17": "A Distraction",
    "c18": "Risk Analyzer",
    "c30": "a Red Door",
    "c31": "a Green Door",
    "c32": "a Grey Door",
    "c33": "a Yellow Door",
    "c40": "a Red Key",
    "c41": "a Green Key",
    "c42": "a Grey Key",
    "c43": "a Yellow Key",
}

# Default tile points and damage values
DEFAULT_TILE_CONFIG: Dict[str, Dict[str, int]] = {
    "c1": {"points": 400, "damage": 1},
    "c2": {"points": 600, "damage": 1},
    "c3": {"points": 550, "damage": 1},
    "c4": {"points": 800, "damage": 1},
    "c5": {"points": 250, "damage": 1},
    "c6": {"points": 1000, "damage": 2},
    "c7": {"points": 250, "damage": 0},
    "c8": {"points": 0, "damage": 1},
    "c17": {"points": 750, "damage": 2},
    "c18": {"points": 500, "damage": 1},
    "c30": {"points": 1000, "damage": 5},
    "c31": {"points": 1000, "damage": 5},
    "c32": {"points": 1000, "damage": 5},
    "c33": {"points": 1000, "damage": 5},
    "c40": {"points": 50, "damage": 0},
    "c41": {"points": 50, "damage": 0},
    "c42": {"points": 50, "damage": 0},
    "c43": {"points": 50, "damage": 0},
}

# Placeholder response for Phase 1 (AgentCore integration is Phase 2)
PLACEHOLDER_RESPONSE = "CORRECT"

# Hard timeout for each AgentCore invocation (seconds)
INVOCATION_TIMEOUT_SECONDS = 90


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run_game_session(
    session_id: str,
    map_data: Dict[str, Any],
    navigation_path: List[Tuple[int, int]],
    custom_model_count: int = 0,
) -> Dict[str, Any]:
    """Run a complete game session and return results.

    This is a pure function — it does not write to DynamoDB. The caller
    (resolver router) is responsible for persisting the results.

    Args:
        session_id: Unique session identifier.
        map_data: Full map document including grid, challenges, defaults, tileOverrides, playerStart.
        navigation_path: Ordered list of (row, col) positions the champion moves through.
        custom_model_count: Number of custom/fine-tuned models used (for token bonus calculation).

    Returns:
        Dict with: status, gameEvents, consumedTiles, finalScore, qaScore, lifeBonusScore,
        givenTokenBonus, treasureBonus, livesRemaining, reachedTreasure, plannedPath.
    """
    grid = map_data.get("grid", [])
    challenges = map_data.get("challenges", {})
    defaults = map_data.get("defaults", {})
    tile_overrides = map_data.get("tileOverrides", {})

    rows = len(grid)
    cols = len(grid[0]) if rows > 0 else 0

    # Game state
    lives = defaults.get("lives", 5)
    score = 0
    coin_points = 0
    challenge_points = 0
    total_tokens = 0
    challenges_visited = 0
    game_events: List[Dict[str, Any]] = []
    consumed_tiles: Set[str] = set()
    collected_keys: Set[str] = set()  # Stores door tile IDs that are unlocked (e.g., "c30")
    reached_treasure = False
    status = "completed"

    for pos in navigation_path:
        r, c = pos[0], pos[1]

        # Off-grid step = instant game over
        if r < 0 or r >= rows or c < 0 or c >= cols:
            lives = 0
            status = "game_over"
            break

        cell = grid[r][c]

        # Wall collision = instant game over
        if cell == "wall":
            lives = 0
            status = "game_over"
            break

        # Emit MoveSpace for every position change
        game_events.append({
            "type": "MoveSpace",
            "position": {"row": r, "col": c},
        })

        pos_key = f"{r},{c}"

        # Skip already-consumed tiles — revisiting has no effect
        if pos_key in consumed_tiles:
            continue

        # --- Treasure tile ---
        if cell == TREASURE_TILE:
            treasure_bonus_value = defaults.get("treasureBonus", 1000)
            reached_treasure = True
            game_events.append({
                "type": "WinGame",
                "points": treasure_bonus_value,
                "position": {"row": r, "col": c},
            })
            consumed_tiles.add(pos_key)
            break

        # --- Passive coin tile (c7) ---
        if cell == PASSIVE_COINS:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            pts = tile_cfg["points"]
            score += pts
            coin_points += pts
            consumed_tiles.add(pos_key)
            game_events.append({
                "type": "WinNonPromptChallenge",
                "challengeId": cell,
                "challengeName": CHALLENGE_NAMES.get(cell, "Coins"),
                "damage": 0,
                "points": pts,
                "position": {"row": r, "col": c},
                "scoreAfter": score,
                "livesAfter": lives,
            })
            continue

        # --- Passive spike tile (c8) ---
        if cell == PASSIVE_SPIKES:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            dmg = tile_cfg["damage"]
            lives -= dmg
            consumed_tiles.add(pos_key)
            game_events.append({
                "type": "LoseNonPromptChallenge",
                "challengeId": cell,
                "challengeName": CHALLENGE_NAMES.get(cell, "Spikes"),
                "damage": dmg,
                "points": 0,
                "position": {"row": r, "col": c},
                "scoreAfter": score,
                "livesAfter": max(0, lives),
            })
            if lives <= 0:
                status = "game_over"
                break
            continue

        # --- Door tiles (c30-c33) ---
        if cell in DOOR_TILES:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            if cell not in collected_keys:
                # Key not collected — deduct damage
                dmg = tile_cfg["damage"]
                lives -= dmg
                consumed_tiles.add(pos_key)
                game_events.append({
                    "type": "LoseNonPromptChallenge",
                    "challengeId": cell,
                    "challengeName": f"Door ({cell})",
                    "damage": dmg,
                    "points": 0,
                    "position": {"row": r, "col": c},
                    "scoreAfter": score,
                    "livesAfter": max(0, lives),
                })
                if lives <= 0:
                    status = "game_over"
                    break
            else:
                # Key collected — door opens, award points via challenge
                consumed_tiles.add(pos_key)
                challenge_data = challenges.get(pos_key)
                if challenge_data:
                    pts = tile_cfg["points"]
                    question = challenge_data.get("question", "")
                    expected = challenge_data.get("expectedAnswer", "")
                    strategy = challenge_data.get("gradingStrategy", "contains_match")

                    game_events.append({
                        "type": "FoundChallenge",
                        "challengeName": CHALLENGE_NAMES.get(cell, f"Door ({cell})"),
                        "position": {"row": r, "col": c},
                    })
                    game_events.append({
                        "type": "AskChallenge",
                        "message": question,
                        "challengeId": cell,
                        "position": {"row": r, "col": c},
                    })

                    is_correct = grade_response(PLACEHOLDER_RESPONSE, expected, strategy, cell)
                    challenges_visited += 1

                    if is_correct:
                        challenge_points += pts
                        score += pts
                        game_events.append({
                            "type": "WinChallenge",
                            "challengeId": cell,
                            "challengePoints": pts,
                            "points": pts,
                            "position": {"row": r, "col": c},
                            "scoreAfter": score,
                            "livesAfter": lives,
                        })
                    else:
                        dmg = tile_cfg["damage"]
                        lives -= dmg
                        game_events.append({
                            "type": "LoseChallenge",
                            "challengeId": cell,
                            "damage": dmg,
                            "position": {"row": r, "col": c},
                            "scoreAfter": score,
                            "livesAfter": max(0, lives),
                        })
                        if lives <= 0:
                            status = "game_over"
                            break
                else:
                    # No challenge assigned to door — just pass through
                    pass
            continue

        # --- Key tiles (c40-c43) ---
        if cell in KEY_TILES:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            door_tile = KEY_TO_DOOR[cell]
            collected_keys.add(door_tile)
            consumed_tiles.add(pos_key)

            # Key tiles have a challenge if assigned
            challenge_data = challenges.get(pos_key)
            if challenge_data:
                question = challenge_data.get("question", "")
                expected = challenge_data.get("expectedAnswer", "")
                strategy = challenge_data.get("gradingStrategy", "contains_match")
                pts = tile_cfg["points"]
                dmg = tile_cfg.get("damage", 1)

                game_events.append({
                    "type": "FoundChallenge",
                    "challengeName": CHALLENGE_NAMES.get(cell, f"Key ({cell})"),
                    "position": {"row": r, "col": c},
                })
                game_events.append({
                    "type": "AskChallenge",
                    "message": question,
                    "challengeId": cell,
                    "position": {"row": r, "col": c},
                })

                is_correct = grade_response(PLACEHOLDER_RESPONSE, expected, strategy, cell)
                challenges_visited += 1

                if is_correct:
                    challenge_points += pts
                    score += pts
                    game_events.append({
                        "type": "WinChallenge",
                        "challengeId": cell,
                        "challengePoints": pts,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": lives,
                    })
                else:
                    lives -= dmg
                    game_events.append({
                        "type": "LoseChallenge",
                        "challengeId": cell,
                        "damage": dmg,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": max(0, lives),
                    })
                    if lives <= 0:
                        status = "game_over"
                        break
            else:
                # No challenge — just collect the key silently (award points)
                pts = tile_cfg["points"]
                score += pts
                coin_points += pts  # Key points count as coin-like points
                game_events.append({
                    "type": "WinNonPromptChallenge",
                    "challengeId": cell,
                    "challengeName": f"Key ({cell})",
                    "damage": 0,
                    "points": pts,
                    "position": {"row": r, "col": c},
                    "scoreAfter": score,
                    "livesAfter": lives,
                })
            continue

        # --- Challenge tiles (c1-c6, c17, c18) ---
        if cell in CHALLENGE_TILES and cell not in DOOR_TILES and cell not in KEY_TILES:
            challenge_data = challenges.get(pos_key)
            if challenge_data:
                tile_cfg = _get_tile_config(cell, tile_overrides)
                question = challenge_data.get("question", "")
                expected = challenge_data.get("expectedAnswer", "")
                strategy = challenge_data.get("gradingStrategy", "contains_match")
                pts = tile_cfg["points"]
                dmg = tile_cfg["damage"]

                game_events.append({
                    "type": "FoundChallenge",
                    "challengeName": CHALLENGE_NAMES.get(cell, cell),
                    "position": {"row": r, "col": c},
                })
                game_events.append({
                    "type": "AskChallenge",
                    "message": question,
                    "challengeId": cell,
                    "position": {"row": r, "col": c},
                })

                is_correct = grade_response(PLACEHOLDER_RESPONSE, expected, strategy, cell)
                challenges_visited += 1
                consumed_tiles.add(pos_key)

                if is_correct:
                    challenge_points += pts
                    score += pts
                    game_events.append({
                        "type": "WinChallenge",
                        "challengeId": cell,
                        "challengePoints": pts,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": lives,
                    })
                else:
                    lives -= dmg
                    game_events.append({
                        "type": "LoseChallenge",
                        "challengeId": cell,
                        "damage": dmg,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": max(0, lives),
                    })
                    if lives <= 0:
                        status = "game_over"
                        break
            else:
                # Challenge tile without assignment — skip (treat as normal)
                consumed_tiles.add(pos_key)
            continue

        # --- Normal tiles and any other unrecognized tiles — no action beyond MoveSpace ---

    # --- End of path processing ---

    # Compute final score using score_calculator
    map_defaults = defaults if defaults else {
        "livesBonusMultiplier": 250,
        "tokenBonus": 1000,
        "treasureBonus": 1000,
    }

    score_breakdown = compute_final_score(
        challenge_points=challenge_points,
        coin_points=coin_points,
        treasure_reached=reached_treasure,
        lives_remaining=max(0, lives),
        total_tokens=total_tokens,
        challenges_visited=challenges_visited,
        custom_model_count=custom_model_count,
        map_defaults=map_defaults,
    )

    # Emit ScoreSummary event
    last_pos = {"row": 0, "col": 0}
    if navigation_path:
        last_step = navigation_path[-1]
        last_pos = {"row": last_step[0], "col": last_step[1]}

    game_events.append({
        "type": "ScoreSummary",
        "position": last_pos,
        "livesRemaining": max(0, lives),
        "lifeBonusScore": score_breakdown["lifeBonusScore"],
        "coinBonus": coin_points,
        "givenTokenBonus": score_breakdown["givenTokenBonus"],
        "treasureBonus": score_breakdown["treasureBonus"],
        "finalScore": score_breakdown["finalScore"],
        "challengeScore": challenge_points,
        "challengesAttempted": challenges_visited,
        "tokensUsed": total_tokens,
        "customModelCount": custom_model_count,
    })

    # Build planned path for frontend overlay
    planned_path = [{"row": p[0], "col": p[1]} for p in navigation_path]

    return {
        "status": status,
        "gameEvents": game_events,
        "consumedTiles": list(consumed_tiles),
        "finalScore": score_breakdown["finalScore"],
        "qaScore": score_breakdown["qaScore"],
        "lifeBonusScore": score_breakdown["lifeBonusScore"],
        "givenTokenBonus": score_breakdown["givenTokenBonus"],
        "treasureBonus": score_breakdown["treasureBonus"],
        "livesRemaining": max(0, lives),
        "reachedTreasure": reached_treasure,
        "plannedPath": planned_path,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_tile_config(cell: str, tile_overrides: Dict[str, Any]) -> Dict[str, int]:
    """Get points and damage for a tile type, with overrides taking precedence."""
    default = DEFAULT_TILE_CONFIG.get(cell, {"points": 0, "damage": 0})
    override = tile_overrides.get(cell, {})
    return {
        "points": override.get("points", default["points"]),
        "damage": override.get("damage", default["damage"]),
    }


# ---------------------------------------------------------------------------
# Game Runner v2 — AgentCore Runtime integration
# ---------------------------------------------------------------------------


def run_game_session_v2(
    session_id: str,
    map_data: Dict[str, Any],
    navigation_path: List[Tuple[int, int]],
    custom_model_count: int,
    runtime_arn: str,
    db_flush_fn,
    navigation_prompt: str = "",
    agent_response: str = "",
    user_prompt: str = "",
    invoke_payload: Dict[str, Any] = None,
    pathfinding_tokens: int = 0,
    time_limit: int = 0,
) -> Dict[str, Any]:
    """Run a game session with AgentCore Runtime invocations and incremental flush.

    Unlike run_game_session (Phase 1, pure function), this version:
    - Invokes AgentCore Runtime for each challenge instead of PLACEHOLDER_RESPONSE
    - Calls db_flush_fn after every MoveSpace and before/after each challenge invocation
    - Flushes FoundChallenge + AskChallenge BEFORE invoking agent (frontend sees question while waiting)
    - Tracks cumulative total_tokens across all invocations
    - On AgentCoreTimeoutError: treats as incorrect answer, continues path execution

    Args:
        session_id: Unique session identifier.
        map_data: Full map document including grid, challenges, defaults, tileOverrides, playerStart.
        navigation_path: Ordered list of (row, col) positions the champion moves through.
        custom_model_count: Number of custom/fine-tuned models used (for token bonus calculation).
        runtime_arn: User's AgentCore Runtime ARN for agent invocations.
        db_flush_fn: Callable(session_id, game_events, consumed_tiles, status) for incremental writes.

    Returns:
        Dict with: status, gameEvents, consumedTiles, finalScore, qaScore, lifeBonusScore,
        givenTokenBonus, treasureBonus, livesRemaining, reachedTreasure, plannedPath, totalTokens.
    """
    grid = map_data.get("grid", [])
    challenges = map_data.get("challenges", {})
    defaults = map_data.get("defaults", {})
    tile_overrides = map_data.get("tileOverrides", {})

    rows = len(grid)
    cols = len(grid[0]) if rows > 0 else 0

    # Game state
    lives = defaults.get("lives", 5)
    score = 0
    coin_points = 0
    challenge_points = 0
    total_tokens = pathfinding_tokens
    challenges_visited = 0
    correct_answers = 0
    game_events: List[Dict[str, Any]] = []
    consumed_tiles: Set[str] = set()
    collected_keys: Set[str] = set()
    reached_treasure = False
    status = "completed"
    game_start_time = time.time()

    # Emit initial events matching reference app pattern
    player_start = map_data.get("playerStart")
    if not isinstance(player_start, dict) or "row" not in player_start or "col" not in player_start:
        # Scan grid for the 'start' tile
        player_start = None
        for r, row in enumerate(grid):
            for c, cell in enumerate(row):
                if cell == "start":
                    player_start = {"row": r, "col": c}
                    break
            else:
                continue
            break
    if not player_start:
        player_start = {"row": 0, "col": 0}
    try:
        start_pos_event = {"row": int(player_start["row"]), "col": int(player_start["col"])}
    except (TypeError, ValueError):
        start_pos_event = {"row": 0, "col": 0}
    # InputPrompt: shows the full navigation prompt (fixed + user) in the combat log
    game_events.append({
        "type": "InputPrompt",
        "message": navigation_prompt or user_prompt or "",
        "position": start_pos_event,
    })
    # AnswerChallenge: shows the agent's response (the path) in the combat log
    game_events.append({
        "type": "AnswerChallenge",
        "message": agent_response or "",
        "position": start_pos_event,
    })
    db_flush_fn(session_id, game_events, list(consumed_tiles), "playing")

    for step_idx, pos in enumerate(navigation_path):
        r, c = pos[0], pos[1]

        # Time limit check — end game if elapsed time exceeds limit
        if time_limit > 0 and (time.time() - game_start_time) > time_limit:
            status = "time_up"
            logger.info("Time limit reached (%.1fs > %ds) at step %d", time.time() - game_start_time, time_limit, step_idx)
            break

        # Off-grid step = instant game over
        if r < 0 or r >= rows or c < 0 or c >= cols:
            lives = 0
            status = "game_over"
            break

        cell = grid[r][c]

        # Wall collision = instant game over
        if cell == "wall":
            # Emit MoveSpace so avatar visually moves onto the wall before game over
            game_events.append({
                "type": "MoveSpace",
                "position": {"row": r, "col": c},
            })
            db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            lives = 0
            status = "game_over"
            break

        # Emit MoveSpace for every position change
        game_events.append({
            "type": "MoveSpace",
            "position": {"row": r, "col": c},
        })

        # Flush after every MoveSpace
        db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")

        pos_key = f"{r},{c}"

        # Skip already-consumed tiles — revisiting has no effect
        if pos_key in consumed_tiles:
            continue

        # --- Treasure tile ---
        if cell == TREASURE_TILE:
            treasure_bonus_value = defaults.get("treasureBonus", 1000)
            reached_treasure = True
            game_events.append({
                "type": "WinGame",
                "points": treasure_bonus_value,
                "position": {"row": r, "col": c},
            })
            consumed_tiles.add(pos_key)
            db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            break

        # --- Passive coin tile (c7) ---
        if cell == PASSIVE_COINS:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            pts = tile_cfg["points"]
            score += pts
            coin_points += pts
            consumed_tiles.add(pos_key)
            game_events.append({
                "type": "WinNonPromptChallenge",
                "challengeId": cell,
                "challengeName": CHALLENGE_NAMES.get(cell, "Coins"),
                "damage": 0,
                "points": pts,
                "position": {"row": r, "col": c},
                "scoreAfter": score,
                "livesAfter": lives,
            })
            db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            continue

        # --- Passive spike tile (c8) ---
        if cell == PASSIVE_SPIKES:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            dmg = tile_cfg["damage"]
            lives -= dmg
            consumed_tiles.add(pos_key)
            game_events.append({
                "type": "LoseNonPromptChallenge",
                "challengeId": cell,
                "challengeName": CHALLENGE_NAMES.get(cell, "Spikes"),
                "damage": dmg,
                "points": 0,
                "position": {"row": r, "col": c},
                "scoreAfter": score,
                "livesAfter": max(0, lives),
            })
            db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            if lives <= 0:
                status = "game_over"
                break
            continue

        # --- Door tiles (c30-c33) ---
        if cell in DOOR_TILES:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            if cell not in collected_keys:
                # Key not collected — deduct damage
                dmg = tile_cfg["damage"]
                lives -= dmg
                consumed_tiles.add(pos_key)
                game_events.append({
                    "type": "LoseNonPromptChallenge",
                    "challengeId": cell,
                    "challengeName": f"Door ({cell})",
                    "damage": dmg,
                    "points": 0,
                    "position": {"row": r, "col": c},
                    "scoreAfter": score,
                    "livesAfter": max(0, lives),
                })
                db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
                if lives <= 0:
                    status = "game_over"
                    break
            else:
                # Key collected — door opens, award points via challenge
                consumed_tiles.add(pos_key)
                challenge_data = challenges.get(pos_key)
                if challenge_data:
                    pts = tile_cfg["points"]
                    question = challenge_data.get("question", "")
                    expected = challenge_data.get("expectedAnswer", "")
                    strategy = challenge_data.get("gradingStrategy", "contains_match")

                    game_events.append({
                        "type": "FoundChallenge",
                        "challengeName": CHALLENGE_NAMES.get(cell, f"Door ({cell})"),
                        "position": {"row": r, "col": c},
                    })
                    game_events.append({
                        "type": "AskChallenge",
                        "message": question,
                        "challengeId": cell,
                        "position": {"row": r, "col": c},
                    })

                    # Flush BEFORE invoking agent — frontend sees question while waiting
                    db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")

                    # Invoke AgentCore for answer
                    # Check time before invoking agent
                    if time_limit > 0 and (time.time() - game_start_time) > time_limit:
                        status = "time_up"
                        break

                    try:
                        challenge_payload = {
                            **(invoke_payload or {}),
                            "prompt": question,
                            "task_type": "challenge",
                            "session_id": session_id,
                        }
                        answer, usage = invoke_agent_runtime(
                            runtime_arn, payload=challenge_payload, timeout=INVOCATION_TIMEOUT_SECONDS, session_id=f"{session_id}-c{step_idx}"
                        )
                        tokens_used = usage.get("total_usage", {}).get("outputTokens", 0) if usage else 0
                        tokens_used = tokens_used or max(1, len(answer) // 2)
                        total_tokens += tokens_used
                    except AgentCoreTimeoutError:
                        logger.warning("AgentCore timeout on challenge at (%d,%d)", r, c)
                        answer = ""

                    # Check time after invocation returns — discard result if over
                    if time_limit > 0 and (time.time() - game_start_time) > time_limit:
                        status = "time_up"
                        break

                    is_correct = grade_response(answer, expected, strategy, cell,
                                                guardrail_id=(invoke_payload or {}).get("guardrail_id"),
                                                question=question)
                    challenges_visited += 1

                    if is_correct:
                        correct_answers += 1
                        challenge_points += pts
                        score += pts
                        game_events.append({
                            "type": "WinChallenge",
                            "challengeId": cell,
                            "challengePoints": pts,
                            "points": pts,
                            "position": {"row": r, "col": c},
                            "scoreAfter": score,
                            "livesAfter": lives,
                        })
                    else:
                        dmg = tile_cfg["damage"]
                        lives -= dmg
                        game_events.append({
                            "type": "LoseChallenge",
                            "challengeId": cell,
                            "damage": dmg,
                            "position": {"row": r, "col": c},
                            "scoreAfter": score,
                            "livesAfter": max(0, lives),
                        })
                        if lives <= 0:
                            status = "game_over"
                            db_flush_fn(session_id, game_events, list(consumed_tiles), status)
                            break

                    # Flush after challenge result
                    db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            continue

        # --- Key tiles (c40-c43) ---
        if cell in KEY_TILES:
            tile_cfg = _get_tile_config(cell, tile_overrides)
            door_tile = KEY_TO_DOOR[cell]
            collected_keys.add(door_tile)
            consumed_tiles.add(pos_key)

            # Key tiles have a challenge if assigned
            challenge_data = challenges.get(pos_key)
            if challenge_data:
                question = challenge_data.get("question", "")
                expected = challenge_data.get("expectedAnswer", "")
                strategy = challenge_data.get("gradingStrategy", "contains_match")
                pts = tile_cfg["points"]
                dmg = tile_cfg.get("damage", 1)

                game_events.append({
                    "type": "FoundChallenge",
                    "challengeName": CHALLENGE_NAMES.get(cell, f"Key ({cell})"),
                    "position": {"row": r, "col": c},
                })
                game_events.append({
                    "type": "AskChallenge",
                    "message": question,
                    "challengeId": cell,
                    "position": {"row": r, "col": c},
                })

                # Flush BEFORE invoking agent — frontend sees question while waiting
                db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")

                # Check time before invoking agent
                if time_limit > 0 and (time.time() - game_start_time) > time_limit:
                    status = "time_up"
                    break

                # Invoke AgentCore for answer
                try:
                    challenge_payload = {
                        **(invoke_payload or {}),
                        "prompt": question,
                        "task_type": "challenge",
                        "session_id": session_id,
                    }
                    answer, usage = invoke_agent_runtime(
                        runtime_arn, payload=challenge_payload, timeout=INVOCATION_TIMEOUT_SECONDS, session_id=f"{session_id}-c{step_idx}"
                    )
                    tokens_used = usage.get("total_usage", {}).get("outputTokens", 0) if usage else 0
                    tokens_used = tokens_used or max(1, len(answer) // 2)
                    total_tokens += tokens_used
                except AgentCoreTimeoutError:
                    logger.warning("AgentCore timeout on key challenge at (%d,%d)", r, c)
                    answer = ""

                # Check time after invocation returns — discard result if over
                if time_limit > 0 and (time.time() - game_start_time) > time_limit:
                    status = "time_up"
                    break

                is_correct = grade_response(answer, expected, strategy, cell,
                                            guardrail_id=(invoke_payload or {}).get("guardrail_id"),
                                            question=question)
                challenges_visited += 1

                if is_correct:
                    correct_answers += 1
                    challenge_points += pts
                    score += pts
                    game_events.append({
                        "type": "WinChallenge",
                        "challengeId": cell,
                        "challengePoints": pts,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": lives,
                    })
                else:
                    lives -= dmg
                    game_events.append({
                        "type": "LoseChallenge",
                        "challengeId": cell,
                        "damage": dmg,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": max(0, lives),
                    })
                    if lives <= 0:
                        status = "game_over"
                        db_flush_fn(session_id, game_events, list(consumed_tiles), status)
                        break

                # Flush after challenge result
                db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            else:
                # No challenge — just collect the key silently (award points)
                pts = tile_cfg["points"]
                score += pts
                coin_points += pts
                game_events.append({
                    "type": "WinNonPromptChallenge",
                    "challengeId": cell,
                    "challengeName": f"Key ({cell})",
                    "damage": 0,
                    "points": pts,
                    "position": {"row": r, "col": c},
                    "scoreAfter": score,
                    "livesAfter": lives,
                })
                db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            continue

        # --- Challenge tiles (c1-c6, c17, c18) ---
        if cell in CHALLENGE_TILES and cell not in DOOR_TILES and cell not in KEY_TILES:
            challenge_data = challenges.get(pos_key)
            if challenge_data:
                tile_cfg = _get_tile_config(cell, tile_overrides)
                question = challenge_data.get("question", "")
                expected = challenge_data.get("expectedAnswer", "")
                strategy = challenge_data.get("gradingStrategy", "contains_match")
                pts = tile_cfg["points"]
                dmg = tile_cfg["damage"]

                game_events.append({
                    "type": "FoundChallenge",
                    "challengeName": CHALLENGE_NAMES.get(cell, cell),
                    "position": {"row": r, "col": c},
                })
                game_events.append({
                    "type": "AskChallenge",
                    "message": question,
                    "challengeId": cell,
                    "position": {"row": r, "col": c},
                })

                # Flush BEFORE invoking agent — frontend sees question while waiting
                db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")

                # Check time before invoking agent
                if time_limit > 0 and (time.time() - game_start_time) > time_limit:
                    status = "time_up"
                    break

                # Invoke AgentCore for answer
                try:
                    challenge_payload = {
                        **(invoke_payload or {}),
                        "prompt": question,
                        "task_type": "challenge",
                        "session_id": session_id,
                    }
                    answer, usage = invoke_agent_runtime(
                        runtime_arn, payload=challenge_payload, timeout=INVOCATION_TIMEOUT_SECONDS, session_id=f"{session_id}-c{step_idx}"
                    )
                    tokens_used = usage.get("total_usage", {}).get("outputTokens", 0) if usage else 0
                    tokens_used = tokens_used or max(1, len(answer) // 2)
                    total_tokens += tokens_used
                except AgentCoreTimeoutError:
                    logger.warning("AgentCore timeout on challenge at (%d,%d)", r, c)
                    answer = ""

                # Check time after invocation returns — discard result if over
                if time_limit > 0 and (time.time() - game_start_time) > time_limit:
                    status = "time_up"
                    break

                is_correct = grade_response(answer, expected, strategy, cell,
                                            guardrail_id=(invoke_payload or {}).get("guardrail_id"),
                                            question=question)
                challenges_visited += 1
                consumed_tiles.add(pos_key)

                # Emit AnswerChallenge so the combat log shows the agent's response
                game_events.append({
                    "type": "AnswerChallenge",
                    "message": answer[:500] if answer else "(no response)",
                    "position": {"row": r, "col": c},
                })

                if is_correct:
                    correct_answers += 1
                    challenge_points += pts
                    score += pts
                    game_events.append({
                        "type": "WinChallenge",
                        "challengeId": cell,
                        "challengePoints": pts,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": lives,
                    })
                else:
                    lives -= dmg
                    game_events.append({
                        "type": "LoseChallenge",
                        "challengeId": cell,
                        "damage": dmg,
                        "position": {"row": r, "col": c},
                        "scoreAfter": score,
                        "livesAfter": max(0, lives),
                    })
                    if lives <= 0:
                        status = "game_over"
                        db_flush_fn(session_id, game_events, list(consumed_tiles), status)
                        break

                # Flush after challenge result
                db_flush_fn(session_id, game_events, list(consumed_tiles), "in_progress")
            else:
                # Challenge tile without assignment — skip (treat as normal)
                consumed_tiles.add(pos_key)
            continue

        # --- Normal tiles and any other unrecognized tiles — no action beyond MoveSpace ---

    # --- End of path processing ---

    # Compute final score using score_calculator
    map_defaults = defaults if defaults else {
        "livesBonusMultiplier": 250,
        "tokenBonus": 1000,
        "treasureBonus": 1000,
    }

    score_breakdown = compute_final_score(
        challenge_points=challenge_points,
        coin_points=coin_points,
        treasure_reached=reached_treasure,
        lives_remaining=max(0, lives),
        total_tokens=total_tokens,
        challenges_visited=challenges_visited,
        custom_model_count=custom_model_count,
        map_defaults=map_defaults,
    )

    # Emit ScoreSummary event
    last_pos = {"row": 0, "col": 0}
    if navigation_path:
        last_step = navigation_path[-1]
        last_pos = {"row": last_step[0], "col": last_step[1]}

    game_events.append({
        "type": "ScoreSummary",
        "position": last_pos,
        "livesRemaining": max(0, lives),
        "lifeBonusScore": score_breakdown["lifeBonusScore"],
        "coinBonus": coin_points,
        "givenTokenBonus": score_breakdown["givenTokenBonus"],
        "treasureBonus": score_breakdown["treasureBonus"],
        "finalScore": score_breakdown["finalScore"],
        "challengeScore": challenge_points,
        "challengesAttempted": challenges_visited,
        "tokensUsed": total_tokens,
        "customModelCount": custom_model_count,
    })

    # Build planned path for frontend overlay
    planned_path = [{"row": p[0], "col": p[1]} for p in navigation_path]

    # Final flush with completed/game_over status
    db_flush_fn(session_id, game_events, list(consumed_tiles), status)

    return {
        "status": status,
        "gameEvents": game_events,
        "consumedTiles": list(consumed_tiles),
        "finalScore": score_breakdown["finalScore"],
        "qaScore": score_breakdown["qaScore"],
        "lifeBonusScore": score_breakdown["lifeBonusScore"],
        "givenTokenBonus": score_breakdown["givenTokenBonus"],
        "treasureBonus": score_breakdown["treasureBonus"],
        "livesRemaining": max(0, lives),
        "reachedTreasure": reached_treasure,
        "plannedPath": planned_path,
        "totalTokens": total_tokens,
        "challengesAttempted": challenges_visited,
        "correctAnswers": correct_answers,
    }
