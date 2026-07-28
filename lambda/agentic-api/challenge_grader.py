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
    """Case-insensitive, whitespace-trimmed string equality.
    
    Strips tool-use prefixes (e.g. 'Using tool: AgentCoreGatewayTool-X___calc')
    to extract the actual answer before comparing.
    """
    clean_response = _strip_tool_prefix(response)
    return clean_response.strip().lower() == expected.strip().lower()


def _contains_match(response: str, expected: str) -> bool:
    """Check if expected answer appears as a substring in the response."""
    return expected.lower() in response.lower()


def _strip_tool_prefix(response: str) -> str:
    """Strip tool-use prefix lines from an agent response.
    
    Handles formats like:
      'Using tool: AgentCoreGatewayTool-X___calc\n\nAWme'
      '\n\nUsing tool: AgentCoreGatewayTool-W___url\n\nOlympus Mons'
      'Using tool: AgentCoreGatewayTool-X___calc AWme'  (answer on same line)
    Returns the final content after the last tool prefix.
    """
    import re
    # Remove all "Using tool: ..." prefixes (with optional emoji) and get the remainder
    # Pattern matches optional emoji + "Using tool:" + tool name, then captures the rest
    cleaned = re.sub(
        r'(?:.*?)(?:\U0001f527\s*)?Using tool:\s*\S+',
        '',
        response,
        flags=re.DOTALL
    )
    # The above is greedy — instead, find the LAST tool prefix and take everything after
    parts = re.split(r'(?:\U0001f527\s*)?Using tool:\s*\S+', response)
    if len(parts) > 1:
        return parts[-1].strip()
    return response.strip()


def _json_exact_match(response: str, expected: str) -> bool:
    """Parse both as JSON and compare structural equality.

    Extracts JSON from the response by finding the first { or [ character,
    handling cases where the response contains tool-use prefixes or other text
    before the actual JSON payload.

    Returns False if either string fails to parse as valid JSON.
    """
    try:
        expected_json = json.loads(expected)
    except (json.JSONDecodeError, TypeError, ValueError):
        return False

    # Try parsing response as-is first
    try:
        response_json = json.loads(response)
        return response_json == expected_json
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    # Extract JSON from response — find first { or [
    first_brace = -1
    for i, ch in enumerate(response):
        if ch in ('{', '['):
            first_brace = i
            break

    if first_brace < 0:
        return False

    # Try parsing from the first brace to end, trimming trailing text if needed
    candidate = response[first_brace:].strip()
    try:
        response_json = json.loads(candidate)
        return response_json == expected_json
    except (json.JSONDecodeError, TypeError, ValueError):
        # Try finding matching closing brace/bracket
        open_char = candidate[0]
        close_char = '}' if open_char == '{' else ']'
        depth = 0
        for i, ch in enumerate(candidate):
            if ch == open_char:
                depth += 1
            elif ch == close_char:
                depth -= 1
                if depth == 0:
                    try:
                        response_json = json.loads(candidate[:i + 1])
                        return response_json == expected_json
                    except (json.JSONDecodeError, TypeError, ValueError):
                        return False
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
