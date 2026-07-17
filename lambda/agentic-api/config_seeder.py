"""Agent Configuration Seeder.

Reads seed configuration from S3, validates it, and provisions all resources
(Lambda tools, sub-agents, memory, guardrails, supervisor) for a new user.

Replaces hardcoded defaults when agent-config/config.yaml is deployed.

Requirements: 2.1-2.6, 3.1-3.3, 4.1-4.5, 5.1-5.3, 6.1-6.5, 7.5
"""

import hashlib
import io
import json
import logging
import os
import zipfile
from datetime import datetime, timezone
from typing import Any, Optional

import boto3
import yaml
from boto3.dynamodb.conditions import Key

from config_validator import ConfigValidationError, validate_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Cache parsed config in Lambda memory across invocations
_cached_config: Optional[dict] = None
_cached_config_etag: Optional[str] = None


def _get_region_model_prefix() -> str:
    """Derive model prefix from AWS region."""
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    return region.split("-")[0]


def _default_model_id() -> str:
    return f"{_get_region_model_prefix()}.amazon.nova-2-lite-v1:0"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _deterministic_id(user_id: str, prefix: str, name: str) -> str:
    """Generate a short, stable ID from user_id + name for idempotent seeding."""
    raw = f"{user_id}:{name}"
    digest = hashlib.sha256(raw.encode()).hexdigest()[:12]
    return f"seed-{prefix}-{digest}"


def load_seed_config() -> Optional[dict]:
    """Download and parse config.yaml from S3.

    Returns None if config is unavailable (env vars missing, S3 error, parse error).
    Caches in Lambda memory for reuse across invocations.
    """
    global _cached_config, _cached_config_etag

    bucket = os.environ.get("AGENT_CONFIG_BUCKET", "")
    prefix = os.environ.get("AGENT_CONFIG_PREFIX", "agent-config/")

    if not bucket:
        logger.debug("AGENT_CONFIG_BUCKET not set — no seed config available")
        return None

    s3 = boto3.client("s3")
    config_key = f"{prefix}config.yaml"

    try:
        # Check ETag for cache invalidation
        head_resp = s3.head_object(Bucket=bucket, Key=config_key)
        etag = head_resp.get("ETag", "")

        if _cached_config is not None and _cached_config_etag == etag:
            return _cached_config

        # Download config
        resp = s3.get_object(Bucket=bucket, Key=config_key)
        content = resp["Body"].read().decode("utf-8")

        config = yaml.safe_load(content)
        if not isinstance(config, dict):
            logger.error("config.yaml did not parse to a dict")
            return None

        _cached_config = config
        _cached_config_etag = etag
        return config

    except s3.exceptions.NoSuchKey:
        logger.info("config.yaml not found in S3 at s3://%s/%s", bucket, config_key)
        return None
    except Exception as e:
        logger.error("Failed to load seed config from S3: %s", e)
        return None


def seed_user_config(user_id: str) -> dict:
    """Seed full agent configuration for a new user from config.yaml.

    Orchestrates:
    1. Load and validate config
    2. Create Lambda tools
    3. Create Memory tool (if defined)
    4. Create Guardrail (if defined)
    5. Create Sub-agents in DynamoDB
    6. Create Supervisor in DynamoDB
    7. Create initial VERSION snapshot

    Returns:
        dict with keys: success (bool), message (str), warnings (list),
        failures (list of non-critical failures)
    """
    config = load_seed_config()
    if config is None:
        return {"success": False, "message": "No seed config available", "warnings": [], "failures": []}

    # Validate
    try:
        warnings = validate_config(config)
    except ConfigValidationError as e:
        logger.error("Seed config validation failed: %s", e.errors)
        return {"success": False, "message": f"Validation failed: {e.errors}", "warnings": [], "failures": e.errors}

    failures: list[str] = []
    now = _now_iso()
    default_model = _default_model_id()

    # Get table and role references
    table_name = os.environ.get("AGENT_CONFIGURATIONS_TABLE", "")
    lambda_tool_role_arn = os.environ.get("LAMBDA_TOOL_ROLE_ARN", "")

    if not table_name:
        return {"success": False, "message": "AGENT_CONFIGURATIONS_TABLE not set", "warnings": warnings, "failures": []}

    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(table_name)

    # --- Phase 1: Create Lambda tools ---
    tools_config = config.get("tools") or []
    tool_id_map: dict[str, str] = {}  # name -> toolId

    for tool_def in tools_config:
        tool_name = tool_def["name"]
        tool_id = _deterministic_id(user_id, "tool", tool_name)
        tool_id_map[tool_name] = tool_id
        function_name = f"AgentCoreGatewayTool-{tool_name}"

        # Create/update the Lambda function
        try:
            _create_or_update_lambda(tool_def, function_name, lambda_tool_role_arn)
        except Exception as e:
            msg = f"Failed to create Lambda '{function_name}': {e}"
            logger.error(msg)
            failures.append(msg)
            continue  # Skip DynamoDB write for this tool

        # Write DynamoDB record
        try:
            table.put_item(
                Item={
                    "userId": user_id,
                    "sk": f"LAMBDA#{tool_id}",
                    "toolId": tool_id,
                    "name": tool_name,
                    "functionName": function_name,
                    "runtime": "python3.12",
                    "gsi1pk": f"USER#{user_id}",
                    "gsi1sk": f"LAMBDA#{now}",
                    "createdAt": now,
                    "updatedAt": now,
                },
                ConditionExpression="attribute_not_exists(sk)",
            )
        except Exception as e:
            error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
            if error_code == "ConditionalCheckFailedException":
                logger.info("Tool record already exists for %s — skipping", tool_name)
            else:
                msg = f"Failed to write DynamoDB for tool '{tool_name}': {e}"
                logger.error(msg)
                failures.append(msg)

    # --- Phase 2: Create Memory tool ---
    memory_config = config.get("memory")
    memory_tool_id: Optional[str] = None

    if memory_config and isinstance(memory_config, dict):
        memory_name = memory_config["name"]
        memory_tool_id = _deterministic_id(user_id, "memory", memory_name)

        try:
            memory_id = _create_memory(memory_config)
            table.put_item(
                Item={
                    "userId": user_id,
                    "sk": f"MEMORY#{memory_tool_id}",
                    "toolId": memory_tool_id,
                    "name": memory_name,
                    "memoryId": memory_id or "",
                    "description": memory_config.get("description", ""),
                    "status": "ACTIVE",
                    "gsi1pk": f"USER#{user_id}",
                    "gsi1sk": f"MEMORY#{now}",
                    "createdAt": now,
                    "updatedAt": now,
                },
                ConditionExpression="attribute_not_exists(sk)",
            )
        except Exception as e:
            error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
            if error_code == "ConditionalCheckFailedException":
                logger.info("Memory record already exists — skipping")
            else:
                msg = f"Failed to create memory tool: {e}"
                logger.error(msg)
                failures.append(msg)
                memory_tool_id = None

    # --- Phase 3: Create Guardrail ---
    guardrail_config = config.get("guardrail")
    guardrail_tool_id: Optional[str] = None

    if guardrail_config and isinstance(guardrail_config, dict):
        guardrail_name = guardrail_config["name"]
        guardrail_tool_id = _deterministic_id(user_id, "guardrail", guardrail_name)

        try:
            guardrail_id, full_sdk_response = _create_guardrail(guardrail_config)
            table.put_item(
                Item={
                    "userId": user_id,
                    "sk": f"GUARDRAIL#{guardrail_tool_id}",
                    "toolId": guardrail_tool_id,
                    "name": guardrail_name,
                    "guardrailId": guardrail_id or "",
                    "description": guardrail_config.get("description", ""),
                    "status": "READY",
                    "fullSDKResponse": full_sdk_response,
                    "gsi1pk": f"USER#{user_id}",
                    "gsi1sk": f"GUARDRAIL#{now}",
                    "createdAt": now,
                    "updatedAt": now,
                },
                ConditionExpression="attribute_not_exists(sk)",
            )
        except Exception as e:
            error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
            if error_code == "ConditionalCheckFailedException":
                logger.info("Guardrail record already exists — skipping")
            else:
                msg = f"Failed to create guardrail: {e}"
                logger.error(msg)
                failures.append(msg)
                guardrail_tool_id = None

    # --- Phase 4: Create Sub-agents ---
    sub_agents_config = config.get("subAgents") or []
    subagent_id_map: dict[str, str] = {}  # name -> agentId

    for agent_def in sub_agents_config:
        agent_name = agent_def["name"]
        agent_id = _deterministic_id(user_id, "agent", agent_name)
        subagent_id_map[agent_name] = agent_id

        # Resolve tool references to IDs
        agent_tool_ids = []
        for tool_ref in agent_def.get("tools") or []:
            if tool_ref in tool_id_map:
                agent_tool_ids.append(tool_id_map[tool_ref])
            else:
                logger.warning("Sub-agent '%s' references unknown tool '%s'", agent_name, tool_ref)

        try:
            table.put_item(
                Item={
                    "userId": user_id,
                    "sk": f"SUBAGENT#{agent_id}",
                    "agentId": agent_id,
                    "name": agent_name,
                    "systemPrompt": agent_def.get("systemPrompt", ""),
                    "modelId": agent_def.get("modelId", default_model),
                    "lambdaTools": agent_tool_ids,
                    "gsi1pk": f"USER#{user_id}",
                    "gsi1sk": f"SUBAGENT#{now}",
                    "createdAt": now,
                    "updatedAt": now,
                },
                ConditionExpression="attribute_not_exists(sk)",
            )
        except Exception as e:
            error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
            if error_code == "ConditionalCheckFailedException":
                logger.info("Sub-agent record already exists for '%s' — skipping", agent_name)
            else:
                msg = f"Failed to write sub-agent '{agent_name}': {e}"
                logger.error(msg)
                failures.append(msg)

    # --- Phase 5: Create Supervisor ---
    supervisor_config = config["supervisor"]

    # Resolve supervisor references
    supervisor_subagent_ids = []
    for ref in supervisor_config.get("subAgents") or []:
        if ref in subagent_id_map:
            supervisor_subagent_ids.append(subagent_id_map[ref])
        else:
            logger.warning("Supervisor references unknown sub-agent '%s'", ref)

    supervisor_tool_ids = []
    for ref in supervisor_config.get("tools") or []:
        if ref in tool_id_map:
            supervisor_tool_ids.append(tool_id_map[ref])
        else:
            logger.warning("Supervisor references unknown tool '%s'", ref)

    # Resolve memory reference
    resolved_memory = None
    memory_ref = supervisor_config.get("memory")
    if memory_ref and memory_tool_id:
        resolved_memory = memory_tool_id

    # Resolve guardrail reference
    resolved_guardrail = None
    guardrail_ref = supervisor_config.get("guardrail")
    if guardrail_ref and guardrail_tool_id:
        resolved_guardrail = guardrail_tool_id

    try:
        table.put_item(
            Item={
                "userId": user_id,
                "sk": "SUPERVISOR",
                "name": supervisor_config["name"],
                "systemPrompt": supervisor_config["systemPrompt"],
                "modelId": supervisor_config.get("modelId", default_model),
                "subAgents": supervisor_subagent_ids,
                "lambdaTools": supervisor_tool_ids,
                "memoryTool": resolved_memory,
                "guardrailTool": resolved_guardrail,
                "createdAt": now,
                "updatedAt": now,
            },
            ConditionExpression="attribute_not_exists(sk)",
        )
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code == "ConditionalCheckFailedException":
            logger.info("Supervisor record already exists — skipping")
        else:
            msg = f"Failed to write supervisor config: {e}"
            logger.error(msg)
            # This is critical
            return {"success": False, "message": msg, "warnings": warnings, "failures": failures}

    # --- Phase 6: Create initial VERSION snapshot ---
    try:
        initial_config = {
            "name": supervisor_config["name"],
            "systemPrompt": supervisor_config["systemPrompt"],
            "modelId": supervisor_config.get("modelId", default_model),
            "subAgents": supervisor_subagent_ids,
            "lambdaTools": supervisor_tool_ids,
            "memoryTool": resolved_memory,
            "guardrailTool": resolved_guardrail,
        }
        # Use a stable version ID for the initial seed
        first_subagent_id = supervisor_subagent_ids[0] if supervisor_subagent_ids else "none"
        version_sk = f"VERSION#default#{first_subagent_id}"

        table.put_item(
            Item={
                "userId": user_id,
                "sk": version_sk,
                "versionId": "initial",
                "name": "Initial Configuration",
                "supervisorConfig": json.dumps(initial_config),
                "finalScore": 0,
                "subAgentCount": len(supervisor_subagent_ids),
                "gsi1pk": f"USER#{user_id}",
                "gsi1sk": f"VERSION#{now}",
                "createdAt": now,
                "updatedAt": now,
            },
            ConditionExpression="attribute_not_exists(sk)",
        )
    except Exception as e:
        error_code = getattr(e, "response", {}).get("Error", {}).get("Code", "")
        if error_code != "ConditionalCheckFailedException":
            logger.warning("Failed to create initial VERSION snapshot: %s", e)

    return {
        "success": True,
        "message": "Configuration seeded successfully" + (f" with {len(failures)} warning(s)" if failures else ""),
        "warnings": warnings,
        "failures": failures,
    }


def _create_or_update_lambda(tool_def: dict, function_name: str, role_arn: str) -> None:
    """Create or update a Lambda function with source code from S3 or default template."""
    lambda_client = boto3.client("lambda")
    zip_bytes = _get_tool_zip(tool_def)

    try:
        # Try to get existing function
        lambda_client.get_function(FunctionName=function_name)
        # Exists — update code
        lambda_client.update_function_code(
            FunctionName=function_name,
            ZipFile=zip_bytes,
        )
        logger.info("Updated Lambda function: %s", function_name)
    except lambda_client.exceptions.ResourceNotFoundException:
        # Doesn't exist — create
        if not role_arn:
            raise RuntimeError(f"LAMBDA_TOOL_ROLE_ARN not set, cannot create {function_name}")
        lambda_client.create_function(
            FunctionName=function_name,
            Runtime="python3.12",
            Role=role_arn,
            Handler="index.lambda_handler",
            Code={"ZipFile": zip_bytes},
            Timeout=300,
            MemorySize=128,
        )
        logger.info("Created Lambda function: %s", function_name)


def _get_tool_zip(tool_def: dict) -> bytes:
    """Get zip bytes for a tool — from S3 source dir or default hello-world."""
    source_dir = tool_def.get("sourceDir")
    if source_dir:
        return _download_and_zip_source(source_dir)

    # Default hello-world template
    hello_code = '''import json

def lambda_handler(event, context):
    """Hello World Lambda Tool — replace with your implementation."""
    if 'body' in event:
        body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
    else:
        body = event
    message = body.get('message', 'Hello from AI League!')
    return {'statusCode': 200, 'body': json.dumps({'response': message, 'status': 'ok'})}
'''
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.py", hello_code)
    return buf.getvalue()


def _download_and_zip_source(source_dir: str) -> bytes:
    """Download tool source code from S3 and zip it."""
    bucket = os.environ.get("AGENT_CONFIG_BUCKET", "")
    prefix = os.environ.get("AGENT_CONFIG_PREFIX", "agent-config/")

    if not bucket:
        raise RuntimeError("AGENT_CONFIG_BUCKET not set")

    s3 = boto3.client("s3")
    # List all files under the source dir
    full_prefix = f"{prefix}{source_dir}/"
    resp = s3.list_objects_v2(Bucket=bucket, Prefix=full_prefix)

    contents = resp.get("Contents", [])
    if not contents:
        raise RuntimeError(f"No files found in S3 at s3://{bucket}/{full_prefix}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for obj in contents:
            key = obj["Key"]
            # Get relative path within the source dir
            relative_path = key[len(full_prefix):]
            if not relative_path or relative_path.endswith("/"):
                continue  # skip directory markers
            file_resp = s3.get_object(Bucket=bucket, Key=key)
            file_content = file_resp["Body"].read()
            zf.writestr(relative_path, file_content)

    return buf.getvalue()


def _create_memory(memory_config: dict) -> Optional[str]:
    """Create an AgentCore Memory instance. Returns memory_id or None."""
    try:
        client = boto3.client("bedrock-agentcore-control")
        resp = client.create_memory(
            name=memory_config["name"],
            description=memory_config.get("description", "Agent memory"),
            eventExpiryDuration=365,
        )
        return resp.get("memoryId", "")
    except Exception as e:
        logger.error("Failed to create AgentCore Memory: %s", e)
        raise


def _create_guardrail(guardrail_config: dict) -> tuple[Optional[str], Optional[str]]:
    """Create a Bedrock Guardrail. Returns (guardrail_id, full_sdk_response_json)."""
    try:
        client = boto3.client("bedrock")

        create_kwargs: dict[str, Any] = {
            "name": guardrail_config["name"],
            "description": guardrail_config.get("description", "Agent guardrail"),
            "blockedInputMessaging": guardrail_config.get(
                "blockedInputMessaging", "This input has been blocked."
            ),
            "blockedOutputsMessaging": guardrail_config.get(
                "blockedOutputsMessaging", "This output has been blocked."
            ),
        }

        # Content filters
        content_filters = guardrail_config.get("contentFilters")
        if content_filters:
            create_kwargs["contentPolicyConfig"] = {"filtersConfig": content_filters}

        # Deny topics
        deny_topics = guardrail_config.get("denyTopics")
        if deny_topics:
            create_kwargs["topicPolicyConfig"] = {"topicsConfig": deny_topics}

        resp = client.create_guardrail(**create_kwargs)
        guardrail_id = resp.get("guardrailId", "")

        # Fetch full config for UI editing
        full_sdk_response = None
        if guardrail_id:
            try:
                get_resp = client.get_guardrail(guardrailIdentifier=guardrail_id)
                full_sdk_response = json.dumps({
                    "blockedInputMessaging": get_resp.get("blockedInputMessaging", ""),
                    "blockedOutputsMessaging": get_resp.get("blockedOutputsMessaging", ""),
                    "contentPolicy": get_resp.get("contentPolicy", {}),
                    "topicPolicy": get_resp.get("topicPolicy", {}),
                })
            except Exception as get_err:
                logger.warning("Failed to get guardrail config after creation: %s", get_err)

        return guardrail_id, full_sdk_response

    except Exception as e:
        logger.error("Failed to create Bedrock Guardrail: %s", e)
        raise
