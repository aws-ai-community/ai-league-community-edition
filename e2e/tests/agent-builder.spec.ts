import { test, expect } from '@playwright/test';
import { AgentBuilderPage } from '../pages/agent-builder.page';
import { updateLambdaToolCode } from '../helpers/aws.helper';
import { TIMEOUTS } from '../helpers/wait.helper';

test.describe.serial('Agent Builder', () => {
  let agentBuilderPage: AgentBuilderPage;

  const subAgentName = `E2E-SubAgent-${Date.now()}`;
  const subAgentPrompt = 'You are a helpful test sub-agent.';
  const editedSubAgentName = `${subAgentName}-Edited`;

  const lambdaToolName = `e2e-tool-${Date.now()}`;
  const memoryToolName = `e2eMemory${Date.now()}`;
  const guardrailName = `e2e-guardrail-${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    agentBuilderPage = new AgentBuilderPage(page);
    await agentBuilderPage.goto();
  });

  test('default supervisor config is visible', async () => {
    await agentBuilderPage.verifySupervisorVisible();
    const name = await agentBuilderPage.getSupervisorName();
    expect(name).toBeTruthy();
  });

  test('create sub-agent appears in list', async () => {
    await agentBuilderPage.createSubAgent(subAgentName, subAgentPrompt);
    await agentBuilderPage.verifySubAgentExists(subAgentName);
  });

  test('edit sub-agent changes persist', async () => {
    await agentBuilderPage.editSubAgent(subAgentName, editedSubAgentName);
    await agentBuilderPage.verifySubAgentExists(editedSubAgentName);
  });

  test('delete sub-agent removed from list', async () => {
    await agentBuilderPage.deleteSubAgent(editedSubAgentName);
    await agentBuilderPage.verifySubAgentRemoved(editedSubAgentName);
  });

  test('create Lambda tool appears in tools list', async () => {
    await agentBuilderPage.createLambdaTool(lambdaToolName);
    await agentBuilderPage.verifyLambdaToolExists(lambdaToolName);
  });

  test('update Lambda tool code via AWS SDK regenerates schema', async () => {
    test.setTimeout(120_000); // Schema generation can take up to 60s
    const functionName = `AgentCoreGatewayTool-${lambdaToolName}`;

    const updatedCode = `
import json

def handler(event, context):
    """Updated tool handler for e2e testing.
    
    This function echoes back the input with metadata.
    """
    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": "Updated by e2e test",
            "input": event,
            "version": "2.0"
        })
    }
`;

    // Update the Lambda function code directly via AWS SDK
    await updateLambdaToolCode(functionName, updatedCode);

    // Verify the code update took effect
    const { LambdaClient, GetFunctionCommand } = await import('@aws-sdk/client-lambda');
    const client = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const result = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
    expect(result.Configuration?.State).toBe('Active');
    expect(result.Configuration?.LastModified).toBeTruthy();

    // Now verify the AgentCore Gateway target was created/updated for this tool.
    // The schema is only created when the Lambda is edited and redeployed (not on initial creation).
    // Use AWS CLI since there's no JS SDK for bedrock-agentcore-control.
    const { execSync } = await import('child_process');
    const region = process.env.AWS_REGION || 'us-east-1';

    // Find the gateway ID
    const gatewaysJson = execSync(
      `aws bedrock-agentcore-control list-gateways --region ${region} --output json`,
      { encoding: 'utf-8', timeout: 30_000 },
    );
    const gateways = JSON.parse(gatewaysJson);
    const gateway = gateways.items?.find((g: { name?: string }) => g.name === 'communityGateway');
    expect(gateway).toBeTruthy();
    const gatewayId = gateway.gatewayId;

    // Poll for the target to appear (schema generation is async, up to 60s)
    const deadline = Date.now() + 60_000;
    let targetFound = false;
    while (Date.now() < deadline) {
      const targetsJson = execSync(
        `aws bedrock-agentcore-control list-gateway-targets --gateway-identifier ${gatewayId} --region ${region} --output json`,
        { encoding: 'utf-8', timeout: 30_000 },
      );
      const targets = JSON.parse(targetsJson);
      targetFound = targets.items?.some((t: { name?: string }) => t.name === functionName) ?? false;
      if (targetFound) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(targetFound).toBe(true);
  });

  test('delete Lambda tool removed from list', async () => {
    await agentBuilderPage.deleteLambdaTool(lambdaToolName);
    await agentBuilderPage.verifyLambdaToolRemoved(lambdaToolName);
  });

  test('create memory tool appears in selector and becomes ACTIVE', async () => {
    await agentBuilderPage.createMemoryTool(memoryToolName, 'E2E test memory tool');
    await agentBuilderPage.verifyMemoryToolInSelector(memoryToolName);
    // Verify memory is in CREATING or ACTIVE status (full activation takes minutes)
    await agentBuilderPage.waitForMemoryActive(memoryToolName);
  });

  test('create guardrail appears in guardrail selector', async () => {
    await agentBuilderPage.createGuardrail(guardrailName, 'E2E test guardrail');
    await agentBuilderPage.verifyGuardrailInSelector(guardrailName);
  });

  test('attach sub-agent and tool to supervisor saves successfully', async () => {
    // Create a fresh sub-agent and tool to attach
    const attachSubAgentName = `E2E-Attach-Agent-${Date.now()}`;
    const attachToolName = `e2e-attach-tool-${Date.now()}`;

    await agentBuilderPage.createSubAgent(attachSubAgentName, 'Sub-agent for attachment test');
    await agentBuilderPage.createLambdaTool(attachToolName);

    // Attach both to the supervisor
    await agentBuilderPage.attachSubAgentToSupervisor(attachSubAgentName);
    await agentBuilderPage.attachLambdaToolToSupervisor(attachToolName);

    // Save supervisor configuration
    await agentBuilderPage.saveSupervisor();
    await agentBuilderPage.verifySaveSuccess();

    // Cleanup: delete the resources created for this test
    await agentBuilderPage.deleteSubAgent(attachSubAgentName);
    await agentBuilderPage.deleteLambdaTool(attachToolName);
  });

  test('cleanup: delete memory tool and guardrail', async () => {
    await agentBuilderPage.deleteMemoryTool(memoryToolName);
    await agentBuilderPage.deleteGuardrail(guardrailName);
  });
});
