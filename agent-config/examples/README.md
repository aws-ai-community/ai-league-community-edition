# Agent Configuration Examples

These are reference configurations you can copy into the live `agent-config/` folder. Files in this `examples/` directory are **never deployed or processed** by the system.

## Available Configs

| Folder | Description |
|--------|-------------|
| `default/` | Simple setup: supervisor + Pathfinding Specialist + Pathfinder tool. No memory, no guardrail. |
| `full-config/` | All features: 2 sub-agents (Pathfinder + Code Calculator), 2 tools, memory, guardrail with content filters and deny topic. |

## Switching Configs

```bash
# From the repo root:

# Use full config (clears existing, then copies):
rm -rf agent-config/config.yaml agent-config/tools/
cp -r agent-config/examples/full-config/* agent-config/

# Reset to default (clears existing, then copies):
rm -rf agent-config/config.yaml agent-config/tools/
cp -r agent-config/examples/default/* agent-config/
```

Then run `cdk deploy`. On a fresh deployment (or after wiping DynamoDB), the new config will be seeded on first user login.

## Creating Your Own

1. Start from one of the examples above
2. Edit `config.yaml` to add/remove sub-agents, tools, memory, or guardrails
3. Add tool source code under `tools/<ToolName>/index.py`
4. Copy into `agent-config/` and deploy

See `agent-config/README.md` for the full YAML schema reference.
