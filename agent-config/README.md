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
├── tools/                   # Lambda tool source code
│   └── Pathfinder/
│       └── index.py
├── examples/                # Reference configs (IGNORED by the system)
│   ├── default/             # Simple config: supervisor + pathfinder only
│   └── full-config/         # All features: 2 agents, 2 tools, memory, guardrail
└── README.md                # This file
```

## Switching Configurations

```bash
# Use the full config (memory, guardrail, CodeCalculator):
rm -rf agent-config/config.yaml agent-config/tools/
cp -r agent-config/examples/full-config/* agent-config/

# Reset to default (pathfinder only):
rm -rf agent-config/config.yaml agent-config/tools/
cp -r agent-config/examples/default/* agent-config/
```

Then deploy the config to your live environment:

```bash
# Option 1: Seed config for existing deployment (nuke and pave):
npm run seed-config -- --profile <your-aws-profile>

# Option 2: Full CDK deploy with config seeding (first deploy or rebuild):
npm run deploy:seed

# Normal CDK deploy (does NOT touch agent config):
npm run deploy
```

## Key Rules

- **Only `config.yaml` is used** — files in `examples/` are never deployed or processed.
- **No `config.yaml` = no error** — the system silently uses built-in defaults.
- **Tool source code** goes in `tools/<ToolName>/index.py` (Python 3.12, handler = `index.lambda_handler`).
- **Names are cross-references** — supervisor/sub-agent tool and sub-agent references use the `name` field to link resources together.
- **Memory names** must be alphanumeric + underscore only, no spaces (e.g. `GameMemory`).
- **Guardrail names** must be alphanumeric + hyphens + underscores only, no spaces (e.g. `GameGuardrail`).

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
| `name` | string | Yes | Memory name (alphanumeric + underscore, no spaces, max 48 chars) |
| `description` | string | No | Description of what the memory stores |

### Guardrail

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Guardrail name (alphanumeric + hyphens + underscores, no spaces) |
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
