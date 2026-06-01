"""LLM Configuration Utilities — resolves user model preferences from DynamoDB.

Provides a helper function to read the user's LLM configuration and return
the appropriate model ID for a given purpose (challengeGeneration, challengeGrading,
gameCommentary).

Requirements: 15.8, 15.9
"""

import logging
import os

import boto3

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "amazon.nova-lite-v1:0"

# Valid purpose keys that map to fields in the LLM_CONFIG data
VALID_PURPOSES = {"challengeGeneration", "challengeGrading", "gameCommentary"}


def get_user_model_id(user_id: str, purpose: str) -> str:
    """Read the user's LLM configuration and return the model ID for the given purpose.

    Resolution order:
      1. Purpose-specific override (e.g., data.challengeGeneration) if not None
      2. Default model (data.defaultModel) if not None
      3. Hardcoded fallback: "amazon.nova-lite-v1:0"

    Args:
        user_id: The authenticated user ID.
        purpose: One of "challengeGeneration", "challengeGrading", "gameCommentary".

    Returns:
        The resolved Bedrock model ID string.
    """
    if purpose not in VALID_PURPOSES:
        logger.warning(f"Unknown purpose '{purpose}', falling back to default model")
        return DEFAULT_MODEL_ID

    table_name = os.environ.get("AGENT_CONFIGURATIONS_TABLE")
    if not table_name:
        logger.warning("AGENT_CONFIGURATIONS_TABLE env var not set, using default model")
        return DEFAULT_MODEL_ID

    try:
        dynamodb = boto3.resource("dynamodb")
        table = dynamodb.Table(table_name)
        response = table.get_item(Key={"userId": user_id, "sk": "LLM_CONFIG"})
    except Exception as e:
        logger.error(f"Error reading LLM config for user {user_id}: {e}")
        return DEFAULT_MODEL_ID

    item = response.get("Item")
    if not item:
        return DEFAULT_MODEL_ID

    data = item.get("data", {})

    # Check purpose-specific override first
    purpose_model = data.get(purpose)
    if purpose_model:
        return purpose_model

    # Fall back to default model
    default_model = data.get("defaultModel")
    if default_model:
        return default_model

    # Final fallback
    return DEFAULT_MODEL_ID
