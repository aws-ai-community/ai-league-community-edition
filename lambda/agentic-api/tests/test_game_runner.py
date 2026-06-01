"""Property-based tests for the game runner module.

Uses hypothesis to verify correctness properties of the game session
orchestration across a wide range of valid map configurations and paths.
"""

import sys
import os

# Add parent directory to path so we can import game_runner
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from game_runner import run_game_session, DEFAULT_TILE_CONFIG


# ---------------------------------------------------------------------------
# Helper functions to build test maps
# ---------------------------------------------------------------------------


def build_map_with_tiles(grid_rows, grid_cols, tile_placements, defaults=None):
    """Build a minimal map_data dict for testing.

    Args:
        grid_rows: Number of rows in the grid.
        grid_cols: Number of columns in the grid.
        tile_placements: Dict of (row, col) -> tile_type to place on the grid.
        defaults: Optional dict of map defaults.

    Returns:
        A map_data dict suitable for run_game_session.
    """
    grid = [["normal" for _ in range(grid_cols)] for _ in range(grid_rows)]
    for (r, c), tile_type in tile_placements.items():
        grid[r][c] = tile_type

    if defaults is None:
        defaults = {
            "lives": 5,
            "livesBonusMultiplier": 250,
            "tokenBonus": 1000,
            "treasureBonus": 1000,
        }

    return {
        "grid": grid,
        "challenges": {},
        "defaults": defaults,
        "tileOverrides": {},
        "playerStart": {"row": 0, "col": 0},
    }


def build_linear_path(start_row, start_col, length, direction="right"):
    """Build a linear navigation path.

    Args:
        start_row: Starting row.
        start_col: Starting column.
        length: Number of steps.
        direction: One of 'right', 'down'.

    Returns:
        List of (row, col) tuples.
    """
    path = []
    for i in range(length):
        if direction == "right":
            path.append((start_row, start_col + i))
        elif direction == "down":
            path.append((start_row + i, start_col))
    return path


# ---------------------------------------------------------------------------
# Property 7: Passive coin tiles award points without challenge events
# Validates: Requirements 5.4
# ---------------------------------------------------------------------------


@given(
    grid_size=st.integers(min_value=3, max_value=10),
    coin_col=st.integers(min_value=1, max_value=8),
)
@settings(max_examples=100)
def test_property_7_passive_coin_tiles_award_points_without_challenge(
    grid_size, coin_col
):
    """**Validates: Requirements 5.4**

    For any valid map and navigation path that crosses a c7 tile,
    the game runner SHALL emit a WinNonPromptChallenge event (not AskChallenge)
    at that position, and the score SHALL increase by the c7 point value.
    """
    assume(coin_col < grid_size)

    tile_placements = {(0, coin_col): "c7"}
    map_data = build_map_with_tiles(grid_size, grid_size, tile_placements)
    path = build_linear_path(0, 0, coin_col + 1)

    result = run_game_session("test-session", map_data, path)

    events = result["gameEvents"]

    # Find WinNonPromptChallenge events at the coin position
    coin_events = [
        e for e in events
        if e.get("type") == "WinNonPromptChallenge"
        and e.get("position") == {"row": 0, "col": coin_col}
    ]
    assert len(coin_events) == 1, (
        f"Expected exactly 1 WinNonPromptChallenge at (0, {coin_col}), "
        f"got {len(coin_events)}"
    )

    # Verify the coin event has the correct point value
    expected_points = DEFAULT_TILE_CONFIG["c7"]["points"]
    assert coin_events[0]["points"] == expected_points, (
        f"Coin event points ({coin_events[0]['points']}) != "
        f"expected ({expected_points})"
    )

    # Verify NO AskChallenge event at the coin position
    ask_events = [
        e for e in events
        if e.get("type") == "AskChallenge"
        and e.get("position") == {"row": 0, "col": coin_col}
    ]
    assert len(ask_events) == 0, (
        f"Expected no AskChallenge at coin position (0, {coin_col}), "
        f"got {len(ask_events)}"
    )


# ---------------------------------------------------------------------------
# Property 8: Passive spike tiles deduct lives without challenge events
# Validates: Requirements 5.5
# ---------------------------------------------------------------------------


@given(
    grid_size=st.integers(min_value=3, max_value=10),
    spike_col=st.integers(min_value=1, max_value=8),
)
@settings(max_examples=100)
def test_property_8_passive_spike_tiles_deduct_lives_without_challenge(
    grid_size, spike_col
):
    """**Validates: Requirements 5.5**

    For any valid map and navigation path that crosses a c8 tile,
    the game runner SHALL emit a LoseNonPromptChallenge event (not AskChallenge)
    at that position, and lives SHALL decrease by the c8 damage value.
    """
    assume(spike_col < grid_size)

    tile_placements = {(0, spike_col): "c8"}
    map_data = build_map_with_tiles(grid_size, grid_size, tile_placements)
    path = build_linear_path(0, 0, spike_col + 1)

    initial_lives = map_data["defaults"]["lives"]
    result = run_game_session("test-session", map_data, path)

    events = result["gameEvents"]

    # Find LoseNonPromptChallenge events at the spike position
    spike_events = [
        e for e in events
        if e.get("type") == "LoseNonPromptChallenge"
        and e.get("position") == {"row": 0, "col": spike_col}
    ]
    assert len(spike_events) == 1, (
        f"Expected exactly 1 LoseNonPromptChallenge at (0, {spike_col}), "
        f"got {len(spike_events)}"
    )

    # Verify the spike event has the correct damage value
    expected_damage = DEFAULT_TILE_CONFIG["c8"]["damage"]
    assert spike_events[0]["damage"] == expected_damage, (
        f"Spike event damage ({spike_events[0]['damage']}) != "
        f"expected ({expected_damage})"
    )

    # Verify lives decreased correctly
    assert spike_events[0]["livesAfter"] == initial_lives - expected_damage, (
        f"Lives after spike ({spike_events[0]['livesAfter']}) != "
        f"initial ({initial_lives}) - damage ({expected_damage})"
    )

    # Verify NO AskChallenge event at the spike position
    ask_events = [
        e for e in events
        if e.get("type") == "AskChallenge"
        and e.get("position") == {"row": 0, "col": spike_col}
    ]
    assert len(ask_events) == 0, (
        f"Expected no AskChallenge at spike position (0, {spike_col}), "
        f"got {len(ask_events)}"
    )


# ---------------------------------------------------------------------------
# Property 9: Game ends when lives reach zero
# Validates: Requirements 5.7
# ---------------------------------------------------------------------------


@given(
    grid_size=st.integers(min_value=8, max_value=12),
    starting_lives=st.integers(min_value=1, max_value=3),
)
@settings(max_examples=100)
def test_property_9_game_ends_when_lives_reach_zero(grid_size, starting_lives):
    """**Validates: Requirements 5.7**

    For any game session where lives reach 0, no further game events
    (other than ScoreSummary) SHALL be emitted after the life-depleting event.
    The session status SHALL be "game_over".
    """
    # Place enough spikes to kill the player (each spike does 1 damage)
    tile_placements = {}
    for i in range(starting_lives):
        tile_placements[(0, i + 1)] = "c8"
    # Place a coin after the spikes to verify it's never reached
    coin_col = starting_lives + 1
    assume(coin_col < grid_size)
    tile_placements[(0, coin_col)] = "c7"

    defaults = {
        "lives": starting_lives,
        "livesBonusMultiplier": 250,
        "tokenBonus": 1000,
        "treasureBonus": 1000,
    }
    map_data = build_map_with_tiles(grid_size, grid_size, tile_placements, defaults)
    path = build_linear_path(0, 0, coin_col + 1)

    result = run_game_session("test-session", map_data, path)

    # Verify status is game_over
    assert result["status"] == "game_over", (
        f"Expected status 'game_over', got '{result['status']}'"
    )

    # Verify no events after the life-depleting event (except ScoreSummary)
    events = result["gameEvents"]
    life_depleting_idx = None
    for i, e in enumerate(events):
        if e.get("type") == "LoseNonPromptChallenge" and e.get("livesAfter", 1) <= 0:
            life_depleting_idx = i
            break

    assert life_depleting_idx is not None, "No life-depleting event found"

    # After the life-depleting event, only ScoreSummary should exist
    events_after = events[life_depleting_idx + 1:]
    non_summary_events = [
        e for e in events_after if e.get("type") != "ScoreSummary"
    ]
    assert len(non_summary_events) == 0, (
        f"Found {len(non_summary_events)} non-ScoreSummary events after death: "
        f"{[e.get('type') for e in non_summary_events]}"
    )

    # Verify the coin tile was never reached
    coin_events = [
        e for e in events
        if e.get("type") == "WinNonPromptChallenge"
        and e.get("position") == {"row": 0, "col": coin_col}
    ]
    assert len(coin_events) == 0, (
        f"Coin at (0, {coin_col}) should not have been reached after death"
    )


# ---------------------------------------------------------------------------
# Property 10: Treasure tile awards bonus and ends game
# Validates: Requirements 5.8
# ---------------------------------------------------------------------------


@given(
    grid_size=st.integers(min_value=3, max_value=10),
    treasure_col=st.integers(min_value=1, max_value=8),
)
@settings(max_examples=100)
def test_property_10_treasure_tile_awards_bonus_and_ends_game(
    grid_size, treasure_col
):
    """**Validates: Requirements 5.8**

    For any navigation path that reaches a treasure tile with lives > 0,
    the game runner SHALL emit a WinGame event with the treasure bonus points,
    and no further movement events SHALL occur after the treasure tile.
    """
    assume(treasure_col < grid_size)

    tile_placements = {(0, treasure_col): "treasure"}
    # Place a coin after treasure to verify it's never reached
    after_col = treasure_col + 1
    assume(after_col < grid_size)
    tile_placements[(0, after_col)] = "c7"

    map_data = build_map_with_tiles(grid_size, grid_size, tile_placements)
    path = build_linear_path(0, 0, after_col + 1)

    result = run_game_session("test-session", map_data, path)

    events = result["gameEvents"]

    # Verify WinGame event emitted at treasure position
    win_game_events = [
        e for e in events
        if e.get("type") == "WinGame"
        and e.get("position") == {"row": 0, "col": treasure_col}
    ]
    assert len(win_game_events) == 1, (
        f"Expected exactly 1 WinGame at (0, {treasure_col}), "
        f"got {len(win_game_events)}"
    )

    # Verify treasure bonus points
    treasure_bonus = map_data["defaults"]["treasureBonus"]
    assert win_game_events[0]["points"] == treasure_bonus, (
        f"WinGame points ({win_game_events[0]['points']}) != "
        f"treasure bonus ({treasure_bonus})"
    )

    # Verify no MoveSpace events after the treasure tile
    win_game_idx = None
    for i, e in enumerate(events):
        if e.get("type") == "WinGame":
            win_game_idx = i
            break

    assert win_game_idx is not None, "WinGame event not found"

    events_after = events[win_game_idx + 1:]
    move_events_after = [
        e for e in events_after if e.get("type") == "MoveSpace"
    ]
    assert len(move_events_after) == 0, (
        f"Found {len(move_events_after)} MoveSpace events after treasure"
    )

    # Verify reachedTreasure is True
    assert result["reachedTreasure"] is True, "reachedTreasure should be True"


# ---------------------------------------------------------------------------
# Door/key interaction test
# Validates: Requirements 5.6
# ---------------------------------------------------------------------------


@given(
    grid_size=st.integers(min_value=6, max_value=10),
    door_key_pair=st.sampled_from([
        ("c30", "c40"),
        ("c31", "c41"),
        ("c32", "c42"),
        ("c33", "c43"),
    ]),
)
@settings(max_examples=100)
def test_door_key_interaction_without_key(grid_size, door_key_pair):
    """**Validates: Requirements 5.6**

    For any path that reaches a door tile without having first visited
    the matching key tile, verify lives are deducted by the door's damage value.
    """
    door_tile, key_tile = door_key_pair

    # Place door at col 2, no key on path
    tile_placements = {(0, 2): door_tile}
    map_data = build_map_with_tiles(grid_size, grid_size, tile_placements)
    path = build_linear_path(0, 0, 4)

    initial_lives = map_data["defaults"]["lives"]
    result = run_game_session("test-session", map_data, path)

    events = result["gameEvents"]

    # Verify LoseNonPromptChallenge at door position (damage deducted)
    door_damage_events = [
        e for e in events
        if e.get("type") == "LoseNonPromptChallenge"
        and e.get("position") == {"row": 0, "col": 2}
    ]
    assert len(door_damage_events) == 1, (
        f"Expected 1 LoseNonPromptChallenge at door (0, 2), "
        f"got {len(door_damage_events)}"
    )

    # Verify damage is the door's damage value (default 5)
    expected_damage = DEFAULT_TILE_CONFIG[door_tile]["damage"]
    assert door_damage_events[0]["damage"] == expected_damage, (
        f"Door damage ({door_damage_events[0]['damage']}) != "
        f"expected ({expected_damage})"
    )

    # Verify lives decreased
    assert door_damage_events[0]["livesAfter"] == max(0, initial_lives - expected_damage), (
        f"Lives after door ({door_damage_events[0]['livesAfter']}) != "
        f"expected ({max(0, initial_lives - expected_damage)})"
    )


@given(
    grid_size=st.integers(min_value=6, max_value=10),
    door_key_pair=st.sampled_from([
        ("c30", "c40"),
        ("c31", "c41"),
        ("c32", "c42"),
        ("c33", "c43"),
    ]),
)
@settings(max_examples=100)
def test_door_key_interaction_with_key(grid_size, door_key_pair):
    """**Validates: Requirements 5.6**

    For any path that collects the key before the door,
    verify no damage is deducted at the door.
    """
    door_tile, key_tile = door_key_pair

    # Place key at col 1, door at col 3
    tile_placements = {
        (0, 1): key_tile,
        (0, 3): door_tile,
    }
    map_data = build_map_with_tiles(grid_size, grid_size, tile_placements)
    path = build_linear_path(0, 0, 5)

    initial_lives = map_data["defaults"]["lives"]
    result = run_game_session("test-session", map_data, path)

    events = result["gameEvents"]

    # Verify NO LoseNonPromptChallenge at door position (key was collected)
    door_damage_events = [
        e for e in events
        if e.get("type") == "LoseNonPromptChallenge"
        and e.get("position") == {"row": 0, "col": 3}
    ]
    assert len(door_damage_events) == 0, (
        f"Expected no LoseNonPromptChallenge at door (0, 3) when key collected, "
        f"got {len(door_damage_events)}"
    )

    # Verify lives were not reduced by door damage
    # (lives should still be at initial value since key tiles have 0 damage without challenge)
    assert result["livesRemaining"] == initial_lives, (
        f"Lives remaining ({result['livesRemaining']}) != "
        f"initial lives ({initial_lives}) — door should not have deducted damage"
    )


# ---------------------------------------------------------------------------
# Consumed tile revisit test
# Validates: Requirements 5.9 (tiles consumed after first visit)
# ---------------------------------------------------------------------------


@given(
    grid_size=st.integers(min_value=5, max_value=10),
    tile_type=st.sampled_from(["c7", "c8"]),
)
@settings(max_examples=100)
def test_consumed_tile_revisit_no_effect(grid_size, tile_type):
    """**Validates: Requirements 5.9**

    For any path that revisits a previously consumed tile,
    verify no events (challenge, damage, or points) are emitted on the revisit.
    """
    # Place tile at (0, 2)
    tile_placements = {(0, 2): tile_type}

    defaults = {
        "lives": 5,
        "livesBonusMultiplier": 250,
        "tokenBonus": 1000,
        "treasureBonus": 1000,
    }
    map_data = build_map_with_tiles(grid_size, grid_size, tile_placements, defaults)

    # Path goes right to col 3, then back to col 2 (revisit), then right again
    path = [
        (0, 0),
        (0, 1),
        (0, 2),  # First visit — should trigger event
        (0, 3),
        (0, 2),  # Revisit — should NOT trigger event
        (0, 1),
    ]

    result = run_game_session("test-session", map_data, path)
    events = result["gameEvents"]

    # Count tile-specific events at position (0, 2)
    if tile_type == "c7":
        tile_events = [
            e for e in events
            if e.get("type") == "WinNonPromptChallenge"
            and e.get("position") == {"row": 0, "col": 2}
        ]
    else:  # c8
        tile_events = [
            e for e in events
            if e.get("type") == "LoseNonPromptChallenge"
            and e.get("position") == {"row": 0, "col": 2}
        ]

    # Should only have 1 event from the first visit, not 2
    assert len(tile_events) == 1, (
        f"Expected exactly 1 {tile_type} event at (0, 2) "
        f"(revisit should have no effect), got {len(tile_events)}"
    )
