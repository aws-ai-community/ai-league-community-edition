"""Tests for movement adjacency validation in the game engine (#130).

Coordinate and label paths are taken verbatim from the agent response, so
the game engine must reject any step that is not orthogonally adjacent to
the previous position (including the first step from playerStart).
"""

import sys
import os
from unittest.mock import MagicMock

os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-table")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hypothesis import given, settings, assume
from hypothesis import strategies as st

import path_parser
from game_runner import run_game_session, run_game_session_v2, TREASURE_TILE


def _walled_map():
    """5x5 map: start at A1, treasure at E5, wall column C blocking the way."""
    grid = [["floor", "floor", "wall", "floor", "floor"] for _ in range(5)]
    grid[0][0] = "start"
    grid[4][4] = TREASURE_TILE
    return {
        "grid": grid,
        "challenges": {},
        "defaults": {"lives": 5, "livesBonusMultiplier": 250, "tokenBonus": 1000, "treasureBonus": 1000},
        "tileOverrides": {},
        "playerStart": {"row": 0, "col": 0},
    }


def _run_v2(map_data, navigation_path):
    return run_game_session_v2(
        session_id="test-adjacency",
        map_data=map_data,
        navigation_path=navigation_path,
        custom_model_count=0,
        runtime_arn="arn:aws:bedrock:us-east-1:123456789:agent/test-agent",
        db_flush_fn=MagicMock(),
    )


# ---------------------------------------------------------------------------
# Regression: reported exploit
# ---------------------------------------------------------------------------


def test_coordinate_path_cannot_jump_over_wall():
    path = path_parser.parse_navigation_path('{"path": [[0,0],[4,4]]}', start=(0, 0))
    result = _run_v2(_walled_map(), path)
    assert result["status"] == "game_over"
    assert result["reachedTreasure"] is False


def test_label_path_cannot_jump_over_wall():
    path = path_parser.parse_navigation_path('["A1","E5"]', start=(0, 0))
    result = _run_v2(_walled_map(), path)
    assert result["status"] == "game_over"
    assert result["reachedTreasure"] is False


def test_first_step_must_be_adjacent_to_start():
    # Path omits the start and begins next to the treasure
    result = _run_v2(_walled_map(), [(4, 3), (4, 4)])
    assert result["status"] == "game_over"
    assert result["reachedTreasure"] is False


def test_v1_rejects_non_adjacent_step():
    result = run_game_session("test-adjacency", _walled_map(), [(0, 0), (4, 4)])
    assert result["status"] == "game_over"
    assert result["reachedTreasure"] is False


def test_valid_adjacent_path_still_reaches_treasure():
    map_data = _walled_map()
    map_data["grid"][4][2] = "floor"  # open a gap in the wall
    path = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (4, 1), (4, 2), (4, 3), (4, 4)]
    result = _run_v2(map_data, path)
    assert result["status"] == "completed"
    assert result["reachedTreasure"] is True


# ---------------------------------------------------------------------------
# Property: any non-adjacent jump ends the game before reaching the target
# ---------------------------------------------------------------------------


@given(
    target_row=st.integers(min_value=0, max_value=4),
    target_col=st.integers(min_value=0, max_value=4),
)
@settings(max_examples=100, deadline=None)
def test_non_adjacent_jump_from_start_is_game_over(target_row, target_col):
    """For any open 5x5 map, jumping from start to a cell at Manhattan distance > 1 is game over."""
    assume(target_row + target_col > 1)

    grid = [["floor"] * 5 for _ in range(5)]
    grid[target_row][target_col] = TREASURE_TILE
    map_data = {
        "grid": grid,
        "challenges": {},
        "defaults": {"lives": 5},
        "tileOverrides": {},
        "playerStart": {"row": 0, "col": 0},
    }

    result = _run_v2(map_data, [(0, 0), (target_row, target_col)])

    assert result["status"] == "game_over"
    assert result["reachedTreasure"] is False
    moves = [e["position"] for e in result["gameEvents"] if e["type"] == "MoveSpace"]
    assert {"row": target_row, "col": target_col} not in moves
