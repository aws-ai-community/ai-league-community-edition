#!/usr/bin/env python3
"""
Dungeon Game Orchestrator Agent - Main coordinator for pathfinding and challenges
Follows AgentCore reference architecture with agent collaboration
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Union
from fastapi import FastAPI
from pydantic import BaseModel
import boto3
from opentelemetry import baggage
from opentelemetry import context as otel_context

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory import MemoryClient
from strands import Agent, tool
from strands.models import BedrockModel
from agent_utils import get_region_from_config, create_streamable_http_transport, create_sagemaker_model
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp.mcp_client import MCPClient
from strands.tools.executors import ConcurrentToolExecutor, SequentialToolExecutor

# Consolidated sub-agent support
from sub_agent import call_sub_agent

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orchestrator-agent")


class UsageCollector:
    """Collects usage data from subagents"""
    def __init__(self):
        self.subagent_usage = []

    def add_usage(self, agent_id, usage_data):
        self.subagent_usage.append({"agent_id": agent_id, "usage": usage_data})

    def get_and_clear_usage(self):
        usage = self.subagent_usage.copy()
        self.subagent_usage.clear()
        return usage


def get_gateway_url():
    try:
        config_path = os.path.join(os.path.dirname(__file__), "agent_config.json")
        with open(config_path, 'r') as f:
            config = json.load(f)
        gateway_url = config.get("gateway_url")
        return gateway_url
    except Exception as e:
        logger.warning(f"Could not read config file: {e}")


# Configuration
MEMORY_RETRIEVAL_TURNS = 25
boto_config = {"region_name": get_region_from_config()}

app = BedrockAgentCoreApp()
fastapi_app = FastAPI()


class SubAgentConfig(BaseModel):
    id: str
    name: str
    system_prompt: str
    description: str
    targets: Optional[List[str]] = None


class InvocationRequest(BaseModel):
    prompt: str
    task_type: Optional[str] = "general"
    context: Optional[str] = ""
    session_id: Optional[str] = "default_session"
    subagents: Optional[List[SubAgentConfig]] = None


def set_session_context(session_id: str):
    """Set the session ID in OpenTelemetry baggage for trace correlation"""
    ctx = baggage.set_baggage("session.id", session_id)
    token = otel_context.attach(ctx)
    logger.info(f"Session ID '{session_id}' attached to telemetry context")
    return token


def get_system_prompt():
    """Get system prompt from config file"""
    try:
        config_path = os.path.join(os.path.dirname(__file__), "agent_config.json")
        with open(config_path, 'r') as f:
            config = json.load(f)
        return config.get('orchestrator_system_prompt', 'You are a dungeon game orchestrator.')
    except Exception as e:
        logger.warning(f"Could not read config file: {e}")
        return 'You are a dungeon game orchestrator.'


def get_memory_client_and_id():
    """Get memory client and ID"""
    try:
        region = get_region_from_config()
        memory_client = MemoryClient(region_name=region)

        # Try environment variable first
        memory_id = os.environ.get('AGENTCORE_MEMORY_ID')

        # Fall back to config file
        if not memory_id:
            try:
                config_path = os.path.join(os.path.dirname(__file__), "agent_config.json")
                with open(config_path, 'r') as f:
                    config = json.load(f)
                memory_id = config.get('memory_id')
            except Exception as e:
                logger.warning(f"Could not read config file: {e}")

        if not memory_id:
            logger.warning("No memory_id found in environment or config")
            return None, None

        logger.info(f"Using memory ID: {memory_id}")
        return memory_client, memory_id

    except ImportError:
        logger.info("AgentCore Memory SDK not available")
        return None, None
    except Exception as e:
        logger.error(f"Failed to get memory client: {e}")
        return None, None


def load_conversation_from_memory(memory_client, memory_id: str, actor_id: str, session_id: str) -> str:
    """Load conversation history from memory and format as context"""
    try:
        logger.info(f"Loading last {MEMORY_RETRIEVAL_TURNS} conversation turns from memory")

        conversations = memory_client.get_last_k_turns(
            memory_id=memory_id,
            actor_id=actor_id,
            session_id=session_id,
            k=MEMORY_RETRIEVAL_TURNS,
            branch_name="main"
        )

        if not conversations:
            logger.info(f"No previous conversation context found for session {session_id}")
            return ""

        context_parts = ["**Previous Conversation:**"]

        for turn in conversations:
            # Check if this turn has a blocked response
            turn_has_blocked_content = False
            for message in turn:
                content = message['content']['text']
                if ('[Content blocked by safety guardrails' in content or
                    '[Response blocked by safety guardrails' in content or
                    'agentcore detected inappropriate' in content.lower()):
                    turn_has_blocked_content = True
                    break

            # Skip entire turn if it contains blocked content
            if turn_has_blocked_content:
                continue

            # Add messages from clean turns
            for message in turn:
                role = message['role']
                content = message['content']['text']

                if role == 'USER':
                    context_parts.append(f"**You:** {content}")
                elif role == 'ASSISTANT':
                    context_parts.append(f"**Agent:** {content}")

        context = "\n".join(context_parts)
        logger.info(f"Loaded {len(conversations)} conversation turns from memory ({len(context)} chars)")
        return context

    except Exception as e:
        logger.error(f"Failed to load conversation from memory: {e}")
        return ""


def store_conversation_in_memory(memory_client, memory_id: str, actor_id: str, session_id: str, user_message: str, assistant_response: str):
    """Store a conversation turn directly in memory"""
    try:
        # Skip storing if response contains blocked content
        if ('[Content blocked by safety guardrails' in assistant_response or
            '[Response blocked by safety guardrails' in assistant_response or
            'blocked' in assistant_response.lower() or
            'guardrail' in assistant_response.lower()):
            logger.info(f"Skipping storage of blocked conversation for session {session_id}")
            return False

        logger.info(f"Storing conversation: session={session_id}, actor={actor_id}")

        memory_client.create_event(
            memory_id=memory_id,
            actor_id=actor_id,
            session_id=session_id,
            messages=[
                (user_message, "USER"),
                (assistant_response, "ASSISTANT")
            ]
        )
        logger.info(f"Successfully stored conversation in memory for session {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to store conversation in memory: {e}")
        return False


def create_sub_agent_tool(agent_id, description, system_prompt=None, gateway_url=None, model_id=None, tool_name=None, allowed_targets=None, usage_collector=None, sagemaker_invoke_role_arn=None, original_prompt=None):
    def sub_agent_tool(prompt: str) -> str:
        # If the supervisor truncated the prompt, use the original full prompt instead
        actual_prompt = prompt
        if original_prompt and len(prompt) < len(original_prompt) * 0.5:
            logger.info(f"Sub-agent tool received truncated prompt ({len(prompt)} chars), using original ({len(original_prompt)} chars)")
            actual_prompt = original_prompt
        # Use consolidated sub-agent function with usage collector
        return call_sub_agent(agent_id, actual_prompt, gateway_url, model_id, system_prompt, allowed_targets, usage_collector, sagemaker_invoke_role_arn)

    sub_agent_tool.__doc__ = f"Call sub_agent_{agent_id} for {description}"
    sub_agent_tool.__name__ = tool_name or f"call_sub_agent_{agent_id}_tool"

    return tool(sub_agent_tool)


def get_agent_tools(subagents: List[Dict[str, Any]] = None, gateway_url: str = None, model_id: str = None, usage_collector: UsageCollector = None, sagemaker_invoke_role_arn: str = None, original_prompt: str = None):
    """Get orchestrator agent tools based on specified subagents"""

    # If no subagents specified, return empty (require explicit configuration)
    if not subagents:
        logger.info("No subagents specified, orchestrator will have no specialist tools")
        return []

    # Create tools dynamically from subagent configurations
    base_tools = []
    tool_names = []

    for subagent in subagents:
        agent_id = subagent.get("id")
        name = subagent.get("name", agent_id)
        description = subagent.get("description", "specialized tasks")
        system_prompt = subagent.get("system_prompt")
        targets = subagent.get("targets")
        subagent_model_id = subagent.get("model_id")

        logger.info(f"Creating tool for subagent: id={agent_id}, name={name}")

        # Create tool dynamically with usage collector
        tool = create_sub_agent_tool(
            agent_id=agent_id,
            description=description,
            system_prompt=system_prompt,
            gateway_url=gateway_url,
            model_id=subagent_model_id or model_id,
            tool_name=name,
            allowed_targets=targets,
            usage_collector=usage_collector,
            sagemaker_invoke_role_arn=sagemaker_invoke_role_arn,
            original_prompt=original_prompt,
        )

        base_tools.append(tool)
        tool_names.append(name)

    logger.info(f"Orchestrator initialized with {len(base_tools)} specialist tools: {tool_names}")
    return base_tools


def create_orchestrator_agent(session_id: str = None, tools: Optional[List] = None, model_id: str = None, guardrail_id: str = None, guardrail_version: str = None, subagents: List[Union[str, Dict[str, Any]]] = None, gateway_url: str = None, supervisor_system_prompt: str = None, supervisor_targets: List[str] = None, usage_collector: UsageCollector = None, sagemaker_invoke_role_arn: str = None, original_prompt: str = None):
    """Create orchestrator agent with sub-agents as tools"""

    logger.info(f"Creating orchestrator with model_id={model_id}, guardrails={guardrail_id}:{guardrail_version}")

    # Default model configuration
    model_config = {
        "model_id": model_id or "us.amazon.nova-2-lite-v1:0",
        "max_tokens": 8192,
        "streaming": True
    }

    # Add guardrail configuration if provided
    if guardrail_id and guardrail_version:
        model_config.update({
            "guardrail_id": guardrail_id,
            "guardrail_version": guardrail_version,
            "guardrail_trace": "enabled",
            "guardrail_redact_input": True,
            "guardrail_redact_input_message": "[Content blocked by safety guardrails - please rephrase your request about the dungeon game]",
            "guardrail_redact_output": True,
            "guardrail_redact_output_message": "[Response blocked by safety guardrails - the hero cannot assist with that request]",
        })

    actual_model_id = model_config.get("model_id", "")
    if actual_model_id.startswith("sagemaker:"):
        if guardrail_id:
            logger.warning(f"Guardrail config (id={guardrail_id}) ignored — SageMaker endpoints do not support Bedrock guardrails")
        model = create_sagemaker_model(
            actual_model_id, role_arn=sagemaker_invoke_role_arn, stream=True,
        )
    else:
        logger.info(f"Creating BedrockModel with config: {model_config}")
        try:
            model = BedrockModel(**model_config)
            logger.info("BedrockModel created successfully")
        except Exception as e:
            logger.error(f"BedrockModel creation failed: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise

    logger.info("Getting supervisor agent sub-agent tools")
    agent_gateway_url = gateway_url or get_gateway_url()
    try:
        agent_tools = tools if tools is not None else get_agent_tools(subagents, agent_gateway_url, model_id, usage_collector, sagemaker_invoke_role_arn, original_prompt=original_prompt)
        logger.info(f"Got {len(agent_tools)} tools")
    except Exception as e:
        logger.error(f"Failed to get agent tools: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise

    logger.info("Getting supervisor agent lambda tools")
    try:
        # Create MCP client for AgentCore Gateway
        client = MCPClient(lambda: create_streamable_http_transport(agent_gateway_url))

        # Keep client alive and get tools
        client.__enter__()
        all_gateway_tools = client.list_tools_sync()

        # Filter tools by allowed targets
        if supervisor_targets:
            gateway_tools = []
            for tool in all_gateway_tools:
                tool_name = tool.mcp_tool.name
                # Check if tool name starts with any allowed target + separator
                # Use "target___" to avoid prefix collisions (e.g. "P" matching "Pathfinder")
                if any(tool_name.startswith(target + "___") or tool_name == target for target in supervisor_targets):
                    gateway_tools.append(tool)
            logger.info(f"Supervisor agent filtered to {len(gateway_tools)} tools from targets {supervisor_targets}:")
        else:
            # No allowed targets means no lambda tools
            gateway_tools = []
            logger.info(f"Supervisor agent has no allowed targets - using 0 lambda tools:")

        for i, tool in enumerate(gateway_tools):
            logger.info(f"  Tool {i+1}: {tool.__dict__}")

        # Merge gateway tools into agent tools
        all_tools = agent_tools + gateway_tools
        logger.info(f"Supervisor agent total tools: {len(agent_tools)} sub-agent + {len(gateway_tools)} gateway = {len(all_tools)} total")
    except Exception as e:
        logger.error(f"Failed to get supervisor agent lambda tools: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise

    logger.info("Creating Agent instance")
    try:
        orchestrator = Agent(
            name="Dungeon Game Orchestrator",
            model=model,
            system_prompt=supervisor_system_prompt or get_system_prompt(),
            tools=all_tools,
            tool_executor=ConcurrentToolExecutor(),
            trace_attributes={
                "agent.type": "dungeon_game_orchestrator",
                "system.version": "v1.0"
            }
        )
        logger.info("Agent instance created successfully")

        # Store client reference to keep it alive
        orchestrator._mcp_client = client

        return orchestrator
    except Exception as e:
        logger.error(f"Agent creation failed: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise


async def stream_agent_response(prompt: str, task_type: str = "general", context: str = "", session_id: str = "default_session", actor_id: str = "default_user", memory_id: str = None, model_id: str = None, guardrail_id: str = None, guardrail_version: str = None, supervisor_system_prompt: str = None, supervisor_targets: List[str] = None, gateway_url: str = None, subagents: List[Union[str, Dict[str, Any]]] = None, sagemaker_invoke_role_arn: str = None):
    """Stream orchestrator agent response with memory integration"""
    try:
        # Set session context for tracing
        set_session_context(session_id)

        # Create usage collector for subagent metrics
        usage_collector = UsageCollector()

        # Get memory client if memory_id provided
        memory_client = None
        conversation_context = ""
        if memory_id:
            try:
                region = get_region_from_config()
                logger.info(f"Creating memory client with region: {region}")
                memory_client = MemoryClient(region_name=region)
                conversation_context = load_conversation_from_memory(
                    memory_client, memory_id, actor_id, session_id
                )
            except Exception as e:
                logger.error(f"Memory error: {e}")

        # Create orchestrator agent with model and guardrail config
        logger.info(f"Creating orchestrator agent with model_id: {model_id}")
        try:
            orchestrator = create_orchestrator_agent(
                session_id=session_id,
                model_id=model_id,
                guardrail_id=guardrail_id,
                guardrail_version=guardrail_version,
                subagents=subagents,
                gateway_url=gateway_url,
                supervisor_system_prompt=supervisor_system_prompt,
                supervisor_targets=supervisor_targets,
                usage_collector=usage_collector,
                sagemaker_invoke_role_arn=sagemaker_invoke_role_arn,
                original_prompt=prompt,
            )
            logger.info("Orchestrator agent created successfully")
        except Exception as e:
            logger.error(f"Failed to create orchestrator agent: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise

        is_guardrail_challenge = False
        if "guardrail" in task_type.lower():
            logger.info(f"Guardrail challenge detected for task_type={task_type}")
            is_guardrail_challenge = True

        # Build enhanced prompt with context
        enhanced_prompt = f"""
{conversation_context}

CURRENT REQUEST:
Task Type: {task_type if not is_guardrail_challenge else "general"}
Context: {context}
User Input: {prompt}

Analyze the request and delegate to the appropriate specialist agent or handle directly.
"""

        # Process with orchestrator and stream results
        logger.info(f"Processing with orchestrator: task_type={task_type}")

        # Stream the agent response
        stream = orchestrator.stream_async(enhanced_prompt.strip())
        seen_tools = set()
        response_chunks = []

        guardrails_invoked = False

        async for event in stream:
            logger.info(f"Raw event: {event}")
            if 'data' in event:
                data_content = event['data']

                # Check if this data indicates guardrail blocking
                if any(pattern in data_content.lower() for pattern in [
                    'agentcore detected inappropriate',
                    'inappropriate content',
                    'blocked by safety',
                    'guardrail',
                    'detected harmful'
                ]):
                    guardrails_invoked = True
                    logger.info("Guardrails invoked - will skip storing this interaction")

                response_chunks.append(data_content)
                yield {"data": data_content}
            elif 'event' in event and 'metadata' in event['event']:
                # Extract token usage
                metadata = event['event']['metadata']
                metadata_response = {"metadata": {}}
                if 'usage' in metadata:
                    metadata_response["metadata"]["usage"] = metadata['usage']
                if metadata_response["metadata"]:
                    yield metadata_response

                # Check for and yield any collected subagent usage
                subagent_usage = usage_collector.get_and_clear_usage()
                if subagent_usage:
                    for usage_info in subagent_usage:
                        yield {"subagent_metadata": usage_info}
            elif 'current_tool_use' in event:
                tool_id = event['current_tool_use'].get('toolUseId')
                tool_name = event['current_tool_use'].get('name', 'unknown')
                if tool_id not in seen_tools:
                    seen_tools.add(tool_id)
                    logger.info(f"Yielding tool: {tool_name}")
                    tool_message = f"\n\nUsing tool: {tool_name}\n\n"
                    response_chunks.append(tool_message)
                    yield {"data": tool_message}
            elif 'result' in event and hasattr(event['result'], 'message'):
                # Build complete message from all streamed chunks
                complete_message = "".join(response_chunks)
                yield {"complete_message": complete_message}

                # Extract just the clean message from result
                final_message = event['result'].message
                yield {"eval_message": final_message}
                response_chunks.append(final_message)
            elif 'guardrail' in event or 'blocked' in str(event).lower():
                guardrails_invoked = True
                logger.info("Guardrails invoked - will skip storing this interaction")
            else:
                logger.info(f"Unhandled event type: {list(event.keys()) if isinstance(event, dict) else type(event)}")
                if isinstance(event, dict):
                    if 'text' in event:
                        response_chunks.append(event['text'])
                        yield {"data": event['text']}
                    elif 'content' in event:
                        response_chunks.append(event['content'])
                        yield {"data": event['content']}

        # Store complete response in memory
        complete_response = ""
        for chunk in response_chunks:
            if isinstance(chunk, str):
                complete_response += chunk
            elif isinstance(chunk, dict) and 'text' in chunk:
                complete_response += chunk['text']

        # Store in memory if available and guardrails were NOT invoked
        if memory_client and memory_id and complete_response and not guardrails_invoked and not is_guardrail_challenge:
            store_conversation_in_memory(
                memory_client, memory_id, actor_id, session_id,
                prompt, complete_response
            )
        elif guardrails_invoked:
            logger.info("Skipping memory storage due to guardrail invocation")
        elif is_guardrail_challenge:
            logger.info("Skipping memory storage for guardrail challenges")

    except Exception as e:
        logger.error(f"Orchestrator error: {e}")
        yield f"Error: {str(e)}"


@app.entrypoint
async def invoke(payload):
    """AgentCore Runtime entrypoint for orchestrator agent"""
    user_input = payload.get("prompt", "Find a path on this map")
    task_type = payload.get("task_type", "general")
    context = payload.get("context", "")
    session_id = payload.get("session_id", "default_session")
    actor_id = payload.get("actor_id", "default_user")
    memory_id = payload.get("memory_id")
    model_id = payload.get("model_id")
    guardrail_id = payload.get("guardrail_id")
    guardrail_version = payload.get("guardrail_version")
    supervisor_system_prompt = payload.get("supervisor_system_prompt")
    supervisor_targets = payload.get("supervisor_targets")
    gateway_url = payload.get("gateway_url")
    subagents = payload.get("subagents")

    sagemaker_invoke_role_arn = payload.get("sagemaker_invoke_role_arn")

    logger.info(f"Orchestrator invoked: task={task_type}, session={session_id}, actor={actor_id}, memory={memory_id}, model={model_id}, guardrails={guardrail_id}:{guardrail_version}, supervisor_targets={supervisor_targets}, subagents={subagents}")

    try:
        # Track aggregated usage
        total_usage = {
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0
        }
        orchestrator_usage_list = []
        subagent_usage_list = []

        # Stream response and collect usage data
        async for chunk in stream_agent_response(
            prompt=user_input,
            task_type=task_type,
            context=context,
            session_id=session_id,
            actor_id=actor_id,
            memory_id=memory_id,
            model_id=model_id,
            guardrail_id=guardrail_id,
            guardrail_version=guardrail_version,
            supervisor_system_prompt=supervisor_system_prompt,
            supervisor_targets=supervisor_targets,
            gateway_url=gateway_url,
            subagents=subagents,
            sagemaker_invoke_role_arn=sagemaker_invoke_role_arn
        ):
            # Collect usage data for aggregation but don't yield individual usage
            if "metadata" in chunk and "usage" in chunk["metadata"]:
                orchestrator_usage = chunk["metadata"]["usage"]
                orchestrator_usage_list.append(orchestrator_usage)
                total_usage["inputTokens"] += orchestrator_usage.get("inputTokens", 0)
                total_usage["outputTokens"] += orchestrator_usage.get("outputTokens", 0)
                total_usage["totalTokens"] += orchestrator_usage.get("totalTokens", 0)

            elif "subagent_metadata" in chunk and "usage" in chunk["subagent_metadata"]:
                subagent_usage = chunk["subagent_metadata"]["usage"]
                subagent_usage_list.append(chunk["subagent_metadata"])

                total_usage["inputTokens"] += subagent_usage.get("inputTokens", 0)
                total_usage["outputTokens"] += subagent_usage.get("outputTokens", 0)
                total_usage["totalTokens"] += subagent_usage.get("totalTokens", 0)

            else:
                # Yield all other chunks (data, messages, etc.) but not usage metadata
                yield chunk

        # Yield final aggregated usage summary
        yield {
            "usage_summary": {
                "total_usage": total_usage,
                "orchestrator_usage": orchestrator_usage_list,
                "orchestrator_count": len(orchestrator_usage_list),
                "subagent_usage": subagent_usage_list,
                "subagent_count": len(subagent_usage_list)
            }
        }

    except Exception as e:
        logger.error(f"Invocation error: {e}")
        yield {"error": str(e)}


@fastapi_app.post("/invocations")
async def invoke_agent(request: InvocationRequest):
    """Main agent invocation endpoint - non-streaming response"""
    try:
        # Collect all response chunks
        response_chunks = []
        async for chunk in stream_agent_response(
            prompt=request.prompt,
            task_type=request.task_type,
            context=request.context,
            session_id=request.session_id,
            subagents=request.subagents
        ):
            response_chunks.append(chunk)

        # Return complete response
        complete_response = "".join(response_chunks)
        return {"response": complete_response}

    except Exception as e:
        logger.error(f"Invocation error: {e}")
        return {"error": str(e)}


@fastapi_app.get("/ping")
def ping():
    """Health check endpoint"""
    memory_client, memory_id = get_memory_client_and_id()
    memory_status = "AgentCore Memory" if (memory_client and memory_id) else "No Memory"
    return {
        "status": "healthy",
        "service": "Dungeon Game Orchestrator",
        "memory_status": memory_status,
        "memory_available": memory_client is not None
    }


if __name__ == "__main__":
    app.run()
