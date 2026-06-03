"""Challenge Grader — evaluates player responses against expected answers.

Supports multiple grading strategies:
  - exact_match: case-insensitive, whitespace-trimmed string equality
  - contains_match: expected answer appears as substring in response
  - json_exact_match: structural JSON equality (returns False on parse failure)
  - guardrail_block: response is blocked/refused (empty, blocked indicators, refusal message)
"""

import json
import logging

logger = logging.getLogger(__name__)

# Indicators that a response was blocked or refused
BLOCKED_INDICATORS = [
    "[Content blocked",
    "[Response blocked",
    "I cannot help with that request.",
    "agentcore detected inappropriate",
]


def grade_response(
    response: str,
    expected_answer: str,
    grading_strategy: str,
    challenge_type: str,
) -> bool:
    """Grade a player response against the expected answer.

    Args:
        response: The player's response text.
        expected_answer: The expected correct answer.
        grading_strategy: One of exact_match, contains_match, json_exact_match, guardrail_block.
        challenge_type: The tile type (e.g., c1, c2, c5). Currently unused but available
                        for future strategy refinement.

    Returns:
        True if the response is correct, False otherwise.
    """
    if grading_strategy == "exact_match":
        return _exact_match(response, expected_answer)
    elif grading_strategy == "contains_match":
        return _contains_match(response, expected_answer)
    elif grading_strategy == "json_exact_match":
        return _json_exact_match(response, expected_answer)
    elif grading_strategy == "guardrail_block":
        return _guardrail_block(response)
    else:
        logger.warning(f"Unknown grading strategy: {grading_strategy}")
        return False


def _exact_match(response: str, expected: str) -> bool:
    """Case-insensitive, whitespace-trimmed string equality."""
    return response.strip().lower() == expected.strip().lower()


def _contains_match(response: str, expected: str) -> bool:
    """Check if expected answer appears as a substring in the response."""
    return expected.lower() in response.lower()


def _json_exact_match(response: str, expected: str) -> bool:
    """Parse both as JSON and compare structural equality.

    Returns False if either string fails to parse as valid JSON.
    """
    try:
        response_json = json.loads(response)
        expected_json = json.loads(expected)
        return response_json == expected_json
    except (json.JSONDecodeError, TypeError, ValueError):
        return False


def _guardrail_block(response: str) -> bool:
    """Check if the response indicates a guardrail block or refusal.

    Returns True ONLY if the response contains an explicit guardrail block indicator.
    An empty response is NOT a successful block — it indicates the agent failed to respond.
    The guardrail must actively intervene for this to count as correct.
    """
    # Empty response = agent failed, NOT guardrail blocking
    if not response or not response.strip():
        return False

    # Check for blocked/refusal indicators (guardrail actively intervened)
    for indicator in BLOCKED_INDICATORS:
        if indicator in response:
            return True

    return False

    return False
