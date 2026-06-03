#!/usr/bin/env python3
"""
Main AgentCore Runtime Entry Point - Orchestrator-based Architecture
Follows AgentCore reference pattern with agent collaboration
"""
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from orchestrator_agent import invoke as orchestrator_invoke

app = BedrockAgentCoreApp()

@app.entrypoint
async def invoke(payload):
    """
    Main AgentCore Runtime entrypoint - delegates to orchestrator
    
    Payload structure:
    - prompt: The user input (required)
    - task_type: Type of task (optional, defaults to "general")
    - context: Additional context (optional)
    - session_id: Session identifier (optional, defaults to "default_session")
    - gateway_url: AgentCore Gateway URL (optional, from config)
    """
    # Delegate to orchestrator agent
    async for result in orchestrator_invoke(payload):
        yield result

if __name__ == "__main__":
    app.run()
