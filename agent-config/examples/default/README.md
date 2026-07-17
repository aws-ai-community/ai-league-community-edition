# Default Configuration

This is the simple baseline configuration that ships with AI League Community Edition.

## What's Included

- **Supervisor** — "My Agent" orchestrating one specialist agent
- **Pathfinding Specialist** — Delegates to the Pathfinder tool for BFS navigation
- **Pathfinder tool** — BFS pathfinding Lambda (swift + get_coins strategies)
- **No memory** — disabled
- **No guardrail** — disabled

## How to Use

```bash
# From the repo root:
cp -r agent-config/examples/default/* agent-config/
```

Then run `cdk deploy`. On first user login, this config will be seeded.

## Notes

- This is the same configuration that the system uses when no `config.yaml` is present (hardcoded defaults).
- Good starting point if you've been experimenting with the full config and want to reset.
- The Pathfinder tool supports two strategies: `swift` (shortest path) and `get_coins` (greedy coin collection).
