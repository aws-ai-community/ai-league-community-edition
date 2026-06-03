"""Property-based tests for game_runner_v2: token accumulation and event ordering.

Uses hypothesis to verify:
- Property 10: Token accumulation correctness across invocations
- Property 11: Challenge event ordering in game sessions

**Validates: Requirements 9.7, 10.3**
"""

import sys
import os
from unittest.mock import patch, MagicMock

# Set env vars before importing modules that need them
os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-table")

# Add parent directory to path so we can import game_runner
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from game_runner import run_game_session


# ---------------------------------------------------------------------------
# Property 10: Token Accumulation
# ---------------------------------------------------------------------------


class TestTokenAccumulation:
    """Property 10: Token Accumulation.

    For any sequence of N invocations returning non-negative token counts,
    the total equals the sum.

    This tests as a pure function: given a list of non-negative integers
    representing token counts from individual invocations, verify that
    run_game_session_v2's totalTokens equals their sum.

    We test this by mocking invoke_agent_runtime to return predetermined
    token counts, then verifying game_runner_v2's totalTokens in the result.

    **Validates: Requirements 9.7, 10.3**
    """

    @given(token_counts=st.lists(st.integers(min_value=0, max_value=10000), min_size=1, max_size=10))
    @settings(max_examples=100, deadline=None)
    def test_total_tokens_equals_sum_of_individual_counts(self, token_counts):
        """For any sequence of non-negative token counts, totalTokens == sum(counts)."""
        # Build a map with exactly len(token_counts) challenge tiles in a line
        # Map layout: start at (0,0), path goes right through challenge tiles, treasure at end
        n = len(token_counts)
        grid_width = n + 2  # start + challenges + treasure

        # Build grid row: [start, c1, c1, ..., c1, treasure]
        grid_row = ["floor"] + ["c1"] * n + ["treasure"]
        grid = [grid_row]

        # Build challenges dict for each challenge position
        challenges = {}
        for i in range(n):
            pos_key = f"0,{i + 1}"
            challenges[pos_key] = {
                "question": f"Question {i}",
                "expectedAnswer": "test_answer",
                "gradingStrategy": "contains_match",
                "type": "c1",
            }

        map_data = {
            "grid": grid,
            "challenges": challenges,
            "defaults": {"lives": 100, "livesBonusMultiplier": 250, "tokenBonus": 1000, "treasureBonus": 1000},
            "tileOverrides": {},
            "playerStart": {"row": 0, "col": 0},
        }

        # Navigation path: move right through all tiles
        navigation_path = [(0, col) for col in range(grid_width)]

        # Create an iterator over token counts for the mock
        token_iter = iter(token_counts)

        def mock_invoke(runtime_arn, question, timeout=90, session_id=None):
            tokens = next(token_iter)
            return ("test_answer", tokens)

        # Mock the db_flush_fn (no-op for testing)
        flush_fn = MagicMock()

        # Import run_game_session_v2 and mock invoke_agent_runtime
        from game_runner import run_game_session_v2

        with patch("game_runner.invoke_agent_runtime", side_effect=mock_invoke):
            result = run_game_session_v2(
                session_id="test-session",
                map_data=map_data,
                navigation_path=navigation_path,
                custom_model_count=0,
                runtime_arn="arn:aws:bedrock:us-east-1:123456789:agent/test-agent",
                db_flush_fn=flush_fn,
            )

        expected_total = sum(token_counts)
        assert result["totalTokens"] == expected_total, (
            f"Token accumulation mismatch.\n"
            f"  Individual counts: {token_counts}\n"
            f"  Expected total: {expected_total}\n"
            f"  Actual totalTokens: {result['totalTokens']}"
        )


# ---------------------------------------------------------------------------
# Property 11: Challenge Event Ordering
# ---------------------------------------------------------------------------


# Strategy: generate small maps (3x3 to 5x5) with at least one challenge tile
# and a valid path through it
map_size_strategy = st.integers(min_value=3, max_value=5)


class TestChallengeEventOrdering:
    """Property 11: Challenge Event Ordering.

    For any game session with challenges, verify that challenge events follow
    the pattern: [FoundChallenge, AskChallenge, Win/LoseChallenge] per challenge.

    We test this using run_game_session (Phase 1, pure function) with maps
    that have challenge tiles and verify the event ordering property holds.

    **Validates: Requirements 9.7, 10.3**
    """

    @given(
        grid_size=map_size_strategy,
        num_challenges=st.integers(min_value=1, max_value=3),
        challenge_type=st.sampled_from(["c1", "c2", "c3", "c4", "c5"]),
    )
    @settings(max_examples=100, deadline=None)
    def test_challenge_events_follow_ordering_pattern(self, grid_size, num_challenges, challenge_type):
        """For any game session with challenges, events follow FoundChallenge → AskChallenge → Win/LoseChallenge."""
        # Limit challenges to fit in the grid (need start + challenges + treasure)
        actual_challenges = min(num_challenges, grid_size - 2)
        assume(actual_challenges >= 1)

        # Build a single-row map: [floor, challenge, ..., challenge, treasure]
        grid_row = ["floor"] + [challenge_type] * actual_challenges + ["treasure"]
        # Pad with floor tiles to reach grid_size if needed
        while len(grid_row) < grid_size:
            grid_row.append("floor")
        grid = [grid_row]

        # Build challenges dict
        challenges = {}
        for i in range(actual_challenges):
            pos_key = f"0,{i + 1}"
            challenges[pos_key] = {
                "question": f"What is {i + 1} + {i + 1}?",
                "expectedAnswer": str((i + 1) * 2),
                "gradingStrategy": "exact_match",
                "type": challenge_type,
            }

        map_data = {
            "grid": grid,
            "challenges": challenges,
            "defaults": {"lives": 100, "livesBonusMultiplier": 250, "tokenBonus": 1000, "treasureBonus": 1000},
            "tileOverrides": {},
            "playerStart": {"row": 0, "col": 0},
        }

        # Navigation path: move right through all tiles
        path_length = actual_challenges + 2  # start + challenges + treasure
        navigation_path = [(0, col) for col in range(path_length)]

        # Run game session (Phase 1 — pure function, uses PLACEHOLDER_RESPONSE)
        result = run_game_session(
            session_id="test-ordering",
            map_data=map_data,
            navigation_path=navigation_path,
            custom_model_count=0,
        )

        game_events = result["gameEvents"]

        # Extract challenge-related events (excluding MoveSpace, WinGame, ScoreSummary, etc.)
        challenge_event_types = {"FoundChallenge", "AskChallenge", "WinChallenge", "LoseChallenge"}
        challenge_events = [e for e in game_events if e["type"] in challenge_event_types]

        # Verify ordering: events must come in groups of 3 following the pattern
        # [FoundChallenge, AskChallenge, WinChallenge|LoseChallenge]
        assert len(challenge_events) % 3 == 0, (
            f"Challenge events not in groups of 3.\n"
            f"  Event count: {len(challenge_events)}\n"
            f"  Events: {[e['type'] for e in challenge_events]}"
        )

        num_groups = len(challenge_events) // 3
        for group_idx in range(num_groups):
            base = group_idx * 3
            first = challenge_events[base]
            second = challenge_events[base + 1]
            third = challenge_events[base + 2]

            assert first["type"] == "FoundChallenge", (
                f"Group {group_idx}: expected FoundChallenge at position 0, "
                f"got {first['type']}"
            )
            assert second["type"] == "AskChallenge", (
                f"Group {group_idx}: expected AskChallenge at position 1, "
                f"got {second['type']}"
            )
            assert third["type"] in ("WinChallenge", "LoseChallenge"), (
                f"Group {group_idx}: expected WinChallenge or LoseChallenge at position 2, "
                f"got {third['type']}"
            )

    @given(
        grid_size=map_size_strategy,
        num_challenges=st.integers(min_value=1, max_value=3),
    )
    @settings(max_examples=100, deadline=None)
    def test_found_challenge_always_precedes_ask_challenge(self, grid_size, num_challenges):
        """FoundChallenge always appears immediately before AskChallenge in the event stream."""
        actual_challenges = min(num_challenges, grid_size - 2)
        assume(actual_challenges >= 1)

        # Build a single-row map with challenge tiles
        grid_row = ["floor"] + ["c2"] * actual_challenges + ["treasure"]
        while len(grid_row) < grid_size:
            grid_row.append("floor")
        grid = [grid_row]

        challenges = {}
        for i in range(actual_challenges):
            pos_key = f"0,{i + 1}"
            challenges[pos_key] = {
                "question": f"Name the capital of country {i}",
                "expectedAnswer": f"capital_{i}",
                "gradingStrategy": "contains_match",
                "type": "c2",
            }

        map_data = {
            "grid": grid,
            "challenges": challenges,
            "defaults": {"lives": 100, "livesBonusMultiplier": 250, "tokenBonus": 1000, "treasureBonus": 1000},
            "tileOverrides": {},
            "playerStart": {"row": 0, "col": 0},
        }

        path_length = actual_challenges + 2
        navigation_path = [(0, col) for col in range(path_length)]

        result = run_game_session(
            session_id="test-ordering-2",
            map_data=map_data,
            navigation_path=navigation_path,
            custom_model_count=0,
        )

        game_events = result["gameEvents"]

        # For every AskChallenge event, the immediately preceding event must be FoundChallenge
        for idx, event in enumerate(game_events):
            if event["type"] == "AskChallenge":
                assert idx > 0, "AskChallenge cannot be the first event"
                prev_event = game_events[idx - 1]
                assert prev_event["type"] == "FoundChallenge", (
                    f"AskChallenge at index {idx} not preceded by FoundChallenge.\n"
                    f"  Previous event: {prev_event['type']}\n"
                    f"  Full event sequence: {[e['type'] for e in game_events]}"
                )
