# AWS AI League - Community Edition

A full-stack web application for AWS AI League participants to practice and collaborate outside of official AWS events. Built with CloudScape Design System, AWS CDK, Amazon Cognito, and a serverless backend.

## Features

- CloudScape Design System UI with light/dark mode support
- Amazon Cognito authentication with admin account auto-seeding
- User profile management (avatar selection, display name, password change)
- Navigation panel with links to community resources
- Fully automated single-command deployment via AWS CDK

## Architecture

```
Browser → CloudFront → S3 (static assets)
                     → API Gateway /api/* → Lambda → DynamoDB
                     
Cognito User Pool (authentication)
Custom Resource Lambda (admin account seeding)
```

- **Frontend**: Vite + React 19 + TypeScript + CloudScape components
- **Backend**: API Gateway + Lambda (Node.js 22) + DynamoDB
- **Auth**: Amazon Cognito (SRP auth flow, no client secret)
- **Hosting**: S3 + CloudFront (HTTPS, SPA routing)
- **Infrastructure**: AWS CDK v2 (TypeScript)

## Prerequisites

1. An [AWS account](https://aws.amazon.com/premiumsupport/knowledge-center/create-and-activate-aws-account/)
2. `AdministratorAccess` policy granted to your AWS account
3. [Node.js 22+](https://nodejs.org/en/download/) installed
4. [AWS CLI](https://aws.amazon.com/cli/) installed and configured
5. [AWS CDK CLI](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) installed (`npm install -g aws-cdk`)
6. [Docker](https://docs.docker.com/get-docker/) installed (used as fallback for frontend bundling during CDK synthesis)

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
- Deploys static assets and runtime config (`aws-exports.json`) to S3
- Creates all infrastructure (Cognito, DynamoDB, API Gateway, Lambda, CloudFront)
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
│   │   ├── components/       # UI components
│   │   │   ├── ThemeProvider.tsx
│   │   │   ├── UserHeader.tsx
│   │   │   ├── NavigationPanel.tsx
│   │   │   ├── ProfilePage.tsx
│   │   │   └── AvatarGrid.tsx
│   │   ├── contexts/
│   │   │   └── AuthProvider.tsx
│   │   ├── services/
│   │   │   └── profileService.ts
│   │   └── assets/avatars/   # SVG avatar images
│   └── vite.config.ts
├── infrastructure/           # AWS CDK stack
│   ├── bin/app.ts
│   └── lib/
│       ├── cdk-stack.ts      # All infrastructure resources
│       └── utils.ts          # Build helpers
├── lambda/                   # Lambda function handlers
│   ├── admin-seed/index.ts   # Admin account seeding (Custom Resource)
│   └── profile-api/index.ts  # GET/PUT /profile handler
├── tests/                    # Test suites
│   ├── unit/                 # Example-based unit tests
│   └── property/             # Property-based tests (fast-check)
├── cdk.json
├── package.json
└── vitest.config.ts
```

## Tear Down

```bash
CDK_DEFAULT_REGION=<region> npx cdk destroy
```

This removes all deployed resources including the Cognito User Pool and all user accounts.

## License

See [LICENSE](LICENSE) for details.
