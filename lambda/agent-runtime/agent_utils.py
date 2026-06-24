"""Shared configuration utilities for orchestrator and sub-agents."""
import os
import json
import logging
import traceback

import boto3
from strands.models.sagemaker import SageMakerAIModel
from streamable_http_sigv4 import streamablehttp_client_with_sigv4

logger = logging.getLogger(__name__)


def _get_region_model_prefix() -> str:
    """Derive model prefix from AWS region. e.g. us-east-1 -> 'us', eu-west-1 -> 'eu'."""
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    return region.split("-")[0]


DEFAULT_MODEL_ID = f"{_get_region_model_prefix()}.amazon.nova-2-lite-v1:0"


def get_region_from_config():
    """Get region from environment or config file."""
    try:
        region = os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION')

        if not region:
            try:
                config_path = os.path.join(os.path.dirname(__file__), "agent_config.json")
                with open(config_path, 'r') as f:
                    config = json.load(f)
                region = config.get('region')
            except Exception as e:
                logger.warning(f"Could not read config file: {e}")

        if not region:
            region = "us-west-2"
            logger.warning(f"No region found, using default: {region}")

        return region
    except Exception as e:
        logger.error(f"Failed to get region: {e}")
        return "us-west-2"


def get_cross_account_boto_session(role_arn: str = None):
    """Assume cross-account role and return a boto3 Session for SageMaker invocation."""
    if not role_arn:
        logger.warning("No sagemaker_invoke_role_arn provided, using default credentials")
        return None
    try:
        logger.info(f"Assuming cross-account role: {role_arn}")
        sts = boto3.client('sts')
        creds = sts.assume_role(RoleArn=role_arn, RoleSessionName='AgentCoreSageMaker')['Credentials']
        logger.info(f"Successfully assumed role: {role_arn}")
        return boto3.Session(
            aws_access_key_id=creds['AccessKeyId'],
            aws_secret_access_key=creds['SecretAccessKey'],
            aws_session_token=creds['SessionToken'],
            region_name=get_region_from_config(),
        )
    except Exception as e:
        logger.error(f"Failed to assume role {role_arn}: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None


def create_streamable_http_transport(gateway_url):
    """Create HTTP transport for IAM auth."""
    session = boto3.Session()
    credentials = session.get_credentials()

    return streamablehttp_client_with_sigv4(
        url=gateway_url,
        credentials=credentials,
        service="bedrock-agentcore",
        region=get_region_from_config(),
    )


def create_sagemaker_model(model_id: str, role_arn: str = None, stream: bool = False):
    """Create a SageMakerAIModel from a sagemaker:<endpoint>[/<component>] model ID.

    Args:
        model_id: Full model ID including sagemaker: prefix.
        role_arn: IAM role ARN for cross-account SageMaker access.
        stream: Whether to enable streaming responses.

    Returns:
        A configured SageMakerAIModel instance.
    """
    sagemaker_config = model_id.replace("sagemaker:", "")
    if "/" in sagemaker_config:
        endpoint_name, inference_component_name = sagemaker_config.split("/", 1)
    else:
        endpoint_name = sagemaker_config
        inference_component_name = None

    endpoint_config = {
        "endpoint_name": endpoint_name,
        "region_name": get_region_from_config(),
    }
    if inference_component_name:
        endpoint_config["inference_component_name"] = inference_component_name

    logger.info(f"Creating SageMakerAIModel: endpoint={endpoint_name}, component={inference_component_name}")
    try:
        session = get_cross_account_boto_session(role_arn)
        logger.info(f"boto_session for SageMaker: {'cross-account' if session else 'DEFAULT (no role assumption)'}")
        model = SageMakerAIModel(
            endpoint_config=endpoint_config,
            payload_config={"max_tokens": 8192, "temperature": 0.0, "stream": stream},
            boto_session=session,
        )
        logger.info("SageMakerAIModel created successfully")
        return model
    except Exception as e:
        logger.error(f"SageMakerAIModel creation failed: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise
