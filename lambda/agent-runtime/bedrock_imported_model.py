"""Custom Strands model provider for Bedrock Imported Models (Qwen3).

Imported models in Bedrock don't support the Converse API or structured tool_calls
in the OpenAI ChatCompletion format. This provider uses InvokeModelWithResponseStream
with the OpenAI ChatCompletion format and handles tool calling by:
1. Embedding tool definitions in the system prompt (Qwen3 native format)
2. Parsing <tool_call>...</tool_call> XML from the model's text output
3. Converting parsed tool calls into Strands StreamEvent format

This allows imported Qwen3 models to work with the Strands Agent loop.
"""

import json
import logging
import re
import uuid
from collections.abc import AsyncGenerator
from typing import Any

import boto3

from strands.models.model import Model
from strands.types.content import Messages
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolSpec

logger = logging.getLogger(__name__)


def _strip_think_tags(text: str) -> str:
    """Remove <think>...</think> blocks from Qwen3 output."""
    return re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL)


def _parse_tool_calls(text: str) -> tuple[str, list[dict]]:
    """Parse <tool_call>...</tool_call> blocks from model output.

    Returns:
        Tuple of (remaining_text, list_of_tool_call_dicts)
    """
    tool_calls = []
    # Match tool call blocks
    pattern = r"<tool_call>\s*(\{.*?\})\s*</tool_call>"
    matches = re.finditer(pattern, text, re.DOTALL)

    for match in matches:
        try:
            call_data = json.loads(match.group(1))
            tool_calls.append({
                "id": f"call_{uuid.uuid4().hex[:8]}",
                "name": call_data.get("name", ""),
                "arguments": call_data.get("arguments", {}),
            })
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse tool call JSON: {match.group(1)}")

    # Remove tool_call blocks from text
    remaining = re.sub(pattern, "", text, flags=re.DOTALL).strip()
    return remaining, tool_calls


def _format_messages_for_openai(
    messages: Messages,
    system_prompt: str | None,
    tool_specs: list[ToolSpec] | None,
) -> tuple[list[dict], dict[str, str]]:
    """Format Strands messages into OpenAI ChatCompletion format with tool info in system prompt.

    Returns:
        Tuple of (formatted_messages, tool_name_map) where tool_name_map maps
        simplified names back to full MCP names (e.g. "calc" -> "AgentCoreGatewayTool-X___calc").
    """
    formatted = []
    tool_name_map: dict[str, str] = {}  # simplified -> full name

    # Build system message with tool definitions embedded
    system_parts = []
    if system_prompt:
        system_parts.append(system_prompt)

    if tool_specs:
        tools_text = "\n\n# Tools\n\nYou may call one or more functions to assist with the user query.\n\n"
        tools_text += "You are provided with function signatures within <tools></tools> XML tags:\n<tools>"
        for spec in tool_specs:
            full_name = spec["name"]
            # Simplify gateway-prefixed names (e.g. "AgentCoreGatewayTool-X___calc" -> "calc")
            if "___" in full_name:
                simple_name = full_name.split("___", 1)[1]
            else:
                simple_name = full_name
            tool_name_map[simple_name] = full_name

            tool_def = {
                "type": "function",
                "function": {
                    "name": simple_name,
                    "description": spec.get("description", ""),
                    "parameters": spec.get("inputSchema", {}),
                },
            }
            tools_text += f"\n{json.dumps(tool_def)}"
        tools_text += "\n</tools>\n\n"
        tools_text += (
            "For each function call, return a json object with function name and arguments "
            "within <tool_call></tool_call> XML tags:\n"
            '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>'
        )
        system_parts.append(tools_text)

    # Add /no_think to reduce unnecessary thinking output
    system_parts.append("/no_think")

    if system_parts:
        formatted.append({"role": "system", "content": "\n\n".join(system_parts)})

    # Format conversation messages
    for msg in messages:
        role = msg.get("role", "user")
        content_blocks = msg.get("content", [])

        if role == "user":
            # Combine text blocks, handle tool results
            text_parts = []
            for block in content_blocks:
                if isinstance(block, dict):
                    if "text" in block:
                        text_parts.append(block["text"])
                    elif "toolResult" in block:
                        tool_result = block["toolResult"]
                        result_content = ""
                        for c in tool_result.get("content", []):
                            if "text" in c:
                                result_content += c["text"]
                            elif "json" in c:
                                result_content += json.dumps(c["json"])
                        text_parts.append(f"<tool_response>\n{result_content}\n</tool_response>")
                elif isinstance(block, str):
                    text_parts.append(block)

            if text_parts:
                formatted.append({"role": "user", "content": "\n".join(text_parts)})

        elif role == "assistant":
            # Reconstruct assistant message, converting toolUse back to <tool_call> format
            text_parts = []
            for block in content_blocks:
                if isinstance(block, dict):
                    if "text" in block:
                        text_parts.append(block["text"])
                    elif "toolUse" in block:
                        tool_use = block["toolUse"]
                        tool_call_text = (
                            f'<tool_call>\n{{"name": "{tool_use["name"]}", '
                            f'"arguments": {json.dumps(tool_use.get("input", {}))}}}\n</tool_call>'
                        )
                        text_parts.append(tool_call_text)

            if text_parts:
                formatted.append({"role": "assistant", "content": "\n".join(text_parts)})

    return formatted, tool_name_map


class BedrockImportedModel(Model):
    """Custom model provider for Bedrock Imported Models (Qwen3).

    Uses InvokeModelWithResponseStream with OpenAI ChatCompletion format,
    and handles tool calling via text-based <tool_call> parsing.
    """

    def __init__(
        self,
        model_id: str,
        region_name: str = "us-east-1",
        max_tokens: int = 4096,
        temperature: float = 0.0,
        streaming: bool = True,
    ):
        """Initialize the Bedrock Imported Model provider.

        Args:
            model_id: The imported model ARN.
            region_name: AWS region.
            max_tokens: Maximum tokens to generate.
            temperature: Sampling temperature.
            streaming: Whether to use streaming (always True for this provider).
        """
        self.model_id = model_id
        self.region_name = region_name
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.streaming = streaming
        self._client = None

    @property
    def client(self):
        """Lazy-init boto3 bedrock-runtime client."""
        if self._client is None:
            self._client = boto3.client("bedrock-runtime", region_name=self.region_name)
        return self._client

    def update_config(self, **model_config: Any) -> None:
        """Update model configuration."""
        if "model_id" in model_config:
            self.model_id = model_config["model_id"]
        if "max_tokens" in model_config:
            self.max_tokens = model_config["max_tokens"]
        if "temperature" in model_config:
            self.temperature = model_config["temperature"]
        if "region_name" in model_config:
            self.region_name = model_config["region_name"]
            self._client = None

    def get_config(self) -> dict[str, Any]:
        """Return model configuration."""
        return {
            "model_id": self.model_id,
            "region_name": self.region_name,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "streaming": self.streaming,
        }

    async def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):
        """Structured output - not supported for imported models."""
        raise NotImplementedError("Structured output is not supported for Bedrock imported models")

    async def stream(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        *,
        tool_choice: ToolChoice | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Stream conversation with the imported model.

        Handles the full lifecycle:
        1. Format messages with tools embedded in system prompt
        2. Call InvokeModelWithResponseStream
        3. Collect full response text
        4. Parse tool calls from <tool_call> blocks
        5. Yield appropriate StreamEvents

        Args:
            messages: Conversation messages.
            tool_specs: Available tools (embedded in system prompt).
            system_prompt: System prompt.
            tool_choice: Tool choice strategy (informational only).
            **kwargs: Additional arguments.

        Yields:
            StreamEvent dicts compatible with the Strands agent loop.
        """
        # Format request
        formatted_messages, tool_name_map = _format_messages_for_openai(messages, system_prompt, tool_specs)

        payload = {
            "messages": formatted_messages,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
        }

        logger.info(f"BedrockImportedModel invoking: model={self.model_id}, messages={len(formatted_messages)}")
        logger.debug(f"Request payload: {json.dumps(payload, default=str)[:500]}")

        # Retry with exponential backoff for ModelNotReadyException (cold start)
        import time

        max_retries = 6
        response = None
        for attempt in range(max_retries):
            try:
                response = self.client.invoke_model_with_response_stream(
                    modelId=self.model_id,
                    body=json.dumps(payload),
                    accept="application/json",
                    contentType="application/json",
                )
                break
            except self.client.exceptions.ModelNotReadyException as e:
                wait_time = min(10 * (2 ** attempt), 120)  # 10s, 20s, 40s, 80s, 120s, 120s
                logger.warning(
                    f"ModelNotReadyException (attempt {attempt + 1}/{max_retries}), "
                    f"waiting {wait_time}s for model to warm up..."
                )
                if attempt == max_retries - 1:
                    logger.error(f"BedrockImportedModel failed after {max_retries} retries: {e}")
                    raise
                time.sleep(wait_time)
            except Exception as e:
                logger.error(f"BedrockImportedModel invocation failed: {e}")
                raise

        # Collect streaming response
        full_content = ""
        input_tokens = 0
        output_tokens = 0

        # Yield message start
        yield {"messageStart": {"role": "assistant"}}

        for event in response["body"]:
            if "chunk" in event:
                chunk_data = json.loads(event["chunk"]["bytes"].decode())
                choices = chunk_data.get("choices", [])
                if not choices:
                    continue

                choice = choices[0]
                delta = choice.get("delta", {})
                content = delta.get("content", "")

                if content:
                    full_content += content

                # Check for metrics in the last chunk
                if "amazon-bedrock-invocationMetrics" in chunk_data:
                    metrics = chunk_data["amazon-bedrock-invocationMetrics"]
                    input_tokens = metrics.get("inputTokenCount", 0)
                    output_tokens = metrics.get("outputTokenCount", 0)

        # Post-process: strip thinking tags
        cleaned_content = _strip_think_tags(full_content)

        # Parse tool calls from the cleaned content
        remaining_text, tool_calls = _parse_tool_calls(cleaned_content)

        # Yield text content if any
        if remaining_text.strip():
            yield {
                "contentBlockStart": {"start": {}},
                "contentBlockIndex": 0,
            }
            yield {
                "contentBlockDelta": {"delta": {"text": remaining_text.strip()}},
                "contentBlockIndex": 0,
            }
            yield {"contentBlockStop": {}, "contentBlockIndex": 0}

        # Yield tool calls if any
        if tool_calls:
            for i, tool_call in enumerate(tool_calls):
                block_index = (1 if remaining_text.strip() else 0) + i
                # Map simplified tool name back to full MCP name
                tool_name = tool_call["name"]
                full_tool_name = tool_name_map.get(tool_name, tool_name)
                yield {
                    "contentBlockStart": {
                        "start": {
                            "toolUse": {
                                "toolUseId": tool_call["id"],
                                "name": full_tool_name,
                            }
                        }
                    },
                    "contentBlockIndex": block_index,
                }
                yield {
                    "contentBlockDelta": {
                        "delta": {"toolUse": {"input": json.dumps(tool_call["arguments"])}}
                    },
                    "contentBlockIndex": block_index,
                }
                yield {"contentBlockStop": {}, "contentBlockIndex": block_index}

        # Determine stop reason
        stop_reason = "tool_use" if tool_calls else "end_turn"
        yield {"messageStop": {"stopReason": stop_reason}}

        # Yield usage metadata
        yield {
            "metadata": {
                "usage": {
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                    "totalTokens": input_tokens + output_tokens,
                },
                "metrics": {
                    "latencyMs": 0,
                },
            }
        }

        logger.info(
            f"BedrockImportedModel response: text={len(remaining_text)} chars, "
            f"tool_calls={len(tool_calls)}, tokens={input_tokens}+{output_tokens}"
        )
