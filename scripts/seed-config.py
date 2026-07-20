#!/usr/bin/env python3
"""
Agent Configuration Seed Script (Nuke and Pave)

Deploys the agent-config/ YAML configuration to a live environment by:
1. Validating config.yaml locally
2. Uploading tool source code to S3
3. Deleting existing agent config resources for the target user
4. Re-creating everything from the YAML

Usage:
  python3 scripts/seed-config.py                          # Uses default admin user
  python3 scripts/seed-config.py --user-id <cognito-sub>  # Target specific user
  python3 scripts/seed-config.py --profile my-profile     # Use specific AWS profile
  python3 scripts/seed-config.py --region us-west-2       # Use specific region

Requires: boto3, pyyaml
"""

import argparse
import io
import json
import os
import sys
import zipfile

import boto3
import yaml

# Add the Lambda source to path for validator/seeder imports
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, os.path.join(REPO_ROOT, "lambda", "agentic-api"))

from config_validator import validate_config, ConfigValidationError

STACK_NAME = "AiLeagueCommunityEditionStack"
AGENT_CONFIG_DIR = os.path.join(REPO_ROOT, "agent-config")
CONFIG_YAML_PATH = os.path.join(AGENT_CONFIG_DIR, "config.yaml")


def get_args():
    parser = argparse.ArgumentParser(description="Seed agent configuration (nuke and pave)")
    parser.add_argument("--user-id", help="Cognito user sub to target (default: looks up admin user)")
    parser.add_argument("--profile", help="AWS CLI profile name", default=None)
    parser.add_argument("--region", help="AWS region", default=None)
    parser.add_argument("--stack-name", help="CloudFormation stack name", default=STACK_NAME)
    parser.add_argument("--dry-run", action="store_true", help="Validate only, don't make changes")
    return parser.parse_args()


def get_session(profile, region):
    kwargs = {}
    if profile:
        kwargs["profile_name"] = profile
    if region:
        kwargs["region_name"] = region
    return boto3.Session(**kwargs)


def get_stack_outputs(session, stack_name):
    """Get relevant resource names from CloudFormation stack outputs/resources."""
    cf = session.client("cloudformation")

    # Get table names and bucket from stack resources
    resources = {}
    paginator = cf.get_paginator("list_stack_resources")
    for page in paginator.paginate(StackName=stack_name):
        for r in page["StackResourceSummaries"]:
            resources[r["LogicalResourceId"]] = {
                "type": r["ResourceType"],
                "physical_id": r.get("PhysicalResourceId", ""),
            }

    # Find key resources
    result = {}

    # Agent configurations table
    for key, val in resources.items():
        if val["type"] == "AWS::DynamoDB::Table" and "AgentConfigurations" in key:
            result["table_name"] = val["physical_id"]
        if val["type"] == "AWS::S3::Bucket" and "TrainingArtifacts" in key:
            result["bucket_name"] = val["physical_id"]
        if val["type"] == "AWS::Cognito::UserPool" and "UserPool" in key and "Client" not in key:
            result["user_pool_id"] = val["physical_id"]

    # Lambda tool role ARN — find from the agentic Lambda's env
    for key, val in resources.items():
        if val["type"] == "AWS::IAM::Role" and "LambdaToolRole" in key:
            result["lambda_tool_role_arn"] = f"arn:aws:iam::{session.client('sts').get_caller_identity()['Account']}:role/{val['physical_id']}"

    return result


def get_admin_user_sub(session, user_pool_id):
    """Look up the Cognito sub for the admin user."""
    cognito = session.client("cognito-idp")
    try:
        resp = cognito.admin_get_user(
            UserPoolId=user_pool_id,
            Username="admin@aileague.community",
        )
        for attr in resp["UserAttributes"]:
            if attr["Name"] == "sub":
                return attr["Value"]
        raise RuntimeError("Admin user has no 'sub' attribute")
    except Exception as e:
        raise RuntimeError(f"Failed to look up admin user: {e}")


def load_and_validate_config():
    """Load and validate config.yaml."""
    if not os.path.exists(CONFIG_YAML_PATH):
        print(f"ERROR: {CONFIG_YAML_PATH} not found")
        sys.exit(1)

    with open(CONFIG_YAML_PATH) as f:
        config = yaml.safe_load(f)

    try:
        warnings = validate_config(config)
        if warnings:
            for w in warnings:
                print(f"  WARNING: {w}")
    except ConfigValidationError as e:
        print(f"ERROR: Config validation failed:")
        for err in e.errors:
            print(f"  - {err}")
        sys.exit(1)

    return config


def nuke_user_config(session, table_name, user_id, config):
    """Delete all existing agent config resources for the user."""
    dynamodb = session.resource("dynamodb")
    table = dynamodb.Table(table_name)
    lambda_client = session.client("lambda")
    bedrock_client = session.client("bedrock")

    print(f"  Deleting existing config for user {user_id}...")

    # Query all items for this user
    response = table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    items = response.get("Items", [])
    while response.get("LastEvaluatedKey"):
        response = table.query(
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        items.extend(response.get("Items", []))

    # Categorize and delete
    deleted_counts = {"lambda": 0, "subagent": 0, "memory": 0, "guardrail": 0, "supervisor": 0, "version": 0}

    for item in items:
        sk = item.get("sk", "")

        # Delete Lambda functions (actual AWS resource)
        if sk.startswith("LAMBDA#"):
            fn_name = item.get("functionName", "")
            if fn_name:
                try:
                    lambda_client.delete_function(FunctionName=fn_name)
                    print(f"    Deleted Lambda: {fn_name}")
                except lambda_client.exceptions.ResourceNotFoundException:
                    pass
                except Exception as e:
                    print(f"    WARNING: Failed to delete Lambda {fn_name}: {e}")
            deleted_counts["lambda"] += 1

        # Delete Bedrock Guardrails (actual AWS resource)
        # Skip if the new config still defines a guardrail with the same name
        elif sk.startswith("GUARDRAIL#"):
            guardrail_name = item.get("name", "")
            new_guardrail = config.get("guardrail")
            if new_guardrail and isinstance(new_guardrail, dict) and new_guardrail.get("name") == guardrail_name:
                print(f"    Keeping Guardrail: {guardrail_name} (same name in new config)")
                continue  # Don't delete DynamoDB record or AWS resource
            guardrail_id = item.get("guardrailId", "")
            if guardrail_id:
                try:
                    bedrock_client.delete_guardrail(guardrailIdentifier=guardrail_id)
                    print(f"    Deleted Guardrail: {guardrail_id}")
                except Exception as e:
                    print(f"    WARNING: Failed to delete Guardrail {guardrail_id}: {e}")
            deleted_counts["guardrail"] += 1

        # Skip deleting Memory if the new config still defines one with the same name
        # (avoids "already exists" error on re-create since AgentCore doesn't allow duplicate names)
        elif sk.startswith("MEMORY#"):
            memory_name = item.get("name", "")
            new_memory = config.get("memory")
            if new_memory and isinstance(new_memory, dict) and new_memory.get("name") == memory_name:
                print(f"    Keeping Memory: {memory_name} (same name in new config)")
                continue  # Don't delete DynamoDB record or AWS resource
            deleted_counts["memory"] += 1

        elif sk.startswith("SUBAGENT#"):
            deleted_counts["subagent"] += 1
        elif sk == "SUPERVISOR":
            deleted_counts["supervisor"] += 1
        elif sk.startswith("VERSION#"):
            deleted_counts["version"] += 1
        else:
            # Skip non-config items (RUNTIME, MODEL#, etc.)
            continue

        # Delete DynamoDB record
        table.delete_item(Key={"userId": user_id, "sk": sk})

    print(f"    Deleted: {deleted_counts}")


def upload_config_to_s3(session, bucket_name, config):
    """Upload config.yaml and tool source code to S3."""
    s3 = session.client("s3")
    prefix = "agent-config/"

    # Upload config.yaml
    with open(CONFIG_YAML_PATH) as f:
        s3.put_object(Bucket=bucket_name, Key=f"{prefix}config.yaml", Body=f.read())
    print(f"    Uploaded config.yaml to s3://{bucket_name}/{prefix}config.yaml")

    # Upload tool source code
    tools = config.get("tools") or []
    for tool in tools:
        source_dir = tool.get("sourceDir")
        if not source_dir:
            continue
        local_dir = os.path.join(AGENT_CONFIG_DIR, source_dir)
        if not os.path.isdir(local_dir):
            print(f"    WARNING: sourceDir '{source_dir}' not found locally, skipping")
            continue
        for root, dirs, files in os.walk(local_dir):
            for fname in files:
                local_path = os.path.join(root, fname)
                relative = os.path.relpath(local_path, AGENT_CONFIG_DIR)
                s3_key = f"{prefix}{relative}"
                with open(local_path, "rb") as f:
                    s3.put_object(Bucket=bucket_name, Key=s3_key, Body=f.read())
                print(f"    Uploaded {relative}")


def seed_config(session, table_name, bucket_name, lambda_tool_role_arn, user_id, config):
    """Create all resources from the YAML config."""
    # We reuse the config_seeder module but need to set env vars it expects
    os.environ["AGENT_CONFIG_BUCKET"] = bucket_name
    os.environ["AGENT_CONFIG_PREFIX"] = "agent-config/"
    os.environ["AGENT_CONFIGURATIONS_TABLE"] = table_name
    os.environ["LAMBDA_TOOL_ROLE_ARN"] = lambda_tool_role_arn
    os.environ["AWS_DEFAULT_REGION"] = session.region_name

    # Import after setting env vars
    import config_seeder
    # Clear cache so it re-reads from S3
    config_seeder._cached_config = None
    config_seeder._cached_config_etag = None

    result = config_seeder.seed_user_config(user_id)

    if result["success"]:
        print(f"    Seeded successfully: {result['message']}")
        if result["failures"]:
            for f in result["failures"]:
                print(f"    PARTIAL FAILURE: {f}")
    else:
        print(f"    ERROR: Seeding failed: {result['message']}")
        if result["failures"]:
            for f in result["failures"]:
                print(f"    - {f}")
        sys.exit(1)


def generate_gateway_schemas(session, config):
    """Invoke the agentic-api Lambda to generate MCP Gateway targets for each tool."""
    lambda_client = session.client("lambda")
    tools = config.get("tools") or []

    for tool in tools:
        tool_name = tool["name"]
        payload = {
            "info": {"fieldName": "RegenerateToolSchema"},
            "identity": {"claims": {"cognito:username": "system"}},
            "arguments": {"name": tool_name},
        }
        try:
            resp = lambda_client.invoke(
                FunctionName="ai-league-agentic-api",
                InvocationType="Event",  # async — don't wait for completion
                Payload=json.dumps(payload),
            )
            status = resp.get("StatusCode", 0)
            print(f"    Triggered schema generation for AgentCoreGatewayTool-{tool_name} (status: {status})")
        except Exception as e:
            print(f"    WARNING: Failed to trigger schema for {tool_name}: {e}")

    if tools:
        print(f"  Schema generation triggered for {len(tools)} tool(s). May take 10-20s to complete.")


def main():
    args = get_args()

    print("=== Agent Configuration Seed (Nuke and Pave) ===\n")

    # Step 1: Load and validate config
    print("[1/6] Validating config.yaml...")
    config = load_and_validate_config()
    print("  Config is valid.\n")

    if args.dry_run:
        print("DRY RUN: Config validated successfully. No changes made.")
        return

    # Step 2: Set up AWS session and get stack info
    print("[2/6] Reading stack resources...")
    session = get_session(args.profile, args.region)
    stack_info = get_stack_outputs(session, args.stack_name)

    required_keys = ["table_name", "bucket_name", "user_pool_id", "lambda_tool_role_arn"]
    for key in required_keys:
        if key not in stack_info:
            print(f"  ERROR: Could not find {key} in stack '{args.stack_name}'")
            sys.exit(1)

    print(f"  Table: {stack_info['table_name']}")
    print(f"  Bucket: {stack_info['bucket_name']}")
    print(f"  User Pool: {stack_info['user_pool_id']}\n")

    # Step 3: Resolve target user
    if args.user_id:
        user_id = args.user_id
        print(f"[3/6] Using provided user ID: {user_id}\n")
    else:
        print("[3/6] Looking up admin user...")
        user_id = get_admin_user_sub(session, stack_info["user_pool_id"])
        print(f"  Admin user sub: {user_id}\n")

    # Step 4: Nuke existing config
    print("[4/6] Deleting existing configuration...")
    nuke_user_config(session, stack_info["table_name"], user_id, config)
    print()

    # Step 5: Upload to S3 and re-seed
    print("[5/6] Uploading config and seeding...")
    upload_config_to_s3(session, stack_info["bucket_name"], config)
    seed_config(
        session,
        stack_info["table_name"],
        stack_info["bucket_name"],
        stack_info["lambda_tool_role_arn"],
        user_id,
        config,
    )
    print()

    # Step 6: Generate MCP Gateway schemas for each tool
    print("[6/6] Generating MCP Gateway schemas...")
    generate_gateway_schemas(session, config)
    print("\n=== Done! Refresh the Agent Builder page to see the new config. ===")


if __name__ == "__main__":
    main()
