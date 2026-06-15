#!/usr/bin/env python3
"""
Consolidated Sub Agent - Unified agent handler for all sub-agents
Part of the orchestrator-based architecture
"""
import os
import json
import logging
from typing import Dict, Any, List
from strands import Agent, tool
from strands.models import BedrockModel
from agent_utils import create_streamable_http_transport, create_sagemaker_model
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp.mcp_client import MCPClient

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sub-agent")


def get_system_prompt(agent_id: str):
    """Get system prompt from config file by agent ID"""
    try:
        config_path = os.path.join(os.path.dirname(__file__), "agent_config.json")
        with open(config_path, 'r') as f:
            config = json.load(f)
        config_key = f'sub_agent_{agent_id}_system_prompt'
        return config.get(config_key, 'You are a specialized sub-agent.')
    except Exception as e:
        logger.warning(f"Could not read config file: {e}")
        return 'You are a specialized sub-agent.'



def create_sub_agent(agent_id: str, gateway_url: str, model_id: str = None, system_prompt: str = None, allowed_targets: List[str] = None, sagemaker_invoke_role_arn: str = None):
    """Create specialized sub-agent with gateway tools by ID"""
    try:
        # Create MCP client for AgentCore Gateway
        client = MCPClient(lambda: create_streamable_http_transport(gateway_url))

        # Keep client alive and get tools
        client.__enter__()
        all_gateway_tools = client.list_tools_sync()

        # Filter tools by allowed targets
        if allowed_targets:
            gateway_tools = []
            for tool in all_gateway_tools:
                tool_name = tool.mcp_tool.name
                # Check if tool name starts with any allowed target
                if any(tool_name.startswith(target) for target in allowed_targets):
                    gateway_tools.append(tool)
            logger.info(f"Sub-agent {agent_id} filtered to {len(gateway_tools)} tools from targets {allowed_targets}:")
        else:
            # No allowed targets means no lambda tools
            gateway_tools = []
            logger.info(f"Sub-agent {agent_id} has no allowed targets - using 0 tools:")

        for i, tool in enumerate(gateway_tools):
            logger.info(f"  Tool {i+1}: {tool.__dict__}")

        # Use provided model_id or default
        agent_model_id = model_id or "us.amazon.nova-2-lite-v1:0"

        # Use provided system prompt or get from config
        agent_system_prompt = system_prompt or get_system_prompt(agent_id)
        logger.info(f"Sub-agent {agent_id} system prompt: {agent_system_prompt}")

        # Check if model_id is a SageMaker endpoint (starts with "sagemaker:")
        if agent_model_id.startswith("sagemaker:"):
            model = create_sagemaker_model(
                agent_model_id, role_arn=sagemaker_invoke_role_arn,
            )
        else:
            logger.info(f"Sub-agent {agent_id} using Bedrock model: {agent_model_id}")
            model = BedrockModel(
                model_id=agent_model_id,
                temperature=0.0,
                streaming=False
            )

        # Create specialist agent
        agent = Agent(
            name=f"Sub Agent {agent_id}",
            model=model,
            tools=gateway_tools,
            system_prompt=agent_system_prompt,
            trace_attributes={
                "agent.type": f"sub_agent_{agent_id}",
                "agent.specialization": "template_agent",
                "system.version": "v1.0"
            }
        )

        # Store client reference to keep it alive
        agent._mcp_client = client
        return agent

    except Exception as e:
        logger.error(f"Error creating sub-agent {agent_id}: {e}")
        return None


def call_sub_agent(agent_id: str, prompt: str, gateway_url: str = None, model_id: str = None, system_prompt: str = None, allowed_targets: List[str] = None, usage_collector=None, sagemaker_invoke_role_arn: str = None) -> str:
    """Call sub-agent by ID."""
    try:
        if not gateway_url:
            try:
                config_path = os.path.join(os.path.dirname(__file__), "agent_config.json")
                with open(config_path, 'r') as f:
                    config = json.load(f)
                gateway_url = config.get("gateway_url")
            except Exception as e:
                logger.warning(f"Could not read config file: {e}")

        if not gateway_url:
            return "Error: Gateway URL not configured"

        # Create sub-agent
        agent = create_sub_agent(agent_id, gateway_url, model_id, system_prompt, allowed_targets, sagemaker_invoke_role_arn)
        if not agent:
            return f"Error: Could not create sub-agent {agent_id}"

        logger.info(f"Processing request with sub-agent {agent_id}")
        response = agent(prompt)

        result = str(response)
        logger.info(f"Sub-agent {agent_id} completed: {result[:100]}...")

        logger.info(f"Sub-agent {agent_id} usage - Total: {response.metrics.accumulated_usage['totalTokens']}, Input: {response.metrics.accumulated_usage['inputTokens']}, Output: {response.metrics.accumulated_usage['outputTokens']}")

        # Pass usage data to collector if provided
        if usage_collector and hasattr(response, 'metrics') and hasattr(response.metrics, 'accumulated_usage'):
            usage_data = response.metrics.accumulated_usage
            usage_collector.add_usage(agent_id, usage_data)

        return result

    except Exception as e:
        logger.error(f"Sub-agent {agent_id} error: {e}")
        return f"Error: {str(e)}"


if __name__ == "__main__":
    # Test sub-agent
    result = call_sub_agent("01", "Test prompt")
    print(f"Result: {result}")
