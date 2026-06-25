"""Fine-Tuning Custom Model Handlers.

Handles registration, deployment, deletion, listing, and status checks
for SageMaker training jobs registered as custom models via Bedrock
Custom Model Deployments.

Uses single-table design on AgentConfigurations table.

SK Pattern:
- CUSTOMMODEL#{modelId}: Custom model entry

Requirements: 3.2, 9.1, 9.3
"""

import re
import os
import time
import uuid
import logging
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _get_required_env(name: str) -> str:
    """Get a required environment variable or fail fast with a clear error."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"Ensure the Lambda function is configured with all required table name variables."
        )
    return value


# Fail fast on cold start if required env var is missing
AGENT_CONFIGURATIONS_TABLE = _get_required_env("AGENT_CONFIGURATIONS_TABLE")

# Optional: bucket for sample training artifacts (pre-signed URL generation)
TRAINING_ARTIFACTS_BUCKET = os.environ.get("TRAINING_ARTIFACTS_BUCKET", "")

# DynamoDB resource and table reference
dynamodb = boto3.resource("dynamodb")
agent_configurations_table = dynamodb.Table(AGENT_CONFIGURATIONS_TABLE)

# AWS service clients
sagemaker_client = boto3.client("sagemaker")
bedrock_client = boto3.client("bedrock")
s3_client = boto3.client("s3")

# ARN validation regex for SageMaker training job ARNs
TRAINING_JOB_ARN_PATTERN = re.compile(
    r"^arn:aws:sagemaker:[a-z0-9-]+:\d{12}:training-job/[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?$"
)


def validate_training_job_arn(arn: str) -> bool:
    """Validate that a string matches the SageMaker training job ARN format.

    Valid format: arn:aws:sagemaker:{region}:{account}:training-job/{job-name}
    Job name: alphanumeric, hyphens allowed (not at start/end).
    """
    if not arn or not isinstance(arn, str):
        return False
    return bool(TRAINING_JOB_ARN_PATTERN.match(arn))


def _get_user_id(event: dict) -> str:
    """Extract user identity from AppSync event.

    For Cognito auth: event['identity']['sub'] contains the Cognito user ID.
    For API Key auth: event['identity'] is None → return "anonymous".
    """
    identity = event.get("identity")
    if identity is None:
        return "anonymous"
    # Cognito identity has 'sub' claim
    sub = identity.get("sub")
    if sub:
        return sub
    # Fallback for other identity types
    return identity.get("username", "anonymous")


def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


# Whitelist of allowed training artifact keys for security
ALLOWED_ARTIFACT_KEYS = frozenset([
    "tool-call-training.jsonl",
    "tool-call-eval.jsonl",
    "reward-function-tool-call.py",
    "faithfulness-training.jsonl",
    "faithfulness-eval.jsonl",
    "reward-function-faithfulness.py",
])


def handle_get_training_artifact_url(arguments: dict, event: dict) -> dict:
    """Generate a pre-signed URL for downloading a sample training artifact.

    Args:
        arguments: {artifactKey: str} - one of the allowed artifact keys
        event: AppSync event with identity

    Returns:
        {url: str, expiresIn: int}

    Requirements: 2.1, 2.2
    """
    if not TRAINING_ARTIFACTS_BUCKET:
        logger.error("TRAINING_ARTIFACTS_BUCKET environment variable is not configured")
        raise RuntimeError(
            "Training artifacts bucket is not configured. "
            "Ensure TRAINING_ARTIFACTS_BUCKET environment variable is set."
        )

    artifact_key = arguments.get("artifactKey", "")

    if artifact_key not in ALLOWED_ARTIFACT_KEYS:
        raise ValueError(
            f"Invalid artifact key: '{artifact_key}'. "
            f"Allowed keys are: {', '.join(sorted(ALLOWED_ARTIFACT_KEYS))}"
        )

    try:
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": TRAINING_ARTIFACTS_BUCKET,
                "Key": f"samples/{artifact_key}",
                "ResponseContentDisposition": f"attachment; filename=\"{artifact_key}\"",
            },
            ExpiresIn=3600,
        )
    except Exception as e:
        logger.error("Failed to generate pre-signed URL for artifact '%s': %s", artifact_key, e)
        raise RuntimeError(
            f"Failed to generate download URL for '{artifact_key}'. Please try again later."
        ) from e

    return {"url": presigned_url, "expiresIn": 3600}


def handle_register_custom_model(arguments: dict, event: dict) -> dict:
    """Register a SageMaker training job as a custom model.

    Args:
        arguments: {name: str, trainingJobArn: str}
        event: AppSync event with identity

    Returns:
        CustomModel response dict matching the GraphQL CustomModel type.

    Steps:
        1. Extract userId from event
        2. Validate trainingJobArn format (regex)
        3. Call SageMaker DescribeTrainingJob to verify ARN exists and is Completed
        4. Check for duplicate trainingJobArn for this user
        5. Generate modelId (uuid4)
        6. Write DynamoDB record with status="Registered"
        7. Return CustomModel response

    Requirements: 3.1, 3.2, 3.3, 3.4, 9.1, 9.2, 9.3, 9.4, 9.5
    """
    user_id = _get_user_id(event)
    name = arguments.get("name", "")
    training_job_arn = arguments.get("trainingJobArn", "")

    # Step 2: Validate ARN format
    if not validate_training_job_arn(training_job_arn):
        logger.warning(
            "Invalid training job ARN format from user %s: %s", user_id, training_job_arn
        )
        return {
            "modelId": "",
            "userId": user_id,
            "name": name,
            "trainingJobArn": training_job_arn,
            "deploymentArn": None,
            "status": "Error",
            "baseModelId": None,
            "failureReason": "Invalid training job ARN format",
            "createdAt": None,
            "updatedAt": None,
        }

    # Step 3: Call SageMaker DescribeTrainingJob to verify ARN exists and status
    try:
        # Extract job name from the ARN for the API call
        job_name = training_job_arn.split("/")[-1]
        describe_response = sagemaker_client.describe_training_job(
            TrainingJobName=job_name
        )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code == "ValidationException" or "ResourceNotFound" in str(e):
            logger.warning(
                "Training job not found for user %s, ARN: %s", user_id, training_job_arn
            )
            return {
                "modelId": "",
                "userId": user_id,
                "name": name,
                "trainingJobArn": training_job_arn,
                "deploymentArn": None,
                "status": "Error",
                "baseModelId": None,
                "failureReason": "Training job not found",
                "createdAt": None,
                "updatedAt": None,
            }
        raise
    except Exception as e:
        logger.error(
            "Error describing training job for user %s, ARN %s: %s",
            user_id, training_job_arn, e
        )
        return {
            "modelId": "",
            "userId": user_id,
            "name": name,
            "trainingJobArn": training_job_arn,
            "deploymentArn": None,
            "status": "Error",
            "baseModelId": None,
            "failureReason": "Training job not found",
            "createdAt": None,
            "updatedAt": None,
        }

    # Verify training job is completed
    training_job_status = describe_response.get("TrainingJobStatus", "")
    if training_job_status != "Completed":
        logger.warning(
            "Training job not completed for user %s, ARN: %s, status: %s",
            user_id, training_job_arn, training_job_status
        )
        return {
            "modelId": "",
            "userId": user_id,
            "name": name,
            "trainingJobArn": training_job_arn,
            "deploymentArn": None,
            "status": "Error",
            "baseModelId": None,
            "failureReason": f"Training job must be in Completed status, current status: {training_job_status}",
            "createdAt": None,
            "updatedAt": None,
        }

    # Extract base model ID from training job metadata
    algorithm_spec = describe_response.get("AlgorithmSpecification", {})
    base_model_id = algorithm_spec.get("TrainingImage", "") or ""

    # Step 4: Check for duplicate trainingJobArn for this user
    try:
        existing_response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("gsi1pk").eq(f"USER#{user_id}")
            & Key("gsi1sk").begins_with("CUSTOMMODEL#"),
        )
        existing_items = existing_response.get("Items", [])
        for item in existing_items:
            if item.get("trainingJobArn") == training_job_arn:
                logger.warning(
                    "Duplicate training job ARN for user %s: %s",
                    user_id, training_job_arn
                )
                return {
                    "modelId": "",
                    "userId": user_id,
                    "name": name,
                    "trainingJobArn": training_job_arn,
                    "deploymentArn": None,
                    "status": "Error",
                    "baseModelId": None,
                    "failureReason": "Training job already registered",
                    "createdAt": None,
                    "updatedAt": None,
                }
    except Exception as e:
        logger.error(
            "Error checking for duplicate ARN for user %s: %s", user_id, e
        )
        return {
            "modelId": "",
            "userId": user_id,
            "name": name,
            "trainingJobArn": training_job_arn,
            "deploymentArn": None,
            "status": "Error",
            "baseModelId": None,
            "failureReason": f"Failed to check for duplicates: {e}",
            "createdAt": None,
            "updatedAt": None,
        }

    # Step 5: Generate modelId
    model_id = str(uuid.uuid4())
    now = _now_iso()

    # Step 6: Write DynamoDB record
    item = {
        "userId": user_id,
        "sk": f"CUSTOMMODEL#{model_id}",
        "modelId": model_id,
        "name": name,
        "trainingJobArn": training_job_arn,
        "status": "Registered",
        "baseModelId": base_model_id,
        "deploymentArn": None,
        "failureReason": None,
        "gsi1pk": f"USER#{user_id}",
        "gsi1sk": f"CUSTOMMODEL#{now}",
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        agent_configurations_table.put_item(Item=item)
    except Exception as e:
        logger.error(
            "Error writing custom model record for user %s: %s", user_id, e
        )
        return {
            "modelId": "",
            "userId": user_id,
            "name": name,
            "trainingJobArn": training_job_arn,
            "deploymentArn": None,
            "status": "Error",
            "baseModelId": None,
            "failureReason": f"Failed to register custom model: {e}",
            "createdAt": None,
            "updatedAt": None,
        }

    # Step 7: Return CustomModel response
    logger.info(
        "Custom model registered: modelId=%s, user=%s, arn=%s",
        model_id, user_id, training_job_arn
    )
    return {
        "modelId": model_id,
        "userId": user_id,
        "name": name,
        "trainingJobArn": training_job_arn,
        "deploymentArn": None,
        "status": "Registered",
        "baseModelId": base_model_id,
        "failureReason": None,
        "createdAt": now,
        "updatedAt": now,
    }


def handle_deploy_custom_model(arguments: dict, event: dict) -> dict:
    """Deploy a registered custom model via Bedrock Custom Model Deployment.

    Args:
        arguments: {modelId: str}
        event: AppSync event with identity

    Returns:
        CustomModel response dict matching the GraphQL CustomModel type.

    Steps:
        1. Load CUSTOMMODEL record from DynamoDB
        2. Validate status is "Registered" or "Failed" (allow retry)
        3. Update status to "Deploying"
        4. Call Bedrock CreateCustomModelDeployment with trainingJobArn
        5. Store deploymentArn, update status to "Deployed"
        6. On failure: update status to "Failed", store failureReason

    Requirements: 4.1, 4.2, 4.3, 4.4, 9.4, 9.5
    """
    user_id = _get_user_id(event)
    model_id = arguments.get("modelId", "")

    # Step 1: Load CUSTOMMODEL record from DynamoDB
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"}
        )
    except Exception as e:
        logger.error(
            "Error loading custom model record for user %s, modelId %s: %s",
            user_id, model_id, e
        )
        return {
            "modelId": model_id,
            "userId": user_id,
            "name": "",
            "trainingJobArn": "",
            "deploymentArn": None,
            "status": "Error",
            "baseModelId": None,
            "failureReason": f"Failed to load custom model: {e}",
            "createdAt": None,
            "updatedAt": None,
        }

    item = response.get("Item")
    if not item:
        logger.warning(
            "Custom model not found for user %s, modelId %s", user_id, model_id
        )
        return {
            "modelId": model_id,
            "userId": user_id,
            "name": "",
            "trainingJobArn": "",
            "deploymentArn": None,
            "status": "Error",
            "baseModelId": None,
            "failureReason": "Custom model not found",
            "createdAt": None,
            "updatedAt": None,
        }

    # Step 2: Validate status allows deployment
    current_status = item.get("status", "")
    if current_status not in ("Registered", "Failed"):
        logger.warning(
            "Cannot deploy custom model with status '%s' for user %s, modelId %s",
            current_status, user_id, model_id
        )
        return {
            "modelId": model_id,
            "userId": user_id,
            "name": item.get("name", ""),
            "trainingJobArn": item.get("trainingJobArn", ""),
            "deploymentArn": item.get("deploymentArn"),
            "status": current_status,
            "baseModelId": item.get("baseModelId"),
            "failureReason": f"Cannot deploy model with status '{current_status}'. Only models with status 'Registered' or 'Failed' can be deployed.",
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }

    # Step 3: Update status to "Deploying" and clear any previous failureReason
    now = _now_iso()
    try:
        agent_configurations_table.update_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
            UpdateExpression="SET #status = :deploying, updatedAt = :now REMOVE failureReason",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":deploying": "Deploying", ":now": now},
        )
    except Exception as e:
        logger.error(
            "Error updating status to Deploying for user %s, modelId %s: %s",
            user_id, model_id, e
        )
        return {
            "modelId": model_id,
            "userId": user_id,
            "name": item.get("name", ""),
            "trainingJobArn": item.get("trainingJobArn", ""),
            "deploymentArn": item.get("deploymentArn"),
            "status": current_status,
            "baseModelId": item.get("baseModelId"),
            "failureReason": f"Failed to update status: {e}",
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }

    # Step 4: Get model artifacts S3 URI from the training job
    training_job_arn = item.get("trainingJobArn", "")
    model_name = item.get("name", "").replace(" ", "-").lower()[:50] or f"model-{model_id[:8]}"
    try:
        job_name = training_job_arn.split("/")[-1]
        job_details = sagemaker_client.describe_training_job(TrainingJobName=job_name)
        model_s3_uri = job_details.get("ModelArtifacts", {}).get("S3ModelArtifacts", "")
        role_arn = job_details.get("RoleArn", "")

        if not model_s3_uri:
            raise ValueError("Training job has no model artifacts S3 URI")
        if not role_arn:
            raise ValueError("Training job has no RoleArn")

        logger.info(
            "Deploy: Got model artifacts for %s: s3=%s, role=%s",
            model_id, model_s3_uri, role_arn
        )
    except Exception as e:
        failure_reason = f"Failed to get training job details: {e}"
        logger.error("Deploy: %s for user %s, modelId %s", failure_reason, user_id, model_id)
        failed_now = _now_iso()
        try:
            agent_configurations_table.update_item(
                Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
                UpdateExpression="SET #status = :failed, failureReason = :reason, updatedAt = :now",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":failed": "Failed", ":reason": failure_reason, ":now": failed_now},
            )
        except Exception:
            pass
        return {
            "modelId": model_id, "userId": user_id, "name": item.get("name", ""),
            "trainingJobArn": training_job_arn, "deploymentArn": None,
            "status": "Failed", "baseModelId": item.get("baseModelId"),
            "failureReason": failure_reason,
            "createdAt": item.get("createdAt"), "updatedAt": failed_now,
        }

    # Step 5: Import model into Bedrock as a custom model
    bedrock_model_name = f"ft-{model_id[:8]}-{model_name}"[:63]
    try:
        import_response = bedrock_client.create_custom_model(
            modelName=bedrock_model_name,
            modelSourceConfig={
                "s3DataSource": {"s3Uri": model_s3_uri}
            },
            roleArn=role_arn,
        )
        bedrock_model_arn = import_response.get("modelArn", "")
        logger.info(
            "Deploy: Imported model into Bedrock: modelArn=%s for modelId=%s",
            bedrock_model_arn, model_id
        )
    except Exception as e:
        failure_reason = f"Failed to import model into Bedrock: {e}"
        logger.error("Deploy: %s for user %s, modelId %s", failure_reason, user_id, model_id)
        failed_now = _now_iso()
        try:
            agent_configurations_table.update_item(
                Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
                UpdateExpression="SET #status = :failed, failureReason = :reason, updatedAt = :now",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":failed": "Failed", ":reason": failure_reason, ":now": failed_now},
            )
        except Exception:
            pass
        return {
            "modelId": model_id, "userId": user_id, "name": item.get("name", ""),
            "trainingJobArn": training_job_arn, "deploymentArn": None,
            "status": "Failed", "baseModelId": item.get("baseModelId"),
            "failureReason": failure_reason,
            "createdAt": item.get("createdAt"), "updatedAt": failed_now,
        }

    # Step 6: Deploy the Bedrock custom model for on-demand inference
    try:
        deploy_response = bedrock_client.create_custom_model_deployment(
            modelDeploymentName=f"deploy-{model_id[:8]}-{model_name}"[:63],
            modelArn=bedrock_model_arn,
        )
        deployment_arn = deploy_response.get("customModelDeploymentArn", "")
    except Exception as e:
        failure_reason = f"Model imported but deployment failed: {e}"
        logger.error(
            "Bedrock CreateCustomModelDeployment failed for user %s, modelId %s: %s",
            user_id, model_id, failure_reason
        )
        failed_now = _now_iso()
        try:
            agent_configurations_table.update_item(
                Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
                UpdateExpression="SET #status = :failed, failureReason = :reason, updatedAt = :now",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":failed": "Failed",
                    ":reason": failure_reason,
                    ":now": failed_now,
                },
            )
        except Exception as update_err:
            logger.error(
                "Failed to update status to Failed for user %s, modelId %s: %s",
                user_id, model_id, update_err
            )

        return {
            "modelId": model_id,
            "userId": user_id,
            "name": item.get("name", ""),
            "trainingJobArn": training_job_arn,
            "deploymentArn": None,
            "status": "Failed",
            "baseModelId": item.get("baseModelId"),
            "failureReason": failure_reason,
            "createdAt": item.get("createdAt"),
            "updatedAt": failed_now,
        }

    # Step 5: On success — store deploymentArn, keep status as "Deploying"
    # The status check handler (GetCustomModelStatus) will update to "Deployed" when Bedrock reports ACTIVE
    deployed_now = _now_iso()
    try:
        agent_configurations_table.update_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
            UpdateExpression="SET deploymentArn = :arn, updatedAt = :now",
            ExpressionAttributeValues={
                ":arn": deployment_arn,
                ":now": deployed_now,
            },
        )
    except Exception as e:
        logger.error(
            "Error storing deploymentArn for user %s, modelId %s: %s",
            user_id, model_id, e
        )
        # Return Deploying status anyway since the Bedrock deployment was initiated
        return {
            "modelId": model_id,
            "userId": user_id,
            "name": item.get("name", ""),
            "trainingJobArn": training_job_arn,
            "deploymentArn": deployment_arn,
            "status": "Deploying",
            "baseModelId": item.get("baseModelId"),
            "failureReason": None,
            "createdAt": item.get("createdAt"),
            "updatedAt": deployed_now,
        }

    logger.info(
        "Custom model deployment initiated: modelId=%s, user=%s, deploymentArn=%s",
        model_id, user_id, deployment_arn
    )
    return {
        "modelId": model_id,
        "userId": user_id,
        "name": item.get("name", ""),
        "trainingJobArn": training_job_arn,
        "deploymentArn": deployment_arn,
        "status": "Deploying",
        "baseModelId": item.get("baseModelId"),
        "failureReason": None,
        "createdAt": item.get("createdAt"),
        "updatedAt": deployed_now,
    }


def handle_get_custom_model_status(arguments: dict, event: dict) -> dict:
    """Get current status of a custom model, checking Bedrock deployment state if deploying.

    Args:
        arguments: {modelId: str}
        event: AppSync event with identity

    Returns:
        CustomModel response dict matching the GraphQL CustomModel type,
        or None if record not found.

    Steps:
        1. Load CUSTOMMODEL record by userId and modelId (direct get_item)
        2. If record not found, return None
        3. If status is "Deploying": call Bedrock GetCustomModelDeployment to check actual state
           - If deployment is active/completed: update DynamoDB to "Deployed", store deploymentArn
           - If deployment failed: update DynamoDB to "Failed", store failureReason
        4. Return current CustomModel state dict

    Requirements: 4.3, 4.4
    """
    user_id = _get_user_id(event)
    model_id = arguments.get("modelId", "")

    if not model_id:
        logger.warning("GetCustomModelStatus called without modelId by user %s", user_id)
        return None

    # Step 1: Load the CUSTOMMODEL record by direct get_item
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"}
        )
    except Exception as e:
        logger.error(
            "Error loading custom model %s for user %s: %s", model_id, user_id, e
        )
        return None

    item = response.get("Item")

    # Step 2: If record not found, return None
    if not item:
        logger.warning(
            "Custom model not found: modelId=%s, user=%s", model_id, user_id
        )
        return None

    # Step 3: If status is "Deploying", check Bedrock deployment state
    if item.get("status") == "Deploying":
        deployment_arn = item.get("deploymentArn")
        if deployment_arn:
            try:
                deployment_response = bedrock_client.get_custom_model_deployment(
                    customModelDeploymentIdentifier=deployment_arn
                )
                deployment_status = deployment_response.get("status", "")

                now = _now_iso()

                if deployment_status in ("ACTIVE", "Active", "Completed", "COMPLETED"):
                    # Deployment is active/completed - update to "Deployed"
                    agent_configurations_table.update_item(
                        Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
                        UpdateExpression="SET #status = :status, updatedAt = :now",
                        ExpressionAttributeNames={"#status": "status"},
                        ExpressionAttributeValues={
                            ":status": "Deployed",
                            ":now": now,
                        },
                    )
                    item["status"] = "Deployed"
                    item["updatedAt"] = now
                    logger.info(
                        "Custom model %s deployment active, updated to Deployed", model_id
                    )

                elif deployment_status in ("FAILED", "Failed"):
                    # Deployment failed - update to "Failed"
                    failure_reason = deployment_response.get(
                        "failureMessage",
                        deployment_response.get("failureReason", "Deployment failed"),
                    )
                    agent_configurations_table.update_item(
                        Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
                        UpdateExpression="SET #status = :status, failureReason = :reason, updatedAt = :now",
                        ExpressionAttributeNames={"#status": "status"},
                        ExpressionAttributeValues={
                            ":status": "Failed",
                            ":reason": failure_reason,
                            ":now": now,
                        },
                    )
                    item["status"] = "Failed"
                    item["failureReason"] = failure_reason
                    item["updatedAt"] = now
                    logger.info(
                        "Custom model %s deployment failed: %s", model_id, failure_reason
                    )

                # If status is still in progress (e.g., "CREATING", "InProgress"),
                # leave as "Deploying" and return current state

            except Exception as e:
                logger.error(
                    "Error checking deployment status for model %s (arn=%s): %s",
                    model_id, deployment_arn, e
                )
                # Return current state without update on error

    # Step 4: Return current CustomModel state dict
    return {
        "modelId": item.get("modelId"),
        "userId": item.get("userId"),
        "name": item.get("name"),
        "trainingJobArn": item.get("trainingJobArn"),
        "deploymentArn": item.get("deploymentArn"),
        "status": item.get("status"),
        "baseModelId": item.get("baseModelId"),
        "failureReason": item.get("failureReason"),
        "createdAt": item.get("createdAt"),
        "updatedAt": item.get("updatedAt"),
    }


def handle_delete_custom_model(arguments: dict, event: dict) -> dict:
    """Delete a custom model record from DynamoDB.

    Args:
        arguments: {modelId: str, force: bool (optional, kept for backwards compat)}
        event: AppSync event with identity

    Returns:
        MutationResponse dict {success, statusCode, message}

    Steps:
        1. Load CUSTOMMODEL record from DynamoDB
        2. If status is "Deployed", block deletion — user must undeploy first
        3. If deploymentArn exists (edge case during failures): check if in use by any agent config
        4. Delete DynamoDB record
        5. Return success

    Requirements: 5.1, 5.2, 5.3, 5.4
    """
    user_id = _get_user_id(event)
    model_id = arguments.get("modelId", "")

    # Step 1: Load CUSTOMMODEL record from DynamoDB
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"}
        )
    except Exception as e:
        logger.error(
            "Error loading custom model record for user %s, modelId %s: %s",
            user_id, model_id, e
        )
        return {
            "success": False,
            "statusCode": 500,
            "message": f"Failed to load custom model: {e}",
        }

    item = response.get("Item")
    if not item:
        logger.warning(
            "Custom model not found for deletion: user %s, modelId %s", user_id, model_id
        )
        return {
            "success": False,
            "statusCode": 404,
            "message": "Custom model not found",
        }

    # Step 2: If status is "Deployed", block deletion
    current_status = item.get("status", "")
    if current_status == "Deployed":
        return {
            "success": False,
            "statusCode": 400,
            "message": "Cannot delete a deployed model. Undeploy it first.",
        }

    deployment_arn = item.get("deploymentArn")

    # Step 3: If deploymentArn exists (edge case during failures), check if in use
    if deployment_arn:
        used_by = []

        try:
            # Check SUPERVISOR record
            supervisor_response = agent_configurations_table.get_item(
                Key={"userId": user_id, "sk": "SUPERVISOR"}
            )
            supervisor_item = supervisor_response.get("Item")
            if supervisor_item and supervisor_item.get("modelId") == deployment_arn:
                used_by.append(supervisor_item.get("name", "Supervisor"))

            # Check all SUBAGENT# records
            subagent_response = agent_configurations_table.query(
                IndexName="GSI1",
                KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
                ExpressionAttributeValues={
                    ":pk": f"USER#{user_id}",
                    ":prefix": "SUBAGENT#",
                },
            )
            subagent_items = subagent_response.get("Items", [])
            for subagent in subagent_items:
                if subagent.get("modelId") == deployment_arn:
                    used_by.append(subagent.get("name", "Sub-agent"))

        except Exception as e:
            logger.warning(
                "Error checking model usage for user %s, modelId %s: %s",
                user_id, model_id, e
            )

        if used_by:
            agent_names = ", ".join(used_by)
            return {
                "success": False,
                "statusCode": 409,
                "message": f"Model is currently in use by: {agent_names}. Remove it from agent configuration before deleting.",
            }

    # Step 4: Delete DynamoDB record
    try:
        agent_configurations_table.delete_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"}
        )
    except Exception as e:
        logger.error(
            "Error deleting custom model record for user %s, modelId %s: %s",
            user_id, model_id, e
        )
        return {
            "success": False,
            "statusCode": 500,
            "message": f"Failed to delete custom model record: {e}",
        }

    # Step 5: Return success
    logger.info(
        "Custom model deleted: modelId=%s, user=%s", model_id, user_id
    )
    return {
        "success": True,
        "statusCode": 200,
        "message": "Custom model deleted successfully",
    }


def handle_undeploy_custom_model(arguments: dict, event: dict) -> dict:
    """Undeploy a deployed custom model, removing its Bedrock deployment.

    Args:
        arguments: {modelId: str}
        event: AppSync event with identity

    Returns:
        MutationResponse dict {success, statusCode, message}

    Steps:
        1. Load CUSTOMMODEL record from DynamoDB
        2. Verify status is "Deployed" — return error if not
        3. Check if deploymentArn is in use by any agent config
        4. Call Bedrock DeleteCustomModelDeployment with retry (3 attempts, exponential backoff)
        5. Verify deletion by calling GetCustomModelDeployment
        6. Update DynamoDB: clear deploymentArn, set status to "Registered", update updatedAt
        7. Return success
    """
    user_id = _get_user_id(event)
    model_id = arguments.get("modelId", "")

    # Step 1: Load CUSTOMMODEL record from DynamoDB
    try:
        response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"}
        )
    except Exception as e:
        logger.error(
            "Error loading custom model record for user %s, modelId %s: %s",
            user_id, model_id, e
        )
        return {
            "success": False,
            "statusCode": 500,
            "message": f"Failed to load custom model: {e}",
        }

    item = response.get("Item")
    if not item:
        return {
            "success": False,
            "statusCode": 404,
            "message": "Custom model not found",
        }

    # Step 2: Verify status is "Deployed"
    current_status = item.get("status", "")
    if current_status != "Deployed":
        return {
            "success": False,
            "statusCode": 400,
            "message": f"Cannot undeploy model with status '{current_status}'. Only deployed models can be undeployed.",
        }

    deployment_arn = item.get("deploymentArn")
    if not deployment_arn:
        return {
            "success": False,
            "statusCode": 400,
            "message": "Model has no deployment ARN. Cannot undeploy.",
        }

    # Step 3: Check if deploymentArn is in use by any agent config
    used_by = []
    try:
        # Check SUPERVISOR record
        supervisor_response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "SUPERVISOR"}
        )
        supervisor_item = supervisor_response.get("Item")
        if supervisor_item and supervisor_item.get("modelId") == deployment_arn:
            used_by.append(supervisor_item.get("name", "Supervisor"))

        # Check all SUBAGENT# records
        subagent_response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression="gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
            ExpressionAttributeValues={
                ":pk": f"USER#{user_id}",
                ":prefix": "SUBAGENT#",
            },
        )
        subagent_items = subagent_response.get("Items", [])
        for subagent in subagent_items:
            if subagent.get("modelId") == deployment_arn:
                used_by.append(subagent.get("name", "Sub-agent"))

    except Exception as e:
        logger.warning(
            "Error checking model usage for user %s, modelId %s: %s",
            user_id, model_id, e
        )

    if used_by:
        agent_names = ", ".join(used_by)
        return {
            "success": False,
            "statusCode": 409,
            "message": f"Model is currently in use by: {agent_names}. Remove it from agent configuration before undeploying.",
        }

    # Step 4: Call Bedrock DeleteCustomModelDeployment with retry (3 attempts, exponential backoff)
    delete_succeeded = False
    last_error = None
    for attempt in range(3):
        try:
            bedrock_client.delete_custom_model_deployment(
                customModelDeploymentIdentifier=deployment_arn
            )
            delete_succeeded = True
            break
        except Exception as e:
            last_error = e
            logger.warning(
                "Undeploy attempt %d failed for deployment %s: %s",
                attempt + 1, deployment_arn, e
            )
            if attempt < 2:
                time.sleep(2 ** attempt)  # 1s, 2s

    if not delete_succeeded:
        logger.error(
            "Failed to delete Bedrock deployment %s after 3 attempts: %s",
            deployment_arn, last_error
        )
        return {
            "success": False,
            "statusCode": 500,
            "message": f"Failed to undeploy model after 3 attempts: {last_error}",
        }

    # Step 5: Verify deletion
    try:
        verify_response = bedrock_client.get_custom_model_deployment(
            customModelDeploymentIdentifier=deployment_arn
        )
        verify_status = verify_response.get("status", "")
        if verify_status not in ("Deleting", "DELETING"):
            logger.warning(
                "Deployment %s still active with status '%s' after delete call",
                deployment_arn, verify_status
            )
    except bedrock_client.exceptions.ResourceNotFoundException:
        # ResourceNotFound means it's already gone — success
        logger.info("Deployment %s confirmed deleted (ResourceNotFound)", deployment_arn)
    except Exception as e:
        # ValidationException or other errors — consider it successful
        error_code = ""
        if hasattr(e, "response"):
            error_code = e.response.get("Error", {}).get("Code", "")
        if error_code in ("ResourceNotFoundException", "ValidationException"):
            logger.info("Deployment %s confirmed deleted (%s)", deployment_arn, error_code)
        else:
            logger.warning(
                "Could not verify deletion of deployment %s: %s. Proceeding anyway.",
                deployment_arn, e
            )

    # Step 6: Update DynamoDB: clear deploymentArn, set status to "Registered"
    now = _now_iso()
    try:
        agent_configurations_table.update_item(
            Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"},
            UpdateExpression="SET #status = :status, updatedAt = :now REMOVE deploymentArn",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "Registered",
                ":now": now,
            },
        )
    except Exception as e:
        logger.error(
            "Error updating custom model record after undeploy for user %s, modelId %s: %s",
            user_id, model_id, e
        )
        return {
            "success": False,
            "statusCode": 500,
            "message": f"Bedrock deployment deleted but failed to update record: {e}",
        }

    # Step 7: Return success
    logger.info(
        "Custom model undeployed: modelId=%s, user=%s, deploymentArn=%s",
        model_id, user_id, deployment_arn
    )
    return {
        "success": True,
        "statusCode": 200,
        "message": "Model undeployed successfully",
    }


def handle_list_custom_models(arguments: dict, event: dict) -> list:
    """List all custom models for the authenticated user.

    Queries GSI1 with gsi1pk="USER#{userId}" and gsi1sk begins_with "CUSTOMMODEL#".
    Returns a list of CustomModel response dicts.

    Requirements: 3.3, 9.1, 9.2
    """
    user_id = _get_user_id(event)

    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("gsi1pk").eq(f"USER#{user_id}")
            & Key("gsi1sk").begins_with("CUSTOMMODEL#"),
        )
    except Exception as e:
        logger.error(f"Error listing custom models for user {user_id}: {e}")
        return []

    items = response.get("Items", [])
    return [
        {
            "modelId": item.get("modelId"),
            "userId": item.get("userId"),
            "name": item.get("name"),
            "trainingJobArn": item.get("trainingJobArn"),
            "deploymentArn": item.get("deploymentArn"),
            "status": item.get("status"),
            "baseModelId": item.get("baseModelId"),
            "failureReason": item.get("failureReason"),
            "createdAt": item.get("createdAt"),
            "updatedAt": item.get("updatedAt"),
        }
        for item in items
    ]


def get_token_penalty_reduction(custom_model_count: int) -> float:
    """Return the token penalty reduction factor based on custom model count.

    Schedule:
        0 custom models → 0.0 (no reduction)
        1 custom model  → 0.50 (50% reduction)
        2 custom models → 0.70 (70% reduction)
        3 custom models → 0.85 (85% reduction)
        4 custom models → 0.92 (92% reduction)
        5+ custom models → 0.95 (95% reduction)

    This is a pure function with no side effects.

    Requirements: 6.2
    """
    schedule = {0: 0.0, 1: 0.50, 2: 0.70, 3: 0.85, 4: 0.92, 5: 0.95}
    if custom_model_count <= 0:
        return 0.0
    if custom_model_count >= 5:
        return 0.95
    return schedule.get(custom_model_count, 0.95)


def count_custom_models_in_config(user_id: str) -> int:
    """Count distinct deployed custom models referenced in agent configuration.

    Checks supervisor modelId and all sub-agent modelIds against deployed
    CUSTOMMODEL records for the user. A custom model is "in use" when an
    agent's modelId field equals the custom model's deploymentArn.

    Args:
        user_id: The authenticated user's ID.

    Returns:
        The count of distinct custom model deploymentArns being used in agent
        configs. Returns 0 on any error (safe default).

    Requirements: 6.1, 6.2
    """
    try:
        # 1. Load supervisor config
        supervisor_response = agent_configurations_table.get_item(
            Key={"userId": user_id, "sk": "SUPERVISOR"}
        )
        supervisor_item = supervisor_response.get("Item")

        # 2. Load all sub-agent configs via GSI1
        subagent_response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("gsi1pk").eq(f"USER#{user_id}")
            & Key("gsi1sk").begins_with("SUBAGENT#"),
        )
        subagent_items = subagent_response.get("Items", [])

        # 3. Collect all modelId values from supervisor and sub-agents into a set
        configured_model_ids = set()

        if supervisor_item:
            model_id = supervisor_item.get("modelId")
            if model_id:
                configured_model_ids.add(model_id)

        for subagent in subagent_items:
            model_id = subagent.get("modelId")
            if model_id:
                configured_model_ids.add(model_id)

        # If no models configured, short-circuit
        if not configured_model_ids:
            return 0

        # 4. Query CUSTOMMODEL records for the user with status="Deployed"
        custom_model_response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("gsi1pk").eq(f"USER#{user_id}")
            & Key("gsi1sk").begins_with("CUSTOMMODEL#"),
        )
        custom_model_items = custom_model_response.get("Items", [])

        # 5. Build a set of deploymentArns from deployed custom models
        deployed_arns = set()
        for item in custom_model_items:
            if item.get("status") == "Deployed" and item.get("deploymentArn"):
                deployed_arns.add(item["deploymentArn"])

        # If no deployed custom models, short-circuit
        if not deployed_arns:
            return 0

        # 6. Count distinct intersections between configured modelIds and
        #    custom model deploymentArns
        in_use = configured_model_ids & deployed_arns
        return len(in_use)

    except Exception as e:
        logger.error(
            "Error counting custom models in config for user %s: %s", user_id, e
        )
        return 0


def handle_reset_custom_models(user_id: str) -> list:
    """Delete all custom model deployments and records for a user.

    Called by handle_reset_configuration during full reset.
    Uses retry+verify pattern: 3 retries with exponential backoff for each
    Bedrock deployment deletion, then verifies deletion status.

    Steps:
        1. Query all CUSTOMMODEL# records for user via GSI1
        2. For each record with a deploymentArn:
           - Retry delete_custom_model_deployment up to 3 times (1s, 2s, 4s backoff)
           - Verify by calling get_custom_model_deployment
           - If still active after 3 retries, add to failures list
        3. Delete all DynamoDB records regardless of deployment deletion success
        4. Return list of failed model names/ARNs

    Requirements: 7.1, 7.2, 7.4
    """
    logger.info("Reset: Cleaning up custom models for user %s", user_id)
    failures = []

    # Step 1: Query all CUSTOMMODEL# records for the user
    try:
        response = agent_configurations_table.query(
            IndexName="GSI1",
            KeyConditionExpression=Key("gsi1pk").eq(f"USER#{user_id}")
            & Key("gsi1sk").begins_with("CUSTOMMODEL#"),
        )
        items = response.get("Items", [])
    except Exception as e:
        logger.error(
            "Reset: Failed to query custom models for user %s: %s", user_id, e
        )
        return []

    if not items:
        logger.info("Reset: No custom models found for user %s", user_id)
        return []

    logger.info("Reset: Found %d custom model(s) for user %s", len(items), user_id)

    # Step 2: For each record with a deploymentArn, retry delete with verification
    for item in items:
        model_id = item.get("modelId", "unknown")
        model_name = item.get("name", model_id)
        deployment_arn = item.get("deploymentArn")

        if deployment_arn:
            delete_succeeded = False
            for attempt in range(3):
                try:
                    bedrock_client.delete_custom_model_deployment(
                        customModelDeploymentIdentifier=deployment_arn
                    )
                    delete_succeeded = True
                    break
                except Exception as e:
                    logger.warning(
                        "Reset: Attempt %d to delete deployment %s for model %s failed: %s",
                        attempt + 1, deployment_arn, model_id, e
                    )
                    if attempt < 2:
                        time.sleep(2 ** attempt)  # 1s, 2s delay

            if delete_succeeded:
                # Verify deletion
                try:
                    verify_response = bedrock_client.get_custom_model_deployment(
                        customModelDeploymentIdentifier=deployment_arn
                    )
                    verify_status = verify_response.get("status", "")
                    if verify_status in ("Deleting", "DELETING"):
                        logger.info(
                            "Reset: Deployment %s is deleting (confirmed)", deployment_arn
                        )
                    else:
                        logger.warning(
                            "Reset: Deployment %s still active with status '%s' after delete",
                            deployment_arn, verify_status
                        )
                        failures.append(f"{model_name} ({deployment_arn})")
                except Exception as e:
                    # ResourceNotFoundException or ValidationException = deleted
                    error_code = ""
                    if hasattr(e, "response"):
                        error_code = e.response.get("Error", {}).get("Code", "")
                    if error_code in ("ResourceNotFoundException", "ValidationException"):
                        logger.info(
                            "Reset: Deployment %s confirmed deleted (%s)",
                            deployment_arn, error_code
                        )
                    else:
                        # Other errors — assume deleted
                        logger.info(
                            "Reset: Deployment %s likely deleted (verify error: %s)",
                            deployment_arn, e
                        )
            else:
                failures.append(f"{model_name} ({deployment_arn})")

    # Step 3: Delete all DynamoDB records regardless of deployment deletion success
    for item in items:
        model_id = item.get("modelId", "unknown")
        try:
            agent_configurations_table.delete_item(
                Key={"userId": user_id, "sk": f"CUSTOMMODEL#{model_id}"}
            )
            logger.info("Reset: Deleted custom model record %s", model_id)
        except Exception as e:
            logger.warning(
                "Reset: Failed to delete custom model record %s for user %s: %s. Continuing.",
                model_id, user_id, e
            )

    logger.info("Reset: Custom model cleanup complete for user %s", user_id)
    return failures


def handle_get_studio_presigned_url(arguments: dict, event: dict) -> dict:
    """Generate a presigned URL for SageMaker Studio that auto-authenticates.

    Gets a presigned URL for Studio home, then modifies it to redirect
    to the models/fine-tuning page after authentication.

    Returns:
        {url: str, error: str|None}
    """
    domain_id = os.environ.get("SAGEMAKER_DOMAIN_ID", "")
    user_profile_name = os.environ.get("SAGEMAKER_USER_PROFILE", "")

    if not domain_id or not user_profile_name:
        return {"url": "", "error": "SageMaker not configured"}

    try:
        sm = boto3.client("sagemaker")
        resp = sm.create_presigned_domain_url(
            DomainId=domain_id,
            UserProfileName=user_profile_name,
            ExpiresInSeconds=300,
            SessionExpirationDurationInSeconds=43200,
            LandingUri="studio::models/SageMakerPublicHub/Model/huggingface-reasoning-qwen3-06b",
        )
        return {"url": resp.get("AuthorizedUrl", ""), "error": None}
    except Exception as e:
        logger.error("Failed to generate Studio presigned URL: %s", e)
        return {"url": "", "error": str(e)}
