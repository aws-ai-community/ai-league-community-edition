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
| SageMaker | Code Editor (if left running) | $0.05/hour | Auto-stops after 4 hours idle; max ~$0.20 if forgotten |
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

Once trained, the custom model is imported into Bedrock and available for inference.

| Resource | Cost | Notes |
|----------|------|-------|
| Bedrock Imported Model (CMU-based) | Per-5-minute billing windows | Uses Custom Model Units (CMU). Charged in 5-min windows only when inference is active. A 0.6B model uses minimal CMUs. Scales to zero when not in use |
| Custom model storage | Small monthly fee | The imported model weights are stored in Bedrock. For a 0.6B model (~1.2 GB) this is minimal |
| Per game with imported custom model | ~$0.10–$0.30 | CMU billing per 5-min window during active inference. A single game takes seconds, so one 5-min window per session |

> **Key point**: Imported models use CMU-based billing with 5-minute granularity. If you play one game, you're charged for one 5-min window. If you don't invoke the model, there's no compute charge (only storage). Refer to the [Amazon Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) for current CMU rates.

### SageMaker Code Editor (IDE)

The Code Editor is used for editing Lambda tool code. It runs on an ml.t3.medium instance.

| Resource | Cost | Notes |
|----------|------|-------|
| ml.t3.medium (while running) | $0.05/hour | Only charged while the IDE is actively running |
| Auto-stop | After 4 hours idle | The IDE automatically stops after 4 hours of inactivity to prevent runaway costs |
| Storage (EBS) | ~$0.10/GB/month | Small volume for IDE workspace |

> **Tip**: The IDE auto-stops after 4 hours of inactivity. If you forget to stop it manually, the maximum unexpected cost is ~$0.20 before auto-stop kicks in. You can also stop it manually from the Agent Builder page.

> **Important**: Always set a `max_runtime_in_seconds` hard stop in your training hyperparameters to prevent runaway costs. Use the "Undeploy" button in the Fine-Tuning page when you're done testing.

---

## Cost Optimisation Tips

1. **Stop the SageMaker Code Editor** when not actively editing Lambda tools — it auto-stops after 4 hours idle, but you can stop it manually to save ~$0.05/hour
2. **Imported models have no idle compute cost** — CMU billing only activates during inference (5-min windows). Storage cost is minimal
3. **Use Nova Lite 2** as your default model — it's the cheapest and covered by AWS credits
4. **Set training hard stops** via `max_runtime_in_seconds` hyperparameter to prevent runaway training costs
5. **Delete unused custom models** if you no longer need them to avoid storage costs
6. **Use "Reset Configuration"** to clean up all imported models when done experimenting
7. **Run `cdk destroy`** when you're finished with the solution entirely — all resources including imported models are automatically cleaned up

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
