# E2E Tests

End-to-end tests for AI League Community Edition using [Playwright](https://playwright.dev/). Tests run against a fully deployed stack and cover the complete user journey from login through gameplay, agent configuration, and leaderboard submission.

## Running Tests Locally

### Prerequisites

- Node.js 22+
- A deployed AI League Community Edition stack (with its CloudFront URL)
- Admin credentials for the deployed stack

### Install dependencies

```bash
npm ci
npx playwright install --with-deps chromium
```

### Run the tests

```bash
BASE_URL=https://your-cloudfront-url.cloudfront.net \
ADMIN_EMAIL=admin@aileague.community \
ADMIN_PASSWORD=your-admin-password \
AWS_REGION=us-east-1 \
npm run e2e
```

| Variable | Description |
|----------|-------------|
| `BASE_URL` | CloudFront URL of the deployed stack (e.g. `https://d1234abcdef.cloudfront.net`) |
| `ADMIN_EMAIL` | Admin user email (created during CDK deploy) |
| `ADMIN_PASSWORD` | Admin user password (from CDK outputs) |
| `AWS_REGION` | AWS region where the stack is deployed (default: `us-east-1`) |

### View the HTML report

After tests run, open the Playwright HTML report:

```bash
npx playwright show-report e2e/playwright-report
```

## CI Pipeline (GitHub Actions)

The E2E workflow (`.github/workflows/e2e.yml`) runs automatically on:

- Pull request creation/update
- Push to `main`

The pipeline deploys a fresh stack, runs all tests, and destroys the stack regardless of outcome.

### Required GitHub Secrets

Configure these in your repository settings under **Settings > Secrets and variables > Actions**:

| Secret | Description |
|--------|-------------|
| `E2E_AWS_ACCESS_KEY_ID` | IAM access key ID for the test AWS account |
| `E2E_AWS_SECRET_ACCESS_KEY` | IAM secret access key for the test AWS account |
| `E2E_AWS_ACCOUNT_ID` | AWS account number used for CDK bootstrap |

### IAM Policy Requirements

The IAM user/role associated with the access key needs sufficient permissions to:

- Deploy and destroy the full CDK stack (CloudFormation, IAM, Lambda, DynamoDB, AppSync, Cognito, CloudFront, S3, SageMaker, Bedrock)
- Bootstrap CDK (`cdk bootstrap`)
- Describe CloudFormation stacks (for destroy verification)

Recommended approach: use a dedicated test AWS account with an IAM user that has `AdministratorAccess` scoped to that account. This avoids maintaining a complex least-privilege policy that must be updated whenever the stack changes.

**Important:** The test account should be completely isolated from production. The stack is deployed and destroyed on every run, so no persistent data should exist in this account.

Minimal trust boundary:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-east-1"
        }
      }
    }
  ]
}
```

> If `AdministratorAccess` is too broad for your organization, scope the policy to the services used by the stack: CloudFormation, IAM, Lambda, DynamoDB, AppSync, Cognito, CloudFront, S3, SageMaker, Bedrock, EventBridge, SNS, SQS, and SSM.

### Viewing Playwright Reports from CI

1. Go to the **Actions** tab in your GitHub repository
2. Select the failed (or passed) E2E workflow run
3. Scroll to the **Artifacts** section at the bottom of the run summary
4. Download the `playwright-report` artifact
5. Extract the zip and open `e2e/playwright-report/index.html` in your browser

The artifact includes:

- **HTML report** — interactive test results with step-by-step traces
- **Screenshots** — captured on test failure
- **Traces** — full Playwright trace files (recorded on first retry) that can be viewed at [trace.playwright.dev](https://trace.playwright.dev/)
- **Videos** — retained on failure for visual debugging

To view a trace file locally:

```bash
npx playwright show-trace e2e/test-results/<test-name>/trace.zip
```

## Cost Estimate

Each full E2E run costs approximately **$2-5**, which includes:

- CDK stack deploy and destroy
- ~5 game plays using Amazon Nova Lite
- SageMaker IDE start/stop (~$0.05/minute)
- Bedrock model invocations
- Associated AWS service usage (DynamoDB, Lambda, CloudFront, etc.)

With typical development activity (2-4 runs per PR):

- **Per PR:** ~$4-20
- **Monthly (active development):** ~$50-100

The stack is always destroyed after tests complete, so there are no ongoing costs between runs.

## Project Structure

```
e2e/
├── playwright.config.ts         # Playwright configuration
├── fixtures/                    # Auth setup and shared fixtures
├── pages/                       # Page Object Models
├── tests/                       # Test specs
├── helpers/                     # AWS SDK helpers, custom waitFor utilities
├── playwright-report/           # Generated HTML report (gitignored)
└── test-results/                # Test artifacts (gitignored)
```

## Test Execution Order

Tests run sequentially in dependency order:

1. **auth** — login, profile setup
2. **agent-builder** — create tools/agents (needed for gameplay)
3. **gameplay** — play a game (needed for leaderboard)
4. **leaderboard** — submit and verify scores
5. **configuration** — model selection, reset
6. **sagemaker** — IDE start/stop
7. **fine-tuning** — page load, Studio link
8. **map-builder** — create/save/load/delete maps

## Troubleshooting

### Tests timeout waiting for game to complete

Game completion depends on LLM responses and can take up to 5 minutes. If tests consistently timeout, check that the deployed stack has proper Bedrock model access configured.

### Authentication failures

Verify that `ADMIN_EMAIL` and `ADMIN_PASSWORD` match the credentials created during CDK deploy. The password is available in the CDK outputs JSON.

### AWS credential errors in agent-builder tests

The Lambda tool update test requires valid AWS credentials in the environment. Ensure `AWS_REGION` is set and the credentials have Lambda update permissions.
