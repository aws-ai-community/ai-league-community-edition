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


import re

def _direct_pathfinder_call(prompt: str, gateway_url: str, allowed_targets: List[str]) -> str:
    """Extract map + start from prompt and call pathfinder tool directly via MCP.
    
    This bypasses the LLM for tool parameter construction, avoiding truncation
    issues with Nova Lite when passing large JSON grids.
    Returns the path array as a JSON string, or None if extraction fails.
    """
    try:
        # Extract the grid array from the prompt
        # The prompt format is: "...find the treasure on this map: [[...]]..."
        grid_match = re.search(r'on this map:\s*(\[.+\])', prompt, re.DOTALL)
        if not grid_match:
            logger.warning("Could not extract grid from prompt")
            return None
        
        grid_str = grid_match.group(1)
        # Remove trailing period if present
        if grid_str.endswith('.'):
            grid_str = grid_str[:-1]
        
        # Validate it's valid JSON
        try:
            grid = json.loads(grid_str)
        except json.JSONDecodeError:
            logger.warning("Grid extraction produced invalid JSON")
            return None
        
        # Extract start position from prompt (e.g., "from position A1")
        start_match = re.search(r'from position ([A-Z])(\d+)', prompt)
        start_pos = [0, 0]
        if start_match:
            col = ord(start_match.group(1)) - ord('A')
            row = int(start_match.group(2)) - 1
            start_pos = [row, col]
        
        # Extract strategy from prompt
        strategy = 'swift'
        strategy_match = re.search(r'strategy\s+(\w+)', prompt.lower())
        if strategy_match:
            s = strategy_match.group(1)
            if s in ('swift', 'get_coins'):
                strategy = s
        
        logger.info(f"Direct pathfinder: start={start_pos}, strategy={strategy}, grid_size={len(grid)}x{len(grid[0]) if grid else 0}")
        
        # Call the MCP tool directly
        client = MCPClient(lambda: create_streamable_http_transport(gateway_url))
        client.__enter__()
        try:
            all_tools = client.list_tools_sync()
            # Find the pathfind tool
            pathfind_tool = None
            for t in all_tools:
                tool_name = t.mcp_tool.name
                if any(tool_name.startswith(target) for target in allowed_targets):
                    pathfind_tool = t
                    break
            
            if not pathfind_tool:
                logger.warning("No pathfinding tool found in gateway")
                return None
            
            # Call the tool with the extracted parameters
            result = client.call_tool_sync(
                pathfind_tool.mcp_tool.name,
                {
                    "game_map": json.dumps(grid),
                    "start_pos": json.dumps(start_pos),
                    "strategy": strategy,
                }
            )
            
            # Extract the path from the result
            if result and result.content:
                for content_item in result.content:
                    if hasattr(content_item, 'text'):
                        text = content_item.text
                        # Parse the Lambda response
                        try:
                            resp = json.loads(text)
                            if isinstance(resp, dict):
                                # Handle {"statusCode": 200, "body": "{\"path\": [...]}"}
                                body = resp.get('body', '')
                                if isinstance(body, str):
                                    body_parsed = json.loads(body)
                                    path = body_parsed.get('path', [])
                                else:
                                    path = resp.get('path', [])
                                if path:
                                    return json.dumps(path)
                        except json.JSONDecodeError:
                            pass
            
            logger.warning("Could not extract path from tool result")
            return None
        finally:
            client.__exit__(None, None, None)
    
    except Exception as e:
        logger.error(f"Direct pathfinder call error: {e}")
        return None


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
        agent_model_id = model_id or "us.amazon.nova-pro-v1:0"

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
    """Call sub-agent by ID.
    
    For pathfinding tasks, extracts the map grid from the prompt and calls
    the pathfinder tool directly (bypassing LLM tool-use for large JSON relay).
    """
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

        # For pathfinding sub-agents: extract map from prompt and call tool directly
        # This avoids relying on Nova Lite to relay large JSON through tool_use
        if allowed_targets and any('pathfind' in t.lower() or 'Pathfinding' in t for t in allowed_targets):
            result = _direct_pathfinder_call(prompt, gateway_url, allowed_targets)
            if result is not None:
                logger.info(f"Direct pathfinder call succeeded: {result[:100]}")
                return result
            logger.warning("Direct pathfinder call failed, falling back to LLM sub-agent")

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
