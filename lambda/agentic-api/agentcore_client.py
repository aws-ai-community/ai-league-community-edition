"""AgentCore Client — invokes Bedrock AgentCore Runtime.

Wraps the bedrock-agentcore invoke_agent_runtime API.
Parses streaming SSE response to extract text content.
Implements hard timeout via signal.SIGALRM (ported from reference app).

Requirements: 9.1, 9.6, 9.7
"""

from __future__ import annotations

import json
import logging
import signal
import uuid
from typing import Optional, Tuple

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class AgentCoreTimeoutError(Exception):
    """Raised when an AgentCore Runtime invocation exceeds the timeout."""

    pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def invoke_agent_runtime(
    runtime_arn: str,
    payload: dict,
    timeout: int = 90,
    session_id: Optional[str] = None,
) -> Tuple[str, dict]:
    """Invoke AgentCore Runtime and return the text response with usage info.

    Uses signal.SIGALRM for hard timeout enforcement (ported from reference
    app implementation).

    Args:
        runtime_arn: ARN of the AgentCore Runtime to invoke.
        payload: Full invocation payload dict (prompt, task_type, session_id, etc.).
        timeout: Hard timeout in seconds (default 90s).
        session_id: Optional session ID for multi-turn conversations.

    Returns:
        Tuple of (response_text, usage_info_dict).

    Raises:
        AgentCoreTimeoutError: If invocation exceeds timeout.
    """

    def _timeout_handler(signum, frame):
        raise AgentCoreTimeoutError(
            f"AgentCore invocation timed out after {timeout}s"
        )

    usage_info = {}

    old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(timeout)

    try:
        agentcore = boto3.client(
            "bedrock-agentcore",
            config=Config(
                read_timeout=90,
                connect_timeout=10,
                retries={"max_attempts": 0},
            ),
        )

        # Session ID must be >= 33 chars
        if session_id:
            if len(session_id) < 33:
                session_id = session_id + "-" + str(uuid.uuid4())[:8]
        else:
            session_id = str(uuid.uuid4()) + "-" + str(uuid.uuid4())[:8]

        response = agentcore.invoke_agent_runtime(
            agentRuntimeArn=runtime_arn,
            runtimeSessionId=session_id,
            payload=json.dumps(payload).encode("utf-8"),
            contentType="application/json",
            accept="application/json",
        )

        agent_response = ""
        response_stream = response.get("response") or response.get("body")
        if response_stream:
            if hasattr(response_stream, "read"):
                raw = response_stream.read().decode("utf-8")
            else:
                raw = str(response_stream)

            for line in raw.split("\n"):
                line = line.strip()
                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        parsed = json.loads(data_str)
                        if "usage_summary" in parsed:
                            usage_info = parsed["usage_summary"]
                        if "complete_message" in parsed:
                            agent_response = parsed["complete_message"]
                            break
                        if "data" in parsed and isinstance(parsed["data"], str):
                            agent_response += parsed["data"]
                    except json.JSONDecodeError:
                        if data_str.startswith('"') and data_str.endswith('"'):
                            try:
                                agent_response += json.loads(data_str)
                            except json.JSONDecodeError:
                                agent_response += data_str[1:-1]
                        else:
                            agent_response += data_str

        return agent_response, usage_info

    except AgentCoreTimeoutError:
        raise
    except Exception as e:
        if hasattr(e, "response") and isinstance(getattr(e, "response", None), dict) and "Error" in e.response:
            error_code = e.response["Error"]["Code"]
            error_message = e.response["Error"]["Message"]
            logger.error(
                "AgentCore invocation failed [%s]: %s",
                error_code,
                error_message,
            )
            raise
        logger.error("AgentCore invocation error: %s", str(e))
        raise
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)
