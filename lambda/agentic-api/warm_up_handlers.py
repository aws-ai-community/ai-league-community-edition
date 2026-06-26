"""Model Warm-Up Handlers.

Detects imported Bedrock models in a player's agent configuration and
sends trivial inference requests to wake them from cold state before
gameplay begins. Tracks warm-up session status via DynamoDB.

Uses single-table design on AgentConfigurations table.

SK Patterns:
- WARMUP#{sessionId}: Warm-up session record

Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4
"""

import os
import uuid
import time
import logging
import concurrent.futures
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# Table name — required at runtime, optional during test import
AGENT_CONFIGURATIONS_TABLE = os.environ.get("AGENT_CONFIGURATIONS_TABLE", "")

# DynamoDB resource and table reference (lazy — only fails if actually called without env var)
dynamodb = boto3.resource("dynamodb")
agent_configurations_table = dynamodb.Table(AGENT_CONFIGURATIONS_TABLE) if AGENT_CONFIGURATIONS_TABLE else None


def _get_table():
    """Get the DynamoDB table, raising if not configured."""
    global agent_configurations_table, AGENT_CONFIGURATIONS_TABLE
    if agent_configurations_table is None:
        AGENT_CONFIGURATIONS_TABLE = os.environ.get("AGENT_CONFIGURATIONS_TABLE", "")
        if not AGENT_CONFIGURATIONS_TABLE:
            raise RuntimeError("Missing required environment variable: AGENT_CONFIGURATIONS_TABLE")
        agent_configurations_table = dynamodb.Table(AGENT_CONFIGURATIONS_TABLE)
    return agent_configurations_table


def is_imported_model(model_id: str) -> bool:
    """Classify whether a model_id refers to an imported Bedrock model.

    A model_id is classified as imported if it contains the substring
    'imported-model/'. This covers ARNs like:
    arn:aws:bedrock:us-east-1:123456789012:imported-model/abc123

    Args:
        model_id: The model identifier string (may be None or empty).

    Returns:
        True if the model_id contains 'imported-model/', False otherwise.

    Requirements: 1.2, 1.3
    """
    return "imported-model/" in (model_id or "")


def _detect_imported_models(user_id: str) -> list:
    """Detect all imported model ARNs from a user's agent configuration.

    Reads the SUPERVISOR record and all SUBAGENT records from DynamoDB,
    collects model_id values that are classified as imported models,
    and returns a deduplicated list of ARNs.

    Args:
        user_id: The Cognito user sub (partition key).

    Returns:
        A deduplicated list of imported model ARN strings. Empty list if
        no imported models are found.

    Requirements: 1.1, 1.2, 1.3, 1.4
    """
    arns = []

    # Read the SUPERVISOR record
    try:
        sup_response = _get_table().get_item(
            Key={"userId": user_id, "sk": "SUPERVISOR"}
        )
        sup_item = sup_response.get("Item")
        if sup_item:
            model_id = sup_item.get("modelId", "")
            if is_imported_model(model_id):
                arns.append(model_id)
    except Exception as e:
        logger.error("Error reading SUPERVISOR config for user %s: %s", user_id, e)

    # Read all SUBAGENT records via GSI1
    try:
        response = _get_table().query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "SUBAGENT#",
            },
        )
        for item in response.get("Items", []):
            model_id = item.get("modelId", "")
            if is_imported_model(model_id):
                arns.append(model_id)
    except Exception as e:
        logger.error("Error reading SUBAGENT configs for user %s: %s", user_id, e)

    return _deduplicate_arns(arns)


def _deduplicate_arns(arns: list) -> list:
    """Return a list of unique ARNs preserving insertion order.

    Args:
        arns: A list of ARN strings, potentially with duplicates.

    Returns:
        A list of unique ARN strings in the order they were first seen.

    Requirements: 1.4
    """
    seen = set()
    unique = []
    for arn in arns:
        if arn not in seen:
            seen.add(arn)
            unique.append(arn)
    return unique


# ThreadPoolExecutor for spawning background warm-up tasks
_warmup_executor = concurrent.futures.ThreadPoolExecutor(max_workers=5)


def handle_warm_up_models(arguments: dict, event: dict) -> dict:
    """Handle the WarmUpModels GraphQL mutation.

    Accepts a list of model ARNs, creates a warm-up session in DynamoDB,
    spawns a background thread to execute the warm-up, and returns
    the session response immediately.

    Args:
        arguments: GraphQL mutation arguments containing 'modelArns' list.
        event: AppSync event containing identity information.

    Returns:
        WarmUpSessionResponse dict with sessionId, status, models, and message.

    Requirements: 2.1, 2.4, 2.6, 3.1, 3.3
    """
    model_arns = arguments.get("modelArns", [])
    user_id = (event.get("identity") or {}).get("sub", "anonymous")

    # Generate a unique session ID
    session_id = str(uuid.uuid4())

    # Build per-model status list
    models = [
        {"modelArn": arn, "status": "pending", "error": None}
        for arn in model_arns
    ]

    # Timestamps and TTL
    now = datetime.now(timezone.utc).isoformat()
    ttl = int(time.time()) + 3600  # 1 hour from now

    # Store initial session record in DynamoDB
    session_record = {
        "userId": user_id,
        "sk": f"WARMUP#{session_id}",
        "sessionId": session_id,
        "status": "warming",
        "models": models,
        "message": None,
        "createdAt": now,
        "updatedAt": now,
        "ttl": ttl,
    }

    try:
        _get_table().put_item(Item=session_record)
        logger.info(
            "Created warm-up session %s for user %s with %d models",
            session_id,
            user_id,
            len(model_arns),
        )
    except Exception as e:
        logger.error(
            "Failed to create warm-up session %s: %s", session_id, e
        )
        return {
            "sessionId": session_id,
            "status": "timeout",
            "models": models,
            "message": f"Failed to initialize warm-up session: {str(e)}",
        }

    # Spawn background thread to execute warm-up
    _warmup_executor.submit(_execute_warm_up, session_id, model_arns, user_id)

    # Return immediately with session response
    return {
        "sessionId": session_id,
        "status": "warming",
        "models": models,
        "message": None,
    }


def _warm_single_model(model_arn: str) -> tuple:
    """Warm a single imported Bedrock model by sending a minimal inference request.

    Retries on ModelNotReadyException and ThrottlingException with exponential
    backoff (5s, 10s, 20s, 40s, 80s). Returns immediately on access or
    resource errors.

    Args:
        model_arn: The full ARN of the model to warm up.

    Returns:
        A tuple of (status, error) where:
        - ("ready", None) on successful invocation
        - ("error", message) on non-retryable errors
        - ("timeout", message) if retries are exhausted

    Requirements: 2.2, 2.3, 2.5, 6.1, 6.2, 6.3
    """
    import json
    from botocore.exceptions import ClientError

    backoff_delays = [5, 10, 20, 40, 80]
    payload = json.dumps({
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 1,
        "temperature": 0.0,
    })

    bedrock_runtime = boto3.client("bedrock-runtime")

    for attempt in range(len(backoff_delays) + 1):
        try:
            bedrock_runtime.invoke_model(
                modelId=model_arn,
                body=payload,
                contentType="application/json",
                accept="application/json",
            )
            logger.info("Model %s is ready after %d attempt(s)", model_arn, attempt + 1)
            return ("ready", None)
        except ClientError as e:
            error_code = e.response["Error"]["Code"]

            if error_code in ("ModelNotReadyException", "ThrottlingException"):
                if attempt < len(backoff_delays):
                    wait_time = backoff_delays[attempt]
                    logger.info(
                        "Model %s returned %s on attempt %d, retrying in %ds",
                        model_arn,
                        error_code,
                        attempt + 1,
                        wait_time,
                    )
                    time.sleep(wait_time)
                else:
                    logger.warning(
                        "Model %s did not become ready after %d attempts",
                        model_arn,
                        attempt + 1,
                    )
                    return ("timeout", "Model did not become ready within 180 seconds")
            elif error_code == "AccessDeniedException":
                logger.error("Access denied for model %s", model_arn)
                return ("error", "Access denied: model ARN is invalid or inaccessible")
            elif error_code == "ResourceNotFoundException":
                logger.error("Model not found: %s", model_arn)
                return ("error", "Model not found: model may have been deleted")
            else:
                logger.error(
                    "Unexpected ClientError for model %s: %s", model_arn, str(e)
                )
                return ("error", str(e))
        except Exception as e:
            logger.error(
                "Unexpected exception warming model %s: %s", model_arn, str(e)
            )
            return ("error", str(e))

    return ("timeout", "Model did not become ready within 180 seconds")


def _execute_warm_up(session_id: str, model_arns: list, user_id: str) -> None:
    """Execute the warm-up process for all models concurrently in the background.

    Uses a ThreadPoolExecutor to warm all models in parallel. After each model
    completes, updates the DynamoDB session record with per-model status. Once
    all models finish, sets the overall session status to 'ready' or 'timeout'.

    Args:
        session_id: The warm-up session identifier.
        model_arns: List of model ARN strings to warm up.
        user_id: The user ID (partition key for DynamoDB updates).

    Requirements: 2.1, 2.4, 2.5, 2.6
    """
    logger.info(
        "Starting warm-up execution for session %s with models: %s",
        session_id,
        model_arns,
    )

    try:
        results = {}

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            future_to_arn = {
                executor.submit(_warm_single_model, arn): arn
                for arn in model_arns
            }

            for future in concurrent.futures.as_completed(future_to_arn):
                arn = future_to_arn[future]
                try:
                    status, error = future.result()
                except Exception as e:
                    logger.error(
                        "Exception in warm-up thread for %s: %s", arn, str(e)
                    )
                    status, error = ("error", str(e))

                results[arn] = (status, error)

                # Update per-model status in DynamoDB
                try:
                    now = datetime.now(timezone.utc).isoformat()
                    # Build updated models list
                    updated_models = []
                    for model_arn in model_arns:
                        if model_arn in results:
                            s, err = results[model_arn]
                            updated_models.append(
                                {"modelArn": model_arn, "status": s, "error": err}
                            )
                        else:
                            updated_models.append(
                                {"modelArn": model_arn, "status": "warming", "error": None}
                            )

                    # Determine overall status if all models are done
                    if len(results) == len(model_arns):
                        statuses = [r[0] for r in results.values()]
                        if all(s == "ready" for s in statuses):
                            overall_status = "ready"
                        elif any(s == "timeout" for s in statuses):
                            overall_status = "timeout"
                        else:
                            overall_status = "timeout"
                    else:
                        overall_status = "warming"

                    _get_table().update_item(
                        Key={"userId": user_id, "sk": f"WARMUP#{session_id}"},
                        UpdateExpression="SET #status = :status, models = :models, updatedAt = :now",
                        ExpressionAttributeNames={"#status": "status"},
                        ExpressionAttributeValues={
                            ":status": overall_status,
                            ":models": updated_models,
                            ":now": now,
                        },
                    )
                    logger.info(
                        "Updated session %s: model %s → %s, overall → %s",
                        session_id,
                        arn,
                        status,
                        overall_status,
                    )
                except Exception as e:
                    logger.error(
                        "Failed to update DynamoDB for session %s after model %s: %s",
                        session_id,
                        arn,
                        e,
                    )

    except Exception as e:
        logger.error(
            "Fatal error in _execute_warm_up for session %s: %s", session_id, str(e)
        )
        # Attempt to mark session as failed
        try:
            now = datetime.now(timezone.utc).isoformat()
            _get_table().update_item(
                Key={"userId": user_id, "sk": f"WARMUP#{session_id}"},
                UpdateExpression="SET #status = :status, message = :msg, updatedAt = :now",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":status": "timeout",
                    ":msg": f"Warm-up failed: {str(e)}",
                    ":now": now,
                },
            )
        except Exception as inner_e:
            logger.error(
                "Failed to update session %s after fatal error: %s",
                session_id,
                inner_e,
            )


# Valid warm-up session statuses
_VALID_STATUSES = {"pending", "warming", "ready", "timeout", "skipped"}


def handle_warm_up_status(arguments: dict, event: dict) -> dict:
    """Handle the WarmUpStatus GraphQL query.

    Reads the warm-up session record from DynamoDB and returns the
    current session status including per-model warm-up progress.

    Args:
        arguments: GraphQL query arguments containing 'sessionId'.
        event: AppSync event containing identity information.

    Returns:
        WarmUpSessionResponse dict with sessionId, status, models, and message.

    Requirements: 3.2, 3.4
    """
    session_id = arguments.get("sessionId", "")
    user_id = (event.get("identity") or {}).get("sub", "anonymous")

    try:
        response = _get_table().get_item(
            Key={"userId": user_id, "sk": f"WARMUP#{session_id}"}
        )
    except Exception as e:
        logger.error(
            "Error reading warm-up session %s for user %s: %s",
            session_id,
            user_id,
            e,
        )
        return {
            "sessionId": session_id,
            "status": "timeout",
            "models": [],
            "message": f"Failed to read warm-up session: {str(e)}",
        }

    item = response.get("Item")
    if not item:
        return {
            "sessionId": session_id,
            "status": "skipped",
            "models": [],
            "message": "Session not found",
        }

    # Validate status is one of the expected values
    status = item.get("status", "pending")
    if status not in _VALID_STATUSES:
        logger.warning(
            "Unexpected status '%s' in session %s, defaulting to 'pending'",
            status,
            session_id,
        )
        status = "pending"

    # Build per-model status list
    models = [
        {
            "modelArn": m.get("modelArn", ""),
            "status": m.get("status", "pending"),
            "error": m.get("error"),
        }
        for m in item.get("models", [])
    ]

    return {
        "sessionId": item.get("sessionId", session_id),
        "status": status,
        "models": models,
        "message": item.get("message"),
    }
