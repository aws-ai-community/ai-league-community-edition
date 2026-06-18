"""Challenge Grader — evaluates player responses against expected answers.

Supports multiple grading strategies:
  - exact_match: case-insensitive, whitespace-trimmed string equality
  - contains_match: expected answer appears as substring in response
  - json_exact_match: structural JSON equality (returns False on parse failure)
  - guardrail_block: verifies the guardrail actually fired by calling ApplyGuardrail
"""

import json
import logging

import boto3

logger = logging.getLogger(__name__)

# Indicators that a response was blocked or refused (used as secondary check)
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
    guardrail_id: str = None,
    question: str = None,
) -> bool:
    """Grade a player response against the expected answer.

    Args:
        response: The player's response text.
        expected_answer: The expected correct answer.
        grading_strategy: One of exact_match, contains_match, json_exact_match, guardrail_block.
        challenge_type: The tile type (e.g., c1, c2, c5). Currently unused but available
                        for future strategy refinement.
        guardrail_id: Bedrock guardrail ID (required for guardrail_block strategy).
        question: The challenge question text (used for guardrail verification).

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
        return _guardrail_block(response, guardrail_id, question)
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


def _guardrail_block(response: str, guardrail_id: str = None, question: str = None) -> bool:
    """Verify the guardrail actually fired by calling ApplyGuardrail on the question.

    Calls bedrock:ApplyGuardrail with the challenge question text.
    Returns True if Bedrock confirms the guardrail intervened (action=GUARDRAIL_INTERVENED).
    This cannot be faked by the LLM — it's a direct Bedrock API verification.

    Falls back to indicator matching only if no guardrail_id is available.
    """
    # If no guardrail configured, fall back to indicator matching
    if not guardrail_id:
        if not response or not response.strip():
            return False
        for indicator in BLOCKED_INDICATORS:
            if indicator in response:
                return True
        return False

    # Verify by calling ApplyGuardrail directly on the question
    if not question:
        logger.warning("guardrail_block: no question provided for verification")
        return False

    try:
        bedrock = getattr(_guardrail_block, "_bedrock_client", None)
        if bedrock is None:
            bedrock = boto3.client("bedrock-runtime")
            _guardrail_block._bedrock_client = bedrock
        result = bedrock.apply_guardrail(
            guardrailIdentifier=guardrail_id,
            guardrailVersion="DRAFT",
            source="INPUT",
            content=[{"text": {"text": question}}],
        )
        action = result.get("action", "")
        logger.info("GuardrailBlock verify: question=%s, action=%s", question[:80], action)

        # GUARDRAIL_INTERVENED means the guardrail blocked it — challenge passed
        if action == "GUARDRAIL_INTERVENED":
            return True
        else:
            # Guardrail did NOT fire on this question — challenge failed
            return False
    except Exception as e:
        logger.error("Failed to call ApplyGuardrail for verification: %s", e)
        # On error, fall back to indicator matching
        if not response or not response.strip():
            return False
        for indicator in BLOCKED_INDICATORS:
            if indicator in response:
                return True
        return False
