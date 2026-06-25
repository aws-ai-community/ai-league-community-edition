# Estimated Costs

Detailed cost breakdown for the AI League Community Edition by service.

> **Note**: These are estimates based on AWS published pricing (us-east-1, June 2026). Actual costs depend on usage patterns. Many services have free tiers that reduce costs significantly for light usage.

---

## Monthly Infrastructure (Idle)

The base cost of keeping the solution deployed with no active usage.

| Service | Resource | Monthly Cost | Notes |
|---------|----------|-------------|-------|
| CloudFront | Distribution | ~$0.00 | 1TB free tier; minimal traffic for practice app |
| S3 | Frontend hosting + artifacts | ~$0.05 | A few MB of static assets |
| DynamoDB | 6 tables (on-demand) | ~$0.00 | Pay-per-request; no cost when idle |
| AppSync | GraphQL API | ~$0.00 | $4/million queries; negligible at low volume |
| Cognito | User Pool | ~$0.00 | First 50,000 MAUs free |
| Lambda | 5 functions (idle) | ~$0.00 | No cost when not invoked |
| ECR | Container image (~200MB) | ~$0.02 | $0.10/GB/month storage |
| AgentCore Runtime | Container (idle) | ~$0.00 | No charge when not processing requests |
| AgentCore Gateway | MCP Gateway | ~$0.00 | No idle cost |
| SageMaker | Domain + User Profile | ~$0.00 | No cost when Code Editor is stopped |
| API Gateway | REST API | ~$0.00 | $3.50/million requests; negligible at low volume |
| CloudWatch | Logs | ~$0.50 | Log ingestion + storage from Lambda/CodeBuild |
| VPC | SageMaker VPC (no NAT) | ~$0.00 | Public subnets only, no NAT gateway |
| CodeBuild | Build project (idle) | ~$0.00 | Only charged per build minute |
| **Total** | | **~$0.50–$2.00** | Mostly CloudWatch logs |

---

## Per Game Attempt

Cost breakdown for a single game play (one map run with agent invocation).

| Service | Operation | Cost per Game | Notes |
|---------|-----------|--------------|-------|
| Amazon Bedrock | Nova Lite 2 inference | ~$0.10–$0.50 | ~2000-8000 input tokens + ~200-500 output tokens per invocation. Supervisor + sub-agent = 2 LLM calls. $0.06/1M input, $0.24/1M output |
| Amazon Bedrock | Challenge generation (if map has challenges) | ~$0.05–$0.20 | 1-6 challenges per game, each requiring an LLM call |
| AgentCore Runtime | Container invocation | ~$0.00 | Included in Bedrock pricing |
| Lambda | Game runner + agentic API | ~$0.00 | ~15s execution × 512MB ≈ $0.0001 |
| DynamoDB | Reads/writes | ~$0.00 | ~20 operations ≈ $0.000025 |
| AppSync | GraphQL queries | ~$0.00 | ~10 queries ≈ $0.00004 |
| **Total** | | **~$0.15–$0.70** | Dominated by Bedrock LLM costs |

### Model-specific estimates per game

| Model | Estimated Cost/Game | Notes |
|-------|-------------------|-------|
| Amazon Nova Lite 2 | $0.15–$0.40 | Default, cheapest option |
| Amazon Nova Pro 2 | $0.40–$1.00 | Higher quality, higher cost |
| Claude Haiku 4.5 | $0.50–$1.50 | Not covered by AWS credits |
| Custom fine-tuned model | $0.15–$0.40 + deployment cost | Same inference pricing as base model |

---

## Fine-Tuning a Model

Cost breakdown for training a custom model via SageMaker RLVR.

| Service | Operation | Cost | Notes |
|---------|-----------|------|-------|
| SageMaker | Model customization (serverless) | **$80/hour** | Billed per second while training. Set `max_runtime_in_seconds` in hyperparameters as a hard stop |
| S3 | Training data storage | ~$0.02 | A few MB of JSONL files |
| Lambda | Reward function execution | ~$0.01–$0.05 | Invoked per training sample during RLVR |
| Bedrock | Custom model deployment (provisioned) | Varies | Charged per model-unit-hour while deployed |
| **Total (typical training)** | | **~$20–$40** | ~20-30 minutes training for small model (Qwen 3 0.6B) with 500 samples |

### Training time estimates

| Configuration | Estimated Duration | Estimated Cost |
|---------------|-------------------|----------------|
| 500 samples, 1 epoch, Qwen 3 0.6B | ~15–20 min | ~$20–$27 |
| 500 samples, 3 epochs, Qwen 3 0.6B | ~45–60 min | ~$60–$80 |
| 1000 samples, 1 epoch, Qwen 3 0.6B | ~25–35 min | ~$33–$47 |

### Deployment costs (after training)

| Resource | Cost | Notes |
|----------|------|-------|
| Bedrock Custom Model Deployment | Varies by model unit | Charged while deployed; undeploy when not in use |

> **Important**: Always set a `max_runtime_in_seconds` hard stop in your training hyperparameters to prevent runaway costs. Use the "Undeploy" button in the Fine-Tuning page when you're done testing.

---

## Cost Optimisation Tips

1. **Stop the SageMaker Code Editor** when not actively editing Lambda tools (saves ~$0.05/hour for ml.t3.medium)
2. **Undeploy custom models** when not actively playing games with them
3. **Use Nova Lite 2** as your default model — it's the cheapest and covered by AWS credits
4. **Set training hard stops** via `max_runtime_in_seconds` hyperparameter
5. **Use "Reset Configuration"** to clean up all deployed models when done experimenting
6. **Run `cdk destroy`** when you're finished with the solution entirely — all resources including Bedrock deployments are automatically cleaned up

---

## Free Tier Coverage

Many services used by this solution fall within AWS Free Tier limits for light usage:

| Service | Free Tier Allowance |
|---------|-------------------|
| Lambda | 1M requests + 400,000 GB-seconds/month |
| DynamoDB | 25 WCU + 25 RCU + 25GB storage |
| S3 | 5GB storage + 20,000 GET + 2,000 PUT |
| CloudFront | 1TB transfer + 10M requests |
| AppSync | 250,000 queries/month (12 months) |
| Cognito | 50,000 MAUs |
| API Gateway | 1M API calls (12 months) |
| CodeBuild | 100 build minutes/month |

> With free tier, the idle infrastructure cost approaches **$0/month** for a single-user practice setup.
