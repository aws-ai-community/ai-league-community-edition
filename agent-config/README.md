# Agent Configuration Seeding

This folder contains the seed configuration for AI League agent setup. When present, it replaces the hardcoded defaults and provisions your full agent configuration on first user login after deployment.

## How It Works

1. **On `cdk deploy`**: The contents of this folder (excluding `examples/`) are uploaded to S3.
2. **On first user login**: The system reads `config.yaml` from S3 and provisions all resources (Lambda tools, sub-agents, memory, guardrails, supervisor config).
3. **Subsequent logins**: Existing configuration is never overwritten. Users can freely edit via the UI.

## Folder Structure

```
agent-config/
├── config.yaml              # ACTIVE seed config (this is what gets deployed)
├── examples/                # Reference templates (IGNORED by the system)
│   ├── basic-config.yaml    # Minimal example
│   └── full-config.yaml     # All-features example
├── tools/                   # Lambda tool source code
│   └── Pathfinder/
│       └── index.py
└── README.md                # This file
```

## Key Rules

- **Only `config.yaml` is used** — files in `examples/` are never deployed or processed.
- **No `config.yaml` = no error** — the system silently uses built-in defaults.
- **Tool source code** goes in `tools/<ToolName>/index.py` (Python 3.12, handler = `index.lambda_handler`).
- **Names are cross-references** — supervisor/sub-agent tool and sub-agent references use the `name` field to link resources together.

## Getting Started

1. Look at `examples/basic-config.yaml` for a minimal setup.
2. Look at `examples/full-config.yaml` for all available options.
3. Edit `config.yaml` to match your desired configuration.
4. Add tool source code under `tools/<ToolName>/lambda_handler.py`.
5. Run `cdk deploy` — your config will be seeded on first login.

## YAML Schema Reference

### Top-Level Keys

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `supervisor` | object | Yes | Supervisor agent configuration |
| `subAgents` | list | No | List of sub-agent definitions |
| `tools` | list | No | List of Lambda tool definitions |
| `memory` | object/null | No | Memory tool configuration |
| `guardrail` | object/null | No | Guardrail configuration |

### Supervisor

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name |
| `systemPrompt` | string | Yes | LLM system prompt |
| `modelId` | string | No | Bedrock model ID (defaults to Nova 2 Lite) |
| `subAgents` | list[string] | No | Sub-agent names to attach |
| `tools` | list[string] | No | Tool names to attach |
| `memory` | string/null | No | Memory tool name to attach |
| `guardrail` | string/null | No | Guardrail name to attach |

### Sub-Agent

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique display name |
| `systemPrompt` | string | Yes | LLM system prompt |
| `modelId` | string | No | Bedrock model ID (defaults to Nova 2 Lite) |
| `tools` | list[string] | No | Tool names this agent can use |

### Tool

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Tool name (becomes `AgentCoreGatewayTool-{name}`) |
| `sourceDir` | string | No | Path to source code dir (relative to `agent-config/`). Must contain `index.py` |

### Memory

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Memory tool display name |
| `description` | string | No | Description of what the memory stores |

### Guardrail

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Guardrail display name |
| `description` | string | No | Description |
| `blockedInputMessaging` | string | No | Message shown when input is blocked |
| `blockedOutputsMessaging` | string | No | Message shown when output is blocked |
| `contentFilters` | list | No | Content policy filters |
| `denyTopics` | list | No | Topic policy restrictions |

### Content Filter

| Field | Type | Values |
|-------|------|--------|
| `type` | string | SEXUAL, VIOLENCE, HATE, INSULTS, MISCONDUCT, PROMPT_ATTACK |
| `inputStrength` | string | NONE, LOW, MEDIUM, HIGH |
| `outputStrength` | string | NONE, LOW, MEDIUM, HIGH |

### Deny Topic

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Topic name |
| `definition` | string | Yes | What this topic covers |
| `inputAction` | string | Yes | BLOCK or LOG |
| `outputAction` | string | Yes | BLOCK or LOG |
| `examples` | list[string] | No | Example phrases that match this topic |
