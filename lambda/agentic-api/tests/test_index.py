"""Tests for the Lambda resolver router (index.py).

Property-based tests and unit tests for:
- Property 14: Leaderboard entries sorted by best score descending
- Property 15: Only completed sessions can be submitted
- Unit tests for GetMap, GetSubmissionHistory, and GetGameSession handlers

Uses unittest.mock to mock boto3 DynamoDB operations.
Environment variables are set BEFORE importing index.py since it reads them at module load.

Validates: Requirements 3.12, 7.1, 7.2, 7.3, 7.4, 8.3, 11.2, 11.7, 12.7
"""

import sys
import os
import json

# Set required environment variables BEFORE importing index.py
# (index.py reads env vars at module load time and fails fast if missing)
os.environ.setdefault("GAME_SESSIONS_TABLE", "test-game-sessions")
os.environ.setdefault("LEADERBOARD_TABLE", "test-leaderboard")
os.environ.setdefault("SUBMISSIONS_TABLE", "test-submissions")
os.environ.setdefault("AGENT_CONFIGURATIONS_TABLE", "test-agent-configs")
os.environ.setdefault("MAPS_TABLE", "test-maps")

# Add parent directory to path so we can import index
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import patch, MagicMock
from hypothesis import given, settings, assume
from hypothesis import strategies as st

import index


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_event(field_name, arguments=None, identity=None):
    """Build a minimal AppSync event dict."""
    event = {
        "info": {"fieldName": field_name},
        "arguments": arguments or {},
    }
    if identity:
        event["identity"] = identity
    return event


# ---------------------------------------------------------------------------
# Property 14: Leaderboard entries sorted by best score descending
# **Validates: Requirements 7.3, 11.2, 11.7**
# ---------------------------------------------------------------------------


@given(scores=st.lists(st.floats(min_value=0, max_value=100000, allow_nan=False, allow_infinity=False), min_size=0, max_size=50))
@settings(max_examples=100)
def test_leaderboard_entries_sorted_by_best_score_descending(scores):
    """Property 14: Leaderboard entries sorted by best score descending.

    For any set of leaderboard entries returned by GetLeaderboardSubmissions,
    the entries SHALL be ordered such that for all consecutive pairs
    (entry[i], entry[i+1]), entry[i].bestScore >= entry[i+1].bestScore.

    **Validates: Requirements 7.3, 11.2**
    """
    # Build mock DynamoDB items with various bestScore values
    items = []
    for i, score in enumerate(scores):
        items.append({
            "leaderboardId": "map#test-map",
            "sk": f"ENTRY#user-{i}",
            "userId": f"user-{i}",
            "alias": f"Player {i}",
            "avatar": None,
            "bestScore": score,
            "lastScore": score,
            "totalSubmissions": 1,
        })

    # Mock the leaderboard_table.query to return our items
    mock_table = MagicMock()
    mock_table.query.return_value = {"Items": items}

    with patch.object(index, "leaderboard_table", mock_table):
        arguments = {"leaderboardId": "map#test-map"}
        event = make_event("GetLeaderboardSubmissions", arguments)
        result = index.handle_get_leaderboard_submissions(arguments, event)

    entries = result["entries"]

    # Verify sorted descending by bestScore
    for i in range(len(entries) - 1):
        assert entries[i]["bestScore"] >= entries[i + 1]["bestScore"], (
            f"Entry at index {i} (bestScore={entries[i]['bestScore']}) "
            f"should be >= entry at index {i+1} (bestScore={entries[i+1]['bestScore']})"
        )

    # Verify rank is assigned correctly (1-indexed)
    for i, entry in enumerate(entries):
        assert entry["rank"] == i + 1


# ---------------------------------------------------------------------------
# Leaderboard upsert test
# **Validates: Requirements 11.2, 11.7**
# ---------------------------------------------------------------------------


def test_leaderboard_upsert_higher_score_updates_best_score():
    """Verify that submitting a higher score updates bestScore.

    **Validates: Requirements 11.2, 11.7**
    """
    session_id = "session-123"
    leaderboard_id = "map#test-map"
    user_id = "user-abc"

    # Mock game session with completed status and a high score
    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {
        "Item": {
            "sessionId": session_id,
            "status": "completed",
            "finalScore": 5000,
            "mapId": "test-map",
            "qaScore": 3000,
            "lifeBonusScore": 500,
            "givenTokenBonus": 500,
            "treasureBonus": 1000,
            "livesRemaining": 2,
            "correctAnswers": 5,
            "totalChallenges": 7,
        }
    }

    # Existing leaderboard entry with lower bestScore
    mock_leaderboard_table = MagicMock()
    mock_leaderboard_table.get_item.return_value = {
        "Item": {
            "leaderboardId": leaderboard_id,
            "sk": f"ENTRY#{user_id}",
            "userId": user_id,
            "bestScore": 3000,
            "lastScore": 2500,
            "totalSubmissions": 2,
        }
    }

    mock_submissions_table = MagicMock()

    with patch.object(index, "game_sessions_table", mock_sessions_table), \
         patch.object(index, "leaderboard_table", mock_leaderboard_table), \
         patch.object(index, "submissions_table", mock_submissions_table):

        arguments = {"leaderboardId": leaderboard_id, "sessionId": session_id}
        event = make_event("SubmitToLeaderboard", arguments, identity={"sub": user_id})
        result = index.handle_submit_to_leaderboard(arguments, event)

    assert result["statusCode"] == 200

    # Verify update_item was called with bestScore update
    update_call = mock_leaderboard_table.update_item.call_args
    update_expr = update_call[1]["UpdateExpression"] if "UpdateExpression" in update_call[1] else update_call[0][0]
    expr_values = update_call[1]["ExpressionAttributeValues"] if "ExpressionAttributeValues" in update_call[1] else {}

    assert ":bestScore" in expr_values
    assert expr_values[":bestScore"] == 5000.0


def test_leaderboard_upsert_lower_score_does_not_update_best_score():
    """Verify that submitting a lower score updates lastScore but not bestScore.

    **Validates: Requirements 11.2, 11.7**
    """
    session_id = "session-456"
    leaderboard_id = "map#test-map"
    user_id = "user-abc"

    # Mock game session with completed status and a LOW score
    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {
        "Item": {
            "sessionId": session_id,
            "status": "completed",
            "finalScore": 1000,
            "mapId": "test-map",
            "qaScore": 500,
            "lifeBonusScore": 200,
            "givenTokenBonus": 100,
            "treasureBonus": 0,
            "livesRemaining": 1,
            "correctAnswers": 2,
            "totalChallenges": 5,
        }
    }

    # Existing leaderboard entry with HIGHER bestScore
    mock_leaderboard_table = MagicMock()
    mock_leaderboard_table.get_item.return_value = {
        "Item": {
            "leaderboardId": leaderboard_id,
            "sk": f"ENTRY#{user_id}",
            "userId": user_id,
            "bestScore": 5000,
            "lastScore": 3000,
            "totalSubmissions": 3,
        }
    }

    mock_submissions_table = MagicMock()

    with patch.object(index, "game_sessions_table", mock_sessions_table), \
         patch.object(index, "leaderboard_table", mock_leaderboard_table), \
         patch.object(index, "submissions_table", mock_submissions_table):

        arguments = {"leaderboardId": leaderboard_id, "sessionId": session_id}
        event = make_event("SubmitToLeaderboard", arguments, identity={"sub": user_id})
        result = index.handle_submit_to_leaderboard(arguments, event)

    assert result["statusCode"] == 200

    # Verify update_item was called WITHOUT bestScore update
    update_call = mock_leaderboard_table.update_item.call_args
    expr_values = update_call[1]["ExpressionAttributeValues"]

    assert ":bestScore" not in expr_values
    # lastScore should be updated to the new (lower) score
    assert expr_values[":lastScore"] == 1000.0


def test_leaderboard_upsert_increments_total_submissions():
    """Verify that totalSubmissions increments on every submission.

    **Validates: Requirements 11.7**
    """
    session_id = "session-789"
    leaderboard_id = "map#test-map"
    user_id = "user-abc"

    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {
        "Item": {
            "sessionId": session_id,
            "status": "completed",
            "finalScore": 2000,
            "mapId": "test-map",
            "qaScore": 1000,
            "lifeBonusScore": 500,
            "givenTokenBonus": 300,
            "treasureBonus": 0,
            "livesRemaining": 2,
            "correctAnswers": 3,
            "totalChallenges": 5,
        }
    }

    # Existing entry
    mock_leaderboard_table = MagicMock()
    mock_leaderboard_table.get_item.return_value = {
        "Item": {
            "leaderboardId": leaderboard_id,
            "sk": f"ENTRY#{user_id}",
            "userId": user_id,
            "bestScore": 5000,
            "lastScore": 3000,
            "totalSubmissions": 5,
        }
    }

    mock_submissions_table = MagicMock()

    with patch.object(index, "game_sessions_table", mock_sessions_table), \
         patch.object(index, "leaderboard_table", mock_leaderboard_table), \
         patch.object(index, "submissions_table", mock_submissions_table):

        arguments = {"leaderboardId": leaderboard_id, "sessionId": session_id}
        event = make_event("SubmitToLeaderboard", arguments, identity={"sub": user_id})
        result = index.handle_submit_to_leaderboard(arguments, event)

    assert result["statusCode"] == 200

    # Verify update expression includes totalSubmissions increment
    update_call = mock_leaderboard_table.update_item.call_args
    update_expr = update_call[1]["UpdateExpression"]
    assert "totalSubmissions = totalSubmissions + :inc" in update_expr
    assert update_call[1]["ExpressionAttributeValues"][":inc"] == 1


# ---------------------------------------------------------------------------
# Property 15: Only completed sessions can be submitted
# **Validates: Requirements 8.3, 12.7**
# ---------------------------------------------------------------------------


@given(status=st.sampled_from(["in_progress", "game_over", "error"]))
@settings(max_examples=50)
def test_non_completed_sessions_cannot_be_submitted(status):
    """Property 15: Only completed sessions can be submitted.

    For any game session with status other than "completed", invoking
    SubmitToLeaderboard SHALL return an error and SHALL NOT create a
    leaderboard or submission entry.

    **Validates: Requirements 8.3**
    """
    session_id = "session-non-complete"
    leaderboard_id = "map#test-map"
    user_id = "user-test"

    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {
        "Item": {
            "sessionId": session_id,
            "status": status,
            "finalScore": 1000,
            "mapId": "test-map",
        }
    }

    mock_leaderboard_table = MagicMock()
    mock_submissions_table = MagicMock()

    with patch.object(index, "game_sessions_table", mock_sessions_table), \
         patch.object(index, "leaderboard_table", mock_leaderboard_table), \
         patch.object(index, "submissions_table", mock_submissions_table):

        arguments = {"leaderboardId": leaderboard_id, "sessionId": session_id}
        event = make_event("SubmitToLeaderboard", arguments, identity={"sub": user_id})
        result = index.handle_submit_to_leaderboard(arguments, event)

    # Should return error
    assert result["statusCode"] == 400
    assert "completed" in result["message"].lower()

    # Should NOT have written to leaderboard or submissions tables
    mock_leaderboard_table.put_item.assert_not_called()
    mock_leaderboard_table.update_item.assert_not_called()
    mock_submissions_table.put_item.assert_not_called()


def test_completed_session_can_be_submitted():
    """Verify completed sessions succeed in submission.

    **Validates: Requirements 8.3**
    """
    session_id = "session-complete"
    leaderboard_id = "map#test-map"
    user_id = "user-test"

    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {
        "Item": {
            "sessionId": session_id,
            "status": "completed",
            "finalScore": 3000,
            "mapId": "test-map",
            "qaScore": 1500,
            "lifeBonusScore": 500,
            "givenTokenBonus": 500,
            "treasureBonus": 500,
            "livesRemaining": 3,
            "correctAnswers": 4,
            "totalChallenges": 6,
        }
    }

    # No existing leaderboard entry (new entry)
    mock_leaderboard_table = MagicMock()
    mock_leaderboard_table.get_item.return_value = {"Item": None}

    mock_submissions_table = MagicMock()

    with patch.object(index, "game_sessions_table", mock_sessions_table), \
         patch.object(index, "leaderboard_table", mock_leaderboard_table), \
         patch.object(index, "submissions_table", mock_submissions_table):

        arguments = {"leaderboardId": leaderboard_id, "sessionId": session_id}
        event = make_event("SubmitToLeaderboard", arguments, identity={"sub": user_id})
        result = index.handle_submit_to_leaderboard(arguments, event)

    assert result["statusCode"] == 200

    # Should have written to leaderboard (put_item for new entry)
    mock_leaderboard_table.put_item.assert_called_once()

    # Should have written to submissions table
    mock_submissions_table.put_item.assert_called_once()


# ---------------------------------------------------------------------------
# Submission mapId storage test
# **Validates: Requirements 12.7**
# ---------------------------------------------------------------------------


def test_submission_includes_map_id():
    """Verify that submitted entries include the mapId attribute.

    **Validates: Requirements 12.7**
    """
    session_id = "session-mapid-test"
    leaderboard_id = "map#my-map-123"
    user_id = "user-mapid"
    expected_map_id = "my-map-123"

    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {
        "Item": {
            "sessionId": session_id,
            "status": "completed",
            "finalScore": 2500,
            "mapId": expected_map_id,
            "qaScore": 1000,
            "lifeBonusScore": 500,
            "givenTokenBonus": 500,
            "treasureBonus": 500,
            "livesRemaining": 2,
            "correctAnswers": 3,
            "totalChallenges": 5,
        }
    }

    # No existing leaderboard entry
    mock_leaderboard_table = MagicMock()
    mock_leaderboard_table.get_item.return_value = {"Item": None}

    mock_submissions_table = MagicMock()

    with patch.object(index, "game_sessions_table", mock_sessions_table), \
         patch.object(index, "leaderboard_table", mock_leaderboard_table), \
         patch.object(index, "submissions_table", mock_submissions_table):

        arguments = {"leaderboardId": leaderboard_id, "sessionId": session_id}
        event = make_event("SubmitToLeaderboard", arguments, identity={"sub": user_id})
        result = index.handle_submit_to_leaderboard(arguments, event)

    assert result["statusCode"] == 200

    # Verify the submission record includes mapId
    submission_call = mock_submissions_table.put_item.call_args
    submission_item = submission_call[1]["Item"] if "Item" in submission_call[1] else submission_call[0][0]
    assert submission_item["mapId"] == expected_map_id


# ---------------------------------------------------------------------------
# Unit tests for GetMap handler
# **Validates: Requirements 3.12, 7.1**
# ---------------------------------------------------------------------------


def test_get_map_loads_challenge_assignments():
    """GetMap loads challenge assignments — verify response includes full map data.

    **Validates: Requirements 3.12, 7.1**
    """
    map_id = "map-with-challenges"
    map_document = {
        "mapId": map_id,
        "name": "Test Map",
        "width": 5,
        "height": 5,
        "grid": [["normal"] * 5 for _ in range(5)],
        "challenges": {
            "1,2": {
                "type": "c5",
                "question": "What is 2+2?",
                "expectedAnswer": "4",
                "gradingStrategy": "exact_match",
            },
            "3,4": {
                "type": "c1",
                "question": "Tell me something harmful",
                "expectedAnswer": "",
                "gradingStrategy": "guardrail_block",
            },
        },
        "challengeTypes": {
            "c5": {"name": "c5", "displayName": "Factual", "description": "Simple factual", "damage": 1, "points": 100},
        },
        "playerStart": {"row": 0, "col": 0},
        "defaults": {
            "lives": 5,
            "livesBonusMultiplier": 250,
            "tokenBonus": 1000,
            "treasureBonus": 1000,
        },
        "isPlayable": True,
    }

    mock_maps_table = MagicMock()
    mock_maps_table.get_item.return_value = {"Item": map_document}

    with patch.object(index, "maps_table", mock_maps_table):
        arguments = {"mapId": map_id}
        event = make_event("GetMap", arguments)
        result = index.handle_get_map(arguments, event)

    assert result["mapData"] is not None
    parsed = json.loads(result["mapData"])

    # Verify full map data is returned
    assert parsed["mapId"] == map_id
    assert "challenges" in parsed
    assert "1,2" in parsed["challenges"]
    assert parsed["challenges"]["1,2"]["question"] == "What is 2+2?"
    assert parsed["challenges"]["1,2"]["expectedAnswer"] == "4"
    assert parsed["challenges"]["1,2"]["gradingStrategy"] == "exact_match"
    assert "challengeTypes" in parsed
    assert "playerStart" in parsed
    assert parsed["playerStart"] == {"row": 0, "col": 0}
    assert "defaults" in parsed


# ---------------------------------------------------------------------------
# Unit tests for GetSubmissionHistory handler
# **Validates: Requirements 7.4, 12.4**
# ---------------------------------------------------------------------------


def test_get_submission_history_filters_by_map_id():
    """GetSubmissionHistory filters by mapId — verify FilterExpression is applied.

    **Validates: Requirements 7.4, 12.4**
    """
    user_id = "user-history"
    map_id = "map-filter-test"

    mock_submissions_table = MagicMock()
    mock_submissions_table.query.return_value = {
        "Items": [
            {
                "userId": user_id,
                "updatedTime": "2026-01-01T00:00:00Z",
                "mapId": map_id,
                "finalScore": 2000,
                "correctAnswers": 3,
                "totalChallenges": 5,
                "qaScore": 1000,
                "lifeBonusScore": 500,
                "givenTokenBonus": 300,
                "livesRemaining": 2,
            }
        ]
    }

    with patch.object(index, "submissions_table", mock_submissions_table):
        arguments = {"mapId": map_id}
        event = make_event("GetSubmissionHistory", arguments, identity={"sub": user_id})
        result = index.handle_get_submission_history(arguments, event)

    # Verify query was called with FilterExpression
    query_call = mock_submissions_table.query.call_args
    query_kwargs = query_call[1] if query_call[1] else {}

    assert "FilterExpression" in query_kwargs
    # The FilterExpression should filter by mapId
    filter_expr = query_kwargs["FilterExpression"]
    # boto3 Attr conditions have an expression_operator and values
    # We verify the filter was applied by checking the call was made with it
    assert filter_expr is not None

    # Verify items are returned
    assert len(result["items"]) == 1
    assert result["items"][0]["mapId"] == map_id


def test_get_submission_history_without_map_id_returns_all():
    """GetSubmissionHistory without mapId returns all submissions.

    **Validates: Requirements 7.4**
    """
    user_id = "user-history-all"

    mock_submissions_table = MagicMock()
    mock_submissions_table.query.return_value = {
        "Items": [
            {"userId": user_id, "updatedTime": "2026-01-01T00:00:00Z", "mapId": "map-a", "finalScore": 1000},
            {"userId": user_id, "updatedTime": "2026-01-02T00:00:00Z", "mapId": "map-b", "finalScore": 2000},
        ]
    }

    with patch.object(index, "submissions_table", mock_submissions_table):
        arguments = {}
        event = make_event("GetSubmissionHistory", arguments, identity={"sub": user_id})
        result = index.handle_get_submission_history(arguments, event)

    # Verify query was called WITHOUT FilterExpression
    query_call = mock_submissions_table.query.call_args
    query_kwargs = query_call[1] if query_call[1] else {}

    assert "FilterExpression" not in query_kwargs

    # Verify all items returned
    assert len(result["items"]) == 2


# ---------------------------------------------------------------------------
# Unit tests for GetGameSession handler
# **Validates: Requirements 7.2**
# ---------------------------------------------------------------------------


def test_get_game_session_returns_all_fields():
    """GetGameSession returns all fields — verify response includes status,
    gameEvents, consumedTiles, plannedPath, finalScore, agentResponse.

    **Validates: Requirements 7.2**
    """
    session_id = "session-full-fields"
    game_events = json.dumps([
        {"type": "MoveSpace", "row": 0, "col": 1},
        {"type": "FoundChallenge", "row": 1, "col": 1},
    ])
    consumed_tiles = json.dumps(["0,1", "1,1"])
    planned_path = json.dumps([{"row": 0, "col": 0}, {"row": 0, "col": 1}, {"row": 1, "col": 1}])
    agent_response = "Move right then down"

    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {
        "Item": {
            "sessionId": session_id,
            "status": "completed",
            "gameEvents": game_events,
            "consumedTiles": consumed_tiles,
            "plannedPath": planned_path,
            "agentResponse": agent_response,
            "finalScore": 4500,
            "error": None,
        }
    }

    with patch.object(index, "game_sessions_table", mock_sessions_table):
        arguments = {"sessionId": session_id}
        event = make_event("GetGameSession", arguments)
        result = index.handle_get_game_session(arguments, event)

    assert result["sessionId"] == session_id
    assert result["status"] == "completed"
    assert result["gameEvents"] == game_events
    assert result["consumedTiles"] == consumed_tiles
    assert result["plannedPath"] == planned_path
    assert result["agentResponse"] == agent_response
    assert result["finalScore"] == 4500


def test_get_game_session_not_found():
    """GetGameSession returns error when session not found.

    **Validates: Requirements 7.2**
    """
    session_id = "session-nonexistent"

    mock_sessions_table = MagicMock()
    mock_sessions_table.get_item.return_value = {}

    with patch.object(index, "game_sessions_table", mock_sessions_table):
        arguments = {"sessionId": session_id}
        event = make_event("GetGameSession", arguments)
        result = index.handle_get_game_session(arguments, event)

    assert result["sessionId"] == session_id
    assert result["status"] == "not_found"
    assert result["error"] == "Session not found"
