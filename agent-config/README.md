# Full Configuration Example

This folder contains a complete, working agent-config setup that you can copy directly into the `agent-config/` folder at the repo root.

## What's Included

- **Supervisor** — "Dungeon Master" orchestrating two specialist agents
- **Pathfinding Specialist** — Delegates to the Pathfinder tool for BFS navigation
- **Code Calculator** — Writes and executes Python code for mathematical tasks
- **Pathfinder tool** — BFS pathfinding Lambda (swift + get_coins strategies)
- **CodeCalculator tool** — Executes Python code and returns printed output
- **Memory** — Game Memory for storing navigation history across sessions
- **Guardrail** — Content Safety with all 6 filter types enabled + a deny topic

## How to Use

```bash
# From the repo root:
cp -r agent-config/examples/full-config/* agent-config/
```

Then run `cdk deploy`. On first user login, the full config will be seeded.

## Notes

- The CodeCalculator tool executes arbitrary Python via `exec()`. The sub-agent generates verbose code and sends it for execution.
- The guardrail has one example of each content filter type at varying strengths, plus a deny topic for off-topic requests.
- Memory uses AgentCore Memory with 365-day event expiry.
