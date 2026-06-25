# AWS AI League - Community Edition

A full-stack web application for AWS AI League participants to practice and collaborate outside of official AWS events. Built with CloudScape Design System, AWS CDK, Amazon Cognito, AppSync GraphQL, and a serverless backend.

## Limitations

The solution only runs in **us-east-1**

## Costs

| Item | Cost | Notes |
|------|------|-------|
| Monthly infrastructure | ~$2/month | Solution running in your account |
| Per game attempt | $0.25–$1/game | Varies depending on token usage (Nova Lite 2) |
| Fine-tuning a model | ~$30/model | Varies by configuration; service rate is $80/hour. Set a hardstop in hyperparameters to control cost |

## Features

### Core Platform
- CloudScape Design System UI with light/dark mode support (dark mode default)
- Amazon Cognito authentication with admin account auto-seeding
- User profile management (avatar selection, display name, password change)
- Navigation panel with links to community resources
- Fully automated single-command deployment via AWS CDK

### Map Builder
- Drag-and-drop tile editor for creating dungeon maps (2×2 to 12×12 grids)
- Tile palette with sprites grouped by category (Special, Challenge, Key, Door)
- Per-tile-type points/damage overrides, starting lives, and time limit settings
- Challenge assignment editor — assign questions from the question bank or auto-generate via LLM
- Path validation ensuring reachability from start to treasure
- Save/load/delete maps via DynamoDB
- Predefined competition maps (CB/Hero, London R1, London Finales) with pre-populated challenges
- Clipboard export for sharing map definitions

### Agentic Game Engine
- **Gameplay Page** — Play dungeon maps with animated champion movement, real-time combat log, and score tracking
  - Map selection from saved maps and predefined competition maps
  - Navigation prompt input for AI agent pathfinding
  - Polling-based event replay with type-specific animation delays
  - Path overlay visualization (white semi-transparent, opacity increases on revisits)
  - Consumed tile rendering and game-over modal with score breakdown
- **Leaderboard Page** — Per-map ranked leaderboard with best/last score tracking
- **Submission History Page** — Per-map submission history with score breakdowns
- **Configuration Page** — LLM model selection per purpose (challenge generation, grading, commentary)
  - Amazon Nova (Micro, Lite, Pro), DeepSeek, Meta Llama, Mistral, and Anthropic Claude families
  - Wealth warning about AWS credits coverage and cost responsibility
- **Agent Builder Page** — Configure supervisor agents, sub-agents, and tools from a single UI
  - Supervisor agent configuration: name, system prompt, model selection
  - Sub-agent management: create, edit, delete with their own model/prompt/tools
  - Tool attachments: Lambda tools, memory, guardrail on supervisor or sub-agents
  - Wealth warning banner about AWS credits and Anthropic model costs
- **AgentCore Runtime Integration** — Full agent orchestration via Amazon Bedrock AgentCore
  - Supervisor agent delegates pathfinding to sub-agent via Strands SDK tool_use
  - Sub-agent calls Pathfinder Lambda via AgentCore Gateway (MCP protocol)
  - Container-based runtime built via CodeBuild, pushed to ECR, deployed as AgentCore Runtime
  - Direct MCP tool call fallback for reliable pathfinding (bypasses LLM truncation)
  - Retry on empty response for cold-start resilience (up to 3 attempts)
- **Gameplay Integration** — Animated game replay with AgentCore agent responses
  - Full navigation prompt shown in combat log (fixed preamble + user prompt)
  - Challenge Q&A shown in combat log (AskChallenge → AnswerChallenge → Win/LoseChallenge)
  - Tile consumption synced with avatar movement during replay animation
  - Avatar moves onto wall tile before game-over
  - Planned path overlay shown before replay starts
- **Model Selection** — Amazon Nova (Micro, Lite, Pro), DeepSeek, Meta Llama, Mistral, Anthropic Claude
  - Claude models marked with ⚠️ "not covered by AWS credits" warning
  - Default: Amazon Nova Lite (covered by AWS credits)
- **Lambda Tool Registration** — Register existing Lambda ARNs as agent tools
  - Default **Pathfinder** tool: BFS with swift (shortest path) and get_coins (greedy coin collection) strategies
- **Memory Tool Management** — Create and attach memory instances for persistent agent recall
- **Guardrail Management** — Create and edit guardrails with:
  - Content policy filters (VIOLENCE, HATE, SEXUAL, INSULTS) with per-category strength
  - Topic policy deny list with custom topics and sample phrases
  - Configurable blocked input/output messaging
  - Guardrail grading: only active guardrail intervention counts as success (empty response = failure)
- **Agent Versioning** — Versions captured on leaderboard submission with score and config history
- **Cognito Authentication** — Per-user agent configurations; Phase 2 mutations require JWT auth

### Game Engine Backend
- AppSync GraphQL API with API Key authentication
- Python Lambda resolver handling all game logic
- Challenge grading with 4 strategies: exact_match, contains_match, json_exact_match, guardrail_block
- Score calculation: challenge points + coin points + treasure bonus + lives bonus + token bonus
- Custom model reduction for token penalty (fine-tuned models reduce token penalty by 50-95%)
- Door/key mechanics, passive tiles (coins, spikes), and wall collision detection
- Challenge generation via Amazon Bedrock LLMs

## Architecture

```
Browser → CloudFront → S3 (static assets + settings.json + aws-exports.json)
                     → API Gateway /api/* → Lambda (Node.js) → DynamoDB (Maps, Profiles)
                     → AppSync GraphQL → Lambda (Python) → DynamoDB (GameSessions, Leaderboard, Submissions, AgentConfigurations)
                                                         → Amazon Bedrock (LLM invocations)
                                                         → Game Runner Lambda (async, 10-min timeout)
                                                             → AgentCore Runtime (container)
                                                                 → Strands Agent (supervisor)
                                                                     → Sub-agent tool → Strands Agent (pathfinder)
                                                                         → AgentCore Gateway (MCP)
                                                                             → Pathfinder Lambda (BFS)

AgentCore Runtime: ECR container built via CodeBuild, deployed as BedrockAgentCore Runtime
AgentCore Gateway: MCP protocol bridge to Lambda tools (Pathfinder)
Cognito User Pool (authentication)
Custom Resource Lambdas (admin seeding, container build trigger)
```

- **Frontend**: Vite + React 19 + TypeScript + CloudScape components
- **REST Backend**: API Gateway + Lambda (Node.js 22) + DynamoDB
- **GraphQL Backend**: AppSync + Lambda (Python 3.12) + DynamoDB + Amazon Bedrock
- **Agent Runtime**: AgentCore Runtime (Python container) + Strands SDK + MCP
- **Auth**: Amazon Cognito (SRP auth flow, no client secret)
- **Hosting**: S3 + CloudFront (HTTPS, SPA routing)
- **Infrastructure**: AWS CDK v2 (TypeScript)

## Prerequisites

1. An [AWS account](https://aws.amazon.com/premiumsupport/knowledge-center/create-and-activate-aws-account/)
2. `AdministratorAccess` policy granted to your AWS account
3. [Node.js 22+](https://nodejs.org/en/download/) installed
4. [Python 3.12+](https://www.python.org/downloads/) installed (for agentic API Lambda)
5. [AWS CLI](https://aws.amazon.com/cli/) installed and configured
6. [AWS CDK CLI](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) installed (`npm install -g aws-cdk`)
7. [Docker](https://docs.docker.com/get-docker/) installed (used for frontend bundling during CDK synthesis)

## Deploy

```bash
# 1. Clone the repository
git clone https://github.com/aws-ai-community/ai-league-community-edition.git
cd ai-league-community-edition

# 2. Install dependencies
npm install

# 3. Bootstrap CDK (one-time per account/region)
npx cdk bootstrap aws://<ACCOUNT_ID>/<region>

# 4. Deploy
CDK_DEFAULT_REGION=<region> npx cdk deploy
```

That's it. CDK automatically:
- Builds the frontend during synthesis
- Deploys static assets, runtime config (`aws-exports.json`), and GraphQL settings (`settings.json`) to S3
- Creates all infrastructure (Cognito, DynamoDB tables, API Gateway, AppSync, Lambdas, CloudFront)
- Seeds an admin account with a generated password

### Stack Outputs

After deployment, CDK prints:

| Output | Description |
|--------|-------------|
| `UserInterfaceDomainName` | Your app URL (open in browser) |
| `AdminPassword` | Generated admin password (first deploy only) |

### First Login

1. Open the `UserInterfaceDomainName` URL
2. Sign in with:
   - **Email**: `admin@aileague.community`
   - **Password**: the `AdminPassword` from stack outputs

## Project Structure

```
ai-league-community-edition/
├── frontend/                 # Vite + React + CloudScape frontend
│   ├── src/
│   │   ├── App.tsx           # Root component with routing and auth gating
│   │   ├── config.ts         # Runtime config loader (aws-exports.json)
│   │   ├── components/
│   │   │   ├── NavigationPanel.tsx
│   │   │   ├── ProfilePage.tsx
│   │   │   ├── map-builder/  # Map Builder components
│   │   │   │   ├── MapBuilderPage.tsx
│   │   │   │   ├── MapGrid.tsx
│   │   │   │   ├── TilePalette.tsx
│   │   │   │   ├── MapSettings.tsx
│   │   │   │   ├── ChallengeEditor.tsx
│   │   │   │   ├── pathValidation.ts
│   │   │   │   └── tileData.ts
│   │   │   └── agentic/      # Agentic Game Engine pages
│   │   │       ├── AgentBuilderPage.tsx
│   │   │       ├── GameplayPage.tsx
│   │   │       ├── LeaderboardPage.tsx
│   │   │       ├── SubmissionHistoryPage.tsx
│   │   │       └── ConfigurationPage.tsx
│   │   ├── contexts/
│   │   │   ├── AuthProvider.tsx
│   │   │   ├── ProfileContext.tsx
│   │   │   └── MapContext.tsx
│   │   ├── services/
│   │   │   ├── profileService.ts
│   │   │   ├── mapsApi.ts
│   │   │   ├── settingsLoader.ts
│   │   │   └── graphqlClient.ts
│   │   └── data/
│   │       ├── questionBank.ts
│   │       └── predefinedMaps.ts
│   ├── vite.config.ts
│   └── vitest.config.ts
├── infrastructure/           # AWS CDK stack
│   ├── bin/app.ts
│   ├── graphql/
│   │   └── schema.graphql    # AppSync GraphQL schema
│   ├── lib/
│   │   └── cdk-stack.ts      # All infrastructure resources
│   └── test/
│       └── cdk-stack.test.ts # CDK assertion tests
├── lambda/                   # Lambda function handlers
│   ├── admin-seed/index.ts   # Admin account seeding (Custom Resource)
│   ├── profile-api/index.ts  # GET/PUT /profile handler
│   ├── maps-api/index.ts     # Maps CRUD handler
│   ├── agent-runtime/        # AgentCore container (Python)
│   │   ├── Dockerfile
│   │   ├── main_agent.py     # AgentCore Runtime entrypoint
│   │   ├── orchestrator_agent.py  # Supervisor agent with sub-agent tools
│   │   ├── sub_agent.py      # Sub-agent with direct MCP pathfinder call
│   │   ├── agent_utils.py    # Region config, STS, SageMaker helpers
│   │   └── requirements.txt  # strands-agents, bedrock-agentcore, mcp
│   ├── agentic-api/          # Agentic Game Engine (Python)
│   │   ├── index.py          # AppSync resolver router
│   │   ├── game_runner.py    # Game session orchestration (v1 + v2)
│   │   ├── game_runner_handler.py  # Async game runner Lambda
│   │   ├── agent_config_handlers.py  # CRUD for supervisor/sub-agents/tools
│   │   ├── agentcore_client.py  # AgentCore Runtime invocation client
│   │   ├── path_parser.py    # Parse agent response into navigation path
│   │   ├── prompt_formatter.py  # Build navigation prompt from map data
│   │   ├── score_calculator.py
│   │   ├── challenge_grader.py
│   │   ├── challenge_generator.py
│   │   ├── config_utils.py   # LLM configuration resolution
│   │   └── tests/            # Python property-based tests (hypothesis)
│   └── pathfinder-tool/      # Pathfinder Lambda tool
│       └── index.py          # BFS pathfinding (swift + get_coins strategies)
├── tests/                    # Frontend test suites
│   ├── unit/                 # Example-based unit tests
│   └── property/             # Property-based tests (fast-check)
├── cdk.json
├── package.json
└── vitest.config.ts
```

## Running Tests

```bash
# Run all frontend tests (unit + property-based)
npm test

# Run Python backend tests
cd lambda/agentic-api && python3 -m pytest tests/ -v

# Run CDK infrastructure tests
cd infrastructure && npm test
```

## Tear Down

```bash
CDK_DEFAULT_REGION=<region> npx cdk destroy
```

This removes all deployed resources including the Cognito User Pool, DynamoDB tables, and all user data.

## Roadmap

- **Phase 4**: Advanced Scoring — Model Workshop, advanced leaderboard features, submission flow

## License

See [LICENSE](LICENSE) for details.
