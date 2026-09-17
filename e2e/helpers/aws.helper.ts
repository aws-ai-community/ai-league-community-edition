import { LambdaClient, UpdateFunctionCodeCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import JSZip from 'jszip';

/**
 * Creates a zip buffer containing a Python Lambda handler file.
 * The code is placed at `index.py` inside the zip archive.
 */
export async function createZipBuffer(code: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('index.py', code);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer;
}

/**
 * Updates a Lambda function's code by packaging the provided Python source
 * into a zip and deploying it via the AWS SDK.
 *
 * Used in agent-builder tests to simulate editing tool code via the IDE
 * (Requirement 3.6).
 */
export async function updateLambdaToolCode(
  functionName: string,
  code: string,
): Promise<void> {
  const client = new LambdaClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  // Wait for the Lambda function to become Active (may be in Pending state after creation)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const resp = await client.send(new GetFunctionCommand({ FunctionName: functionName }));
      if (resp.Configuration?.State === 'Active') break;
    } catch {
      // Function not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const zipBuffer = await createZipBuffer(code);

  await client.send(
    new UpdateFunctionCodeCommand({
      FunctionName: functionName,
      ZipFile: zipBuffer,
    }),
  );
}

/**
 * Directly triggers gateway-schema regeneration for a tool by invoking the
 * agentic-api resolver Lambda with the same synthetic payload the production
 * Schema Generator Lambda uses (see infrastructure LambdaCodeUpdateRule).
 *
 * In production, schema regeneration is triggered asynchronously via
 * CloudTrail -> EventBridge -> Schema Generator Lambda after UpdateFunctionCode.
 * That CloudTrail delivery can take several minutes, which is far too slow and
 * non-deterministic for an e2e test. Invoking the resolver directly performs the
 * exact same regeneration work without waiting for CloudTrail, making the test
 * deterministic. `functionName` is the full `AgentCoreGatewayTool-<name>`.
 */
export async function triggerSchemaRegeneration(functionName: string): Promise<void> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const client = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const toolName = functionName.replace('AgentCoreGatewayTool-', '');
  const payload = {
    info: { fieldName: 'RegenerateToolSchema' },
    identity: { claims: { 'cognito:username': 'system' } },
    arguments: { name: toolName },
  };
  await client.send(
    new InvokeCommand({
      FunctionName: 'ai-league-agentic-api',
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
}

/**
 * Polls a verification function until it returns true or the timeout is reached.
 * Useful for verifying the MCP Gateway target schema has been regenerated
 * after a Lambda code update (schema regeneration timeout: 60s).
 */
export async function waitForSchemaRegeneration(
  verifyFn: () => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 60_000, intervalMs = 5_000 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await verifyFn();
    if (result) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Schema regeneration verification timed out after ${timeoutMs}ms`,
  );
}
