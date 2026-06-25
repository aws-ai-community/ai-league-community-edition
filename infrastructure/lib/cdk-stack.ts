import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as path from 'path';
import { execSync } from 'child_process';
import { Construct } from 'constructs';
import { copyDirRecursive } from './utils';

export class CdkStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito User Pool with password policy and self-sign-up disabled
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'ai-league-community-user-pool',
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // User Pool App Client with SRP auth flow and no client secret
    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: 'ai-league-community-app-client',
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
    });

    // Admin group in the User Pool
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrator group with full access',
    });

    // DynamoDB UserProfiles table
    const userProfilesTable = new dynamodb.Table(this, 'UserProfilesTable', {
      tableName: 'ai-league-community-user-profiles',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB Maps table
    const mapsTable = new dynamodb.Table(this, 'MapsTable', {
      tableName: 'ai-league-community-maps',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'mapId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB AgentConfigurations table (single-table design for agentic config entities)
    const agentConfigurationsTable = new dynamodb.Table(this, 'AgentConfigurationsTable', {
      tableName: 'ai-league-community-agent-configurations',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    agentConfigurationsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // DynamoDB GameSessions table
    const gameSessionsTable = new dynamodb.Table(this, 'GameSessionsTable', {
      tableName: 'ai-league-community-game-sessions',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB AgenticLeaderboard table
    const agenticLeaderboardTable = new dynamodb.Table(this, 'AgenticLeaderboardTable', {
      tableName: 'ai-league-community-agentic-leaderboard',
      partitionKey: { name: 'leaderboardId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB AgenticSubmissions table
    const agenticSubmissionsTable = new dynamodb.Table(this, 'AgenticSubmissionsTable', {
      tableName: 'ai-league-community-agentic-submissions',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedTime', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================================================
    // AppSync GraphQL API for Agentic Game Engine
    // ========================================================================

    // AppSync API with API Key authentication
    // NOTE: Phase 1 uses API Key auth for simplicity (matches reference implementation).
    // This means event.identity.sub is absent, so all user-specific data (LLM config,
    // submissions, leaderboard) uses "anonymous" as userId. Phase 2 will add Cognito
    // User Pool auth as an additional auth mode, enabling per-user data isolation.
    // The API key is published via settings.json — acceptable for Phase 1 as the API
    // only exposes game logic (no sensitive data). Phase 2 will restrict mutations to
    // authenticated users via Cognito.
    const agenticApi = new appsync.GraphqlApi(this, 'AgenticApi', {
      name: 'ai-league-agentic-api',
      definition: appsync.Definition.fromFile(
        path.join(__dirname, '../graphql/schema.graphql')
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365)),
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: appsync.AuthorizationType.USER_POOL,
            userPoolConfig: {
              userPool: this.userPool,
            },
          },
        ],
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
      },
    });

    // Python Lambda function for agentic API resolver
    const agenticLambda = new lambda.Function(this, 'AgenticApiLambda', {
      functionName: 'ai-league-agentic-api',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/agentic-api')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        GAME_SESSIONS_TABLE: gameSessionsTable.tableName,
        LEADERBOARD_TABLE: agenticLeaderboardTable.tableName,
        SUBMISSIONS_TABLE: agenticSubmissionsTable.tableName,
        AGENT_CONFIGURATIONS_TABLE: agentConfigurationsTable.tableName,
        MAPS_TABLE: mapsTable.tableName,
        USER_PROFILES_TABLE: userProfilesTable.tableName,
      },
    });

    // Shared execution role for all Lambda tool functions (AgentCoreGatewayTool-*)
    const lambdaToolRole = new iam.Role(this, 'LambdaToolRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Shared execution role for all AgentCoreGatewayTool-* Lambda functions',
    });
    lambdaToolRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/AgentCoreGatewayTool-*:*`],
    }));
    lambdaToolRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:*`],
    }));

    // Pathfinder Tool Lambda — default BFS pathfinding tool for AgentCore
    const pathfinderLambda = new lambda.Function(this, 'PathfinderToolLambda', {
      functionName: 'AgentCoreGatewayTool-Pathfinder',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/pathfinder-tool')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaToolRole,
    });

    // Export Pathfinder Lambda ARN to the agentic-api Lambda
    agenticLambda.addEnvironment('PATHFINDER_LAMBDA_ARN', pathfinderLambda.functionArn);

    // Gateway IAM role — allows Gateway to invoke Lambda tool targets
    const gatewayRole = new iam.Role(this, 'AgentCoreGatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    gatewayRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:AgentCoreGatewayTool-*`],
    }));

    // AgentCore Gateway (L1 CfnResource — no L2 construct)
    const gateway = new cdk.CfnResource(this, 'AgentCoreGateway', {
      type: 'AWS::BedrockAgentCore::Gateway',
      properties: {
        Name: 'communityGateway',
        AuthorizerType: 'AWS_IAM',
        ProtocolType: 'MCP',
        RoleArn: gatewayRole.roleArn,
        Description: 'AgentCore MCP Gateway for AI League Community Edition',
      },
    });

    // Gateway Target — Pathfinder Lambda as MCP tool
    const pathfindingTarget = new cdk.CfnResource(this, 'PathfindingGatewayTarget', {
      type: 'AWS::BedrockAgentCore::GatewayTarget',
      properties: {
        GatewayIdentifier: gateway.ref,
        Name: 'AgentCoreGatewayTool-Pathfinder',
        Description: 'BFS pathfinding with swift and get_coins strategies',
        TargetConfiguration: {
          Mcp: {
            Lambda: {
              LambdaArn: pathfinderLambda.functionArn,
              ToolSchema: {
                InlinePayload: [{
                  Name: 'pathfind',
                  Description: 'Pathfinding Lambda with strategy selection. Strategies: swift (BFS shortest path to treasure, default), get_coins (greedily collect c7 coins on the way to treasure).',
                  InputSchema: {
                    Type: 'object',
                    Properties: {
                      game_map: { Type: 'string', Description: 'JSON encoded 2D array of the game map. Each cell is a string like "normal", "wall", "treasure", "c1"-"c8" etc.' },
                      start_pos: { Type: 'string', Description: 'JSON encoded start position as [row, col] array, e.g. [0,0].' },
                      strategy: { Type: 'string', Description: 'Pathfinding strategy: "swift" (shortest path to treasure) or "get_coins" (collect c7 coins then go to treasure). Default: swift.' },
                    },
                    Required: ['game_map'],
                  },
                }],
              },
            },
          },
        },
        CredentialProviderConfigurations: [{ CredentialProviderType: 'GATEWAY_IAM_ROLE' }],
      },
    });
    pathfindingTarget.addDependency(gateway);

    // Construct gateway URL and pass to agentic Lambda
    const gatewayUrl = cdk.Fn.sub(
      'https://${GatewayId}.gateway.bedrock-agentcore.${Region}.amazonaws.com/mcp',
      { GatewayId: gateway.ref, Region: cdk.Aws.REGION },
    );
    agenticLambda.addEnvironment('GATEWAY_URL', gatewayUrl.toString());

    // Grant Lambda read/write access to all agentic tables plus Maps table
    gameSessionsTable.grantReadWriteData(agenticLambda);
    agenticLeaderboardTable.grantReadWriteData(agenticLambda);
    agenticSubmissionsTable.grantReadWriteData(agenticLambda);
    agentConfigurationsTable.grantReadWriteData(agenticLambda);
    mapsTable.grantReadWriteData(agenticLambda);
    userProfilesTable.grantReadData(agenticLambda);

    // Grant Lambda permission to invoke Bedrock models
    agenticLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );

    // IAM Role for AgentCore Runtime instances (assumed by the runtime itself)
    const agentCoreRuntimeRole = new iam.Role(this, 'AgentCoreRuntimeRole', {
      roleName: 'ai-league-agentcore-runtime-role',
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'IAM role assumed by AgentCore Runtime instances',
    });

    // Grant the runtime role permissions matching reference app
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: ['*'],
    }));
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock-agentcore:InvokeGateway'],
      resources: ['*'],
    }));
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvent', 'bedrock-agentcore:GetEvent',
        'bedrock-agentcore:GetMemory', 'bedrock-agentcore:GetMemoryRecord',
        'bedrock-agentcore:ListMemoryRecords', 'bedrock-agentcore:RetrieveMemoryRecords',
        'bedrock-agentcore:DeleteMemoryRecord', 'bedrock-agentcore:CreateMemory',
      ],
      resources: ['*'],
    }));
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:ApplyGuardrail'],
      resources: ['*'],
    }));
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resources: ['*'],
    }));
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: ['*'],
    }));
    agentCoreRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
      resources: ['*'],
    }));

    // ECR repository for the agent runtime container
    const agentEcr = new ecr.Repository(this, 'AgentRuntimeECR', {
      repositoryName: 'ai-league-community-agent',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // S3 bucket for agent source code (used by CodeBuild)
    const agentRuntimeBucket = new s3.Bucket(this, 'AgentRuntimeBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Upload agent source code to S3 for CodeBuild
    const deployAgentSource = new s3deploy.BucketDeployment(this, 'DeployAgentSource', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../lambda/agent-runtime'))],
      destinationBucket: agentRuntimeBucket,
      destinationKeyPrefix: 'agent-source',
    });

    // CodeBuild role
    const codeBuildRole = new iam.Role(this, 'AgentCodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage', 'ecr:GetAuthorizationToken',
        'ecr:PutImage', 'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart', 'ecr:CompleteLayerUpload',
      ],
      resources: ['*'],
    }));
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/*`],
    }));
    agentRuntimeBucket.grantRead(codeBuildRole);

    // CodeBuild project — builds ARM64 container and pushes to ECR
    const codeBuildProject = new cdk.aws_codebuild.Project(this, 'AgentCodeBuild', {
      projectName: 'ai-league-community-agent-build',
      description: 'Build and push community agent container to ECR',
      source: cdk.aws_codebuild.Source.s3({
        bucket: agentRuntimeBucket,
        path: 'agent-source/',
      }),
      environment: {
        buildImage: cdk.aws_codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: cdk.aws_codebuild.ComputeType.SMALL,
        privileged: true,
      },
      role: codeBuildRole,
      buildSpec: cdk.aws_codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'echo "Building agent container..."',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
              'docker build -t ai-league-agent .',
              'docker tag ai-league-agent:latest $ECR_URI:latest',
            ],
          },
          post_build: {
            commands: [
              'docker push $ECR_URI:latest',
              'echo "Build completed"',
            ],
          },
        },
      }),
      environmentVariables: {
        ECR_URI: { value: agentEcr.repositoryUri },
        AWS_ACCOUNT_ID: { value: cdk.Aws.ACCOUNT_ID },
      },
      timeout: cdk.Duration.minutes(30),
    });

    // Custom resource Lambda to trigger CodeBuild and wait for completion
    const triggerBuildFn = new lambda.Function(this, 'TriggerBuildFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(14),
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import time

def handler(event, context):
    try:
        if event['RequestType'] in ['Create', 'Update']:
            codebuild = boto3.client('codebuild')
            response = codebuild.start_build(projectName=event['ResourceProperties']['ProjectName'])
            build_id = response['build']['id']
            while True:
                time.sleep(10)
                builds = codebuild.batch_get_builds(ids=[build_id])
                status = builds['builds'][0]['buildStatus']
                if status == 'SUCCEEDED':
                    cfnresponse.send(event, context, cfnresponse.SUCCESS, {'BuildId': build_id})
                    return
                elif status in ['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED']:
                    cfnresponse.send(event, context, cfnresponse.FAILED, {'Error': f'Build {status}'})
                    return
        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        cfnresponse.send(event, context, cfnresponse.FAILED, {'Error': str(e)})
`),
    });
    triggerBuildFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
      resources: [codeBuildProject.projectArn],
    }));

    const triggerBuildProvider = new cr.Provider(this, 'TriggerBuildProvider', {
      onEventHandler: triggerBuildFn,
    });

    const triggerBuild = new cdk.CustomResource(this, 'TriggerAgentBuild', {
      serviceToken: triggerBuildProvider.serviceToken,
      properties: {
        ProjectName: codeBuildProject.projectName,
        BuildTrigger: Date.now().toString(),
      },
    });
    // Explicit CloudFormation-level dependencies to ensure correct ordering
    const triggerBuildCfn = triggerBuild.node.defaultChild as cdk.CfnResource;
    const deploySourceCfn = deployAgentSource.node.findChild('CustomResource').node.defaultChild as cdk.CfnResource;
    triggerBuildCfn.addDependency(deploySourceCfn);

    // Grant runtime role ECR pull access
    agentEcr.grantPull(agentCoreRuntimeRole);

    // Create the AgentCore Runtime as a CloudFormation resource
    const agentRuntime = new cdk.CfnResource(this, 'AgentCoreRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: 'communityAgentRuntime',
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${agentEcr.repositoryUri}:latest`,
          },
        },
        RoleArn: agentCoreRuntimeRole.roleArn,
        NetworkConfiguration: { NetworkMode: 'PUBLIC' },
        ProtocolConfiguration: 'HTTP',
      },
    });
    agentRuntime.addDependency(triggerBuild.node.defaultChild as cdk.CfnResource);

    // Force AgentCore Runtime to redeploy with the latest container image after each build
    const forceRuntimeUpdateFn = new lambda.Function(this, 'ForceRuntimeUpdateFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import time

def handler(event, context):
    try:
        if event['RequestType'] in ['Create', 'Update']:
            props = event['ResourceProperties']
            client = boto3.client('bedrock-agentcore-control')
            runtime_id = props['RuntimeId']
            container_uri = props['ContainerUri']
            role_arn = props['RoleArn']

            try:
                client.update_agent_runtime(
                    agentRuntimeId=runtime_id,
                    agentRuntimeArtifact={'containerConfiguration': {'containerUri': container_uri}},
                    roleArn=role_arn,
                    networkConfiguration={'networkMode': 'PUBLIC'},
                )
                # Wait for runtime to become READY (up to 3 minutes)
                for _ in range(18):
                    time.sleep(10)
                    resp = client.list_agent_runtimes()
                    for rt in resp.get('agentRuntimes', []):
                        if rt['agentRuntimeId'] == runtime_id:
                            if rt['status'] == 'READY':
                                cfnresponse.send(event, context, cfnresponse.SUCCESS, {'Status': 'READY'})
                                return
                            break
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {'Status': 'TIMEOUT'})
            except Exception as e:
                print(f'Update failed: {e}')
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {'Status': str(e)})
        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f'Error: {e}')
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {'Error': str(e)})
`),
    });
    forceRuntimeUpdateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock-agentcore-control:UpdateAgentRuntime', 'bedrock-agentcore-control:ListAgentRuntimes'],
      resources: ['*'],
    }));
    forceRuntimeUpdateFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [agentCoreRuntimeRole.roleArn],
    }));

    const forceRuntimeUpdateProvider = new cr.Provider(this, 'ForceRuntimeUpdateProvider', {
      onEventHandler: forceRuntimeUpdateFn,
    });

    const forceRuntimeUpdate = new cdk.CustomResource(this, 'ForceRuntimeUpdate', {
      serviceToken: forceRuntimeUpdateProvider.serviceToken,
      properties: {
        RuntimeId: agentRuntime.ref,  // Physical resource ID of the AgentCore Runtime
        ContainerUri: `${agentEcr.repositoryUri}:latest`,
        RoleArn: agentCoreRuntimeRole.roleArn,
        // Force update on every deploy by changing this value
        BuildTimestamp: Date.now().toString(),
      },
    });
    forceRuntimeUpdate.node.addDependency(triggerBuild);
    forceRuntimeUpdate.node.addDependency(agentRuntime);

    // Pass the runtime role ARN to the agentic Lambda
    agenticLambda.addEnvironment('AGENTCORE_RUNTIME_ROLE_ARN', agentCoreRuntimeRole.roleArn);

    // Pass the runtime ARN to the Lambda (from the CfnResource output)
    agenticLambda.addEnvironment('AGENT_RUNTIME_ARN', agentRuntime.getAtt('AgentRuntimeArn').toString());

    // Grant the agentic Lambda permission to pass the runtime role to AgentCore
    agenticLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [agentCoreRuntimeRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'bedrock-agentcore.amazonaws.com',
        },
      },
    }));

    // Grant Lambda ALL AgentCore permissions (matching reference app pattern)
    agenticLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:*',
          'bedrock-agentcore-control:*',
        ],
        resources: ['*'],
      })
    );

    // Grant Lambda permissions for Bedrock Guardrail operations
    agenticLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:CreateGuardrail',
          'bedrock:DeleteGuardrail',
          'bedrock:GetGuardrail',
          'bedrock:ListGuardrails',
        ],
        resources: ['*'],
      })
    );

    // Grant Lambda permissions to manage Lambda tool functions (AgentCoreGatewayTool-*)
    agenticLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:CreateFunction',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:GetFunctionConfiguration',
          'lambda:UpdateFunctionCode',
        ],
        resources: [`arn:aws:lambda:${this.region}:${this.account}:function:AgentCoreGatewayTool-*`],
      })
    );

    // Grant Lambda permission to pass the LambdaToolRole when creating tool functions
    agenticLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [lambdaToolRole.roleArn],
      })
    );

    // Export the LambdaToolRole ARN to the agentic-api Lambda
    agenticLambda.addEnvironment('LAMBDA_TOOL_ROLE_ARN', lambdaToolRole.roleArn);

    // ========================================================================
    // SageMaker Domain + Code Editor Space
    // ========================================================================

    // VPC for SageMaker (minimal — 2 public subnets, no NAT gateway)
    const smVpc = new cdk.aws_ec2.Vpc(this, 'SageMakerVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Public', subnetType: cdk.aws_ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    // SageMaker execution role
    const smExecRole = new iam.Role(this, 'SageMakerExecRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('sagemaker.amazonaws.com'),
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('bedrock.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
      ],
    });
    smExecRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:UpdateFunctionCode', 'lambda:GetFunction', 'lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:*:*:function:AgentCoreGatewayTool-*`],
    }));
    // Lambda permissions for reward functions (fine-tuning evaluators)
    smExecRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'lambda:CreateFunction',
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:InvokeFunction',
        'lambda:DeleteFunction',
        'lambda:GetFunctionConfiguration',
        'lambda:AddPermission',
        'lambda:RemovePermission',
        'lambda:GetLayerVersion',
      ],
      resources: ['*'],
    }));
    // Allow SageMaker to pass its own role (needed for training jobs and reward functions)
    smExecRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [smExecRole.roleArn],
    }));
    // Bedrock permissions for fine-tuning (model customization)
    smExecRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:CreateModelCustomizationJob',
        'bedrock:GetModelCustomizationJob',
        'bedrock:StopModelCustomizationJob',
        'bedrock:ListModelCustomizationJobs',
        'bedrock:CreateProvisionedModelThroughput',
        'bedrock:GetProvisionedModelThroughput',
        'bedrock:GetCustomModel',
        'bedrock:ListCustomModels',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
        'bedrock:TagResource',
        'bedrock:UntagResource',
      ],
      resources: ['*'],
    }));
    // Allow loading customization recipes from SageMaker HubContent (required for fine-tuning)
    smExecRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'sagemaker:DescribeHubContent',
        'sagemaker:ListHubContents',
        'sagemaker:ListHubContentVersions',
        'sagemaker:DescribeHub',
        'sagemaker:ListHubs',
      ],
      resources: ['*'],
    }));
    // S3 access for JumpStart model artifacts and customization recipes
    smExecRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        'arn:aws:s3:::jumpstart-cache-prod-*',
        'arn:aws:s3:::jumpstart-cache-prod-*/*',
        'arn:aws:s3:::sagemaker-*',
        'arn:aws:s3:::sagemaker-*/*',
      ],
    }));

    // Ensure the default SageMaker bucket exists (required for training data, model artifacts, reward functions)
    // Uses a custom resource to create it only if it doesn't already exist (avoids CDK conflicts on re-deploy)
    const ensureSagemakerBucketFn = new lambda.Function(this, 'EnsureSagemakerBucketFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse

def handler(event, context):
    try:
        if event['RequestType'] in ['Create', 'Update']:
            bucket_name = event['ResourceProperties']['BucketName']
            region = event['ResourceProperties']['Region']
            s3 = boto3.client('s3', region_name=region)
            try:
                s3.head_bucket(Bucket=bucket_name)
            except s3.exceptions.ClientError as e:
                error_code = int(e.response['Error']['Code'])
                if error_code == 404:
                    if region == 'us-east-1':
                        s3.create_bucket(Bucket=bucket_name)
                    else:
                        s3.create_bucket(Bucket=bucket_name, CreateBucketConfiguration={'LocationConstraint': region})
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f'Error: {e}')
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
`),
    });
    ensureSagemakerBucketFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:CreateBucket', 's3:HeadBucket'],
      resources: ['*'],
    }));

    const ensureBucketProvider = new cr.Provider(this, 'EnsureSagemakerBucketProvider', {
      onEventHandler: ensureSagemakerBucketFn,
    });

    new cdk.CustomResource(this, 'EnsureSagemakerBucket', {
      serviceToken: ensureBucketProvider.serviceToken,
      properties: {
        BucketName: `sagemaker-${this.region}-${this.account}`,
        Region: this.region,
      },
    });

    // SageMaker Domain
    const smDomain = new cdk.aws_sagemaker.CfnDomain(this, 'SageMakerDomain', {
      domainName: 'ai-league-practice',
      authMode: 'IAM',
      defaultUserSettings: {
        executionRole: smExecRole.roleArn,
      },
      subnetIds: smVpc.publicSubnets.map(s => s.subnetId),
      vpcId: smVpc.vpcId,
    });

    // SageMaker User Profile
    const smUserProfile = new cdk.aws_sagemaker.CfnUserProfile(this, 'SageMakerUserProfile', {
      domainId: smDomain.attrDomainId,
      userProfileName: 'ai-league-user',
      userSettings: {
        executionRole: smExecRole.roleArn,
      },
    });

    // Custom resource Lambda to create Code Editor space (no native CF resource for spaces)
    const createSpaceFn = new lambda.Function(this, 'CreateSpaceFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import time

def handler(event, context):
    sm = boto3.client('sagemaker')
    try:
        if event['RequestType'] == 'Create':
            domain_id = event['ResourceProperties']['DomainId']
            space_name = event['ResourceProperties']['SpaceName']
            user_profile = event['ResourceProperties']['UserProfileName']
            sm.create_space(
                DomainId=domain_id, SpaceName=space_name,
                OwnershipSettings={'OwnerUserProfileName': user_profile},
                SpaceSharingSettings={'SharingType': 'Private'},
                SpaceSettings={'AppType': 'CodeEditor', 'CodeEditorAppSettings': {
                    'DefaultResourceSpec': {
                        'SageMakerImageArn': 'arn:aws:sagemaker:us-east-1:885854791233:image/sagemaker-distribution-cpu',
                        'SageMakerImageVersionAlias': '4',
                        'InstanceType': 'ml.t3.medium'
                    }
                }}
            )
            for _ in range(30):
                resp = sm.describe_space(DomainId=domain_id, SpaceName=space_name)
                if resp['Status'] == 'InService': break
                if resp['Status'] == 'Failed': raise Exception('Space creation failed')
                time.sleep(10)
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {'SpaceName': space_name})
        elif event['RequestType'] == 'Delete':
            domain_id = event['ResourceProperties']['DomainId']
            space_name = event['ResourceProperties']['SpaceName']
            # First stop/delete any running apps
            try:
                sm.delete_app(DomainId=domain_id, SpaceName=space_name, AppType='CodeEditor', AppName='default')
                # Wait for app to be deleted
                for _ in range(30):
                    try:
                        sm.describe_app(DomainId=domain_id, SpaceName=space_name, AppType='CodeEditor', AppName='default')
                        time.sleep(10)
                    except:
                        break
            except: pass
            # Then delete the space and wait for it
            try:
                sm.delete_space(DomainId=domain_id, SpaceName=space_name)
                for _ in range(30):
                    try:
                        resp = sm.describe_space(DomainId=domain_id, SpaceName=space_name)
                        if resp.get('Status') == 'Deleting':
                            time.sleep(10)
                        else:
                            break
                    except:
                        break
            except: pass
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f'Error: {e}')
        cfnresponse.send(event, context, cfnresponse.FAILED, {'Error': str(e)})
`),
    });
    createSpaceFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sagemaker:CreateSpace', 'sagemaker:DeleteSpace', 'sagemaker:DescribeSpace',
                'sagemaker:CreateApp', 'sagemaker:DeleteApp'],
      resources: ['*'],
    }));

    const codeEditorSpace = new cdk.CustomResource(this, 'CodeEditorSpace', {
      serviceToken: createSpaceFn.functionArn,
      properties: {
        DomainId: smDomain.attrDomainId,
        SpaceName: 'ai-league-codeeditor',
        UserProfileName: 'ai-league-user',
      },
    });
    codeEditorSpace.node.addDependency(smUserProfile);

    // Ensure CF deletes the space before the user profile (CfnResource-level dependency)
    // The CustomResource Delete handler must run before UserProfile deletion
    const spaceCfn = codeEditorSpace.node.defaultChild as cdk.CfnResource;
    spaceCfn.addDependency(smUserProfile);

    // Export SageMaker identifiers to the agentic-api Lambda
    agenticLambda.addEnvironment('SAGEMAKER_DOMAIN_ID', smDomain.attrDomainId);
    agenticLambda.addEnvironment('SAGEMAKER_USER_PROFILE', 'ai-league-user');
    agenticLambda.addEnvironment('SAGEMAKER_SPACE_NAME', 'ai-league-codeeditor');

    // Grant the agentic-api Lambda SageMaker IDE management permissions
    agenticLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sagemaker:CreateApp',
        'sagemaker:DeleteApp',
        'sagemaker:DescribeApp',
        'sagemaker:CreatePresignedDomainUrl',
      ],
      resources: ['*'],
    }));

    // ========================================================================
    // S3 Training Artifacts Bucket (Fine-Tuning Feature)
    // ========================================================================

    // S3 bucket for training artifacts (sample data for fine-tuning)
    const trainingArtifactsBucket = new s3.Bucket(this, 'TrainingArtifactsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        { expiration: cdk.Duration.days(365) },
      ],
    });

    // Deploy sample training artifacts to S3
    new s3deploy.BucketDeployment(this, 'DeployTrainingArtifacts', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../sample-training-artifacts'))],
      destinationBucket: trainingArtifactsBucket,
      destinationKeyPrefix: 'samples',
    });

    // Export training artifacts bucket name to the agentic-api Lambda
    agenticLambda.addEnvironment('TRAINING_ARTIFACTS_BUCKET', trainingArtifactsBucket.bucketName);

    // Grant Lambda read access to generate pre-signed URLs for sample artifacts
    trainingArtifactsBucket.grantRead(agenticLambda);

    // Grant Lambda permissions for Bedrock Custom Model Deployment operations (Fine-Tuning)
    agenticLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:CreateCustomModel',
        'bedrock:GetCustomModel',
        'bedrock:DeleteCustomModel',
        'bedrock:ListCustomModels',
        'bedrock:CreateModelImportJob',
        'bedrock:GetModelImportJob',
        'bedrock:GetImportedModel',
        'bedrock:DeleteImportedModel',
        'bedrock:ListImportedModels',
        'bedrock:CreateCustomModelDeployment',
        'bedrock:GetCustomModelDeployment',
        'bedrock:DeleteCustomModelDeployment',
        'bedrock:ListCustomModelDeployments',
      ],
      resources: ['*'],
    }));

    // Grant Lambda permissions for SageMaker DescribeTrainingJob (Fine-Tuning ARN validation)
    agenticLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sagemaker:DescribeTrainingJob'],
      resources: [`arn:aws:sagemaker:${this.region}:${this.account}:training-job/*`],
    }));

    // Grant Lambda permission to pass SageMaker role to Bedrock for model import
    agenticLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [smExecRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'bedrock.amazonaws.com',
        },
      },
    }));

    // ========================================================================
    // Custom Resource: Cleanup Custom Model Deployments on Stack Destroy
    // ========================================================================

    const cleanupCustomModelsFn = new lambda.Function(this, 'CleanupCustomModelDeployments', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(10),
      code: lambda.Code.fromInline(`
import time
import boto3
import cfnresponse

def handler(event, context):
    """On Delete: scan for all CUSTOMMODEL# records, delete Bedrock deployments and DynamoDB records."""
    try:
        if event['RequestType'] == 'Delete':
            table_name = event['ResourceProperties']['TableName']
            dynamodb = boto3.resource('dynamodb')
            table = dynamodb.Table(table_name)
            bedrock = boto3.client('bedrock')

            # Scan for all CUSTOMMODEL# records across all users
            items = []
            scan_kwargs = {
                'FilterExpression': 'begins_with(sk, :prefix)',
                'ExpressionAttributeValues': {':prefix': 'CUSTOMMODEL#'}
            }
            while True:
                resp = table.scan(**scan_kwargs)
                items.extend(resp.get('Items', []))
                if 'LastEvaluatedKey' not in resp:
                    break
                scan_kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']

            failures = []
            # Delete each Bedrock deployment with retry+verify pattern
            for item in items:
                deployment_arn = item.get('deploymentArn')
                if deployment_arn:
                    delete_succeeded = False
                    for attempt in range(3):
                        try:
                            bedrock.delete_custom_model_deployment(
                                customModelDeploymentIdentifier=deployment_arn)
                            delete_succeeded = True
                            break
                        except Exception as e:
                            print(f'Attempt {attempt+1} failed to delete deployment {deployment_arn}: {e}')
                            if attempt < 2:
                                time.sleep(2 ** attempt)
                    if delete_succeeded:
                        # Verify deletion
                        try:
                            verify_resp = bedrock.get_custom_model_deployment(
                                customModelDeploymentIdentifier=deployment_arn)
                            status = verify_resp.get('status', '')
                            if status not in ('Deleting', 'DELETING'):
                                failures.append(deployment_arn)
                        except Exception:
                            pass  # ResourceNotFound or ValidationException = deleted
                    else:
                        failures.append(deployment_arn)

                # Delete DynamoDB record regardless
                try:
                    table.delete_item(Key={'userId': item['userId'], 'sk': item['sk']})
                    print(f'Deleted record: {item["userId"]}/{item["sk"]}')
                except Exception as e:
                    print(f'Warning: failed to delete record {item.get("userId")}/{item.get("sk")}: {e}')

            if failures:
                print(f'WARNING: Failed to undeploy: {failures}. Manual cleanup needed.')

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f'Error during custom model cleanup: {e}')
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
`),
    });

    // Grant cleanup Lambda permissions to scan and delete from AgentConfigurations table
    cleanupCustomModelsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Scan', 'dynamodb:DeleteItem'],
      resources: [agentConfigurationsTable.tableArn],
    }));

    // Grant cleanup Lambda permissions for Bedrock Custom Model Deployment operations
    cleanupCustomModelsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:DeleteCustomModelDeployment', 'bedrock:GetCustomModelDeployment', 'bedrock:ListCustomModelDeployments'],
      resources: ['*'],
    }));

    const cleanupCustomModelsProvider = new cr.Provider(this, 'CleanupCustomModelsProvider', {
      onEventHandler: cleanupCustomModelsFn,
    });

    const cleanupCustomModelsResource = new cdk.CustomResource(this, 'CustomModelCleanup', {
      serviceToken: cleanupCustomModelsProvider.serviceToken,
      properties: {
        TableName: agentConfigurationsTable.tableName,
        // Force update on each deploy so the cleanup always has fresh table reference
        Timestamp: Date.now().toString(),
      },
    });

    // Ensure cleanup runs before DynamoDB table deletion on stack destroy
    cleanupCustomModelsResource.node.addDependency(agentConfigurationsTable);

    // ========================================================================
    // EventBridge, CloudTrail, Schema Generator & Auto-Shutdown Lambdas
    // ========================================================================

    // S3 bucket for CloudTrail logs with aggressive lifecycle expiration
    const cloudTrailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // Bucket policy required by CloudTrail to write logs
    cloudTrailBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudtrail.amazonaws.com')],
      actions: ['s3:GetBucketAcl'],
      resources: [cloudTrailBucket.bucketArn],
    }));
    cloudTrailBucket.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudtrail.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [`${cloudTrailBucket.bucketArn}/AWSLogs/${this.account}/*`],
      conditions: {
        StringEquals: {
          's3:x-amz-acl': 'bucket-owner-full-control',
        },
      },
    }));

    // CloudTrail trail — management events only, shortest retention
    new cloudtrail.Trail(this, 'LambdaToolTrail', {
      bucket: cloudTrailBucket,
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: false,
      managementEvents: cloudtrail.ReadWriteType.WRITE_ONLY,
    });

    // EventBridge rule matching UpdateFunctionCode for AgentCoreGatewayTool-* functions
    const lambdaCodeUpdateRule = new events.Rule(this, 'LambdaCodeUpdateRule', {
      description: 'Triggers schema regeneration when AgentCoreGatewayTool-* code is updated',
      eventPattern: {
        source: ['aws.lambda'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['lambda.amazonaws.com'],
          eventName: ['UpdateFunctionCode20150331v2'],
          requestParameters: {
            functionName: [{ prefix: 'AgentCoreGatewayTool-' }],
          },
        },
      },
    });

    // Schema Generator Lambda — invokes agentic-api resolver to regenerate schema
    const schemaGeneratorLambda = new lambda.Function(this, 'SchemaGeneratorLambda', {
      functionName: 'ai-league-schema-generator',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        RESOLVER_FUNCTION_NAME: agenticLambda.functionName,
      },
      code: lambda.Code.fromInline(`
import json
import boto3
import os

lambda_client = boto3.client('lambda')
RESOLVER_FUNCTION_NAME = os.environ['RESOLVER_FUNCTION_NAME']

def handler(event, context):
    """
    Triggered by EventBridge when AgentCoreGatewayTool-* code is updated.
    Invokes the agentic resolver Lambda asynchronously with a synthetic payload
    to trigger schema regeneration.
    """
    detail = event.get('detail', {})
    function_name = detail.get('requestParameters', {}).get('functionName', '')

    if not function_name.startswith('AgentCoreGatewayTool-'):
        print(f"Ignoring non-tool function: {function_name}")
        return {'statusCode': 200, 'body': 'Ignored'}

    tool_name = function_name.replace('AgentCoreGatewayTool-', '')

    payload = {
        'info': {'fieldName': 'RegenerateToolSchema'},
        'identity': {'claims': {'cognito:username': 'system'}},
        'arguments': {'name': tool_name},
    }

    response = lambda_client.invoke(
        FunctionName=RESOLVER_FUNCTION_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload),
    )

    print(f"Invoked resolver for {function_name}, status: {response['StatusCode']}")
    return {'statusCode': 200, 'body': f'Schema regeneration triggered for {function_name}'}
`),
    });

    // Grant Schema Generator Lambda permission to invoke the agentic-api Lambda
    agenticLambda.grantInvoke(schemaGeneratorLambda);

    // Add Schema Generator Lambda as the EventBridge rule target
    lambdaCodeUpdateRule.addTarget(new targets.LambdaFunction(schemaGeneratorLambda));

    // Auto-Shutdown Lambda — stops Code Editor IDE after 4 hours
    const autoShutdownLambda = new lambda.Function(this, 'AutoShutdownLambda', {
      functionName: 'ai-league-auto-shutdown',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 128,
      environment: {
        SAGEMAKER_DOMAIN_ID: smDomain.attrDomainId,
        SAGEMAKER_SPACE_NAME: 'ai-league-codeeditor',
      },
      code: lambda.Code.fromInline(`
import json
import boto3
import os

sagemaker_client = boto3.client('sagemaker')

DOMAIN_ID = os.environ.get('SAGEMAKER_DOMAIN_ID', '')
SPACE_NAME = os.environ.get('SAGEMAKER_SPACE_NAME', '')

def handler(event, context):
    """
    Auto-shutdown Lambda triggered every 4 hours.
    Stops the Code Editor IDE by calling sagemaker.delete_app().
    """
    if not DOMAIN_ID or not SPACE_NAME:
        print("SageMaker configuration not set, skipping shutdown")
        return {'statusCode': 200, 'body': 'Skipped - no configuration'}

    try:
        # Check if the app is running
        response = sagemaker_client.describe_app(
            DomainId=DOMAIN_ID,
            SpaceName=SPACE_NAME,
            AppType='CodeEditor',
            AppName='default',
        )

        status = response.get('Status', '')
        if status == 'InService':
            print("Code Editor is InService, stopping...")
            sagemaker_client.delete_app(
                DomainId=DOMAIN_ID,
                SpaceName=SPACE_NAME,
                AppType='CodeEditor',
                AppName='default',
            )
            print("Code Editor stop initiated")
            return {'statusCode': 200, 'body': 'Shutdown initiated'}
        else:
            print(f"Code Editor status is {status}, no action needed")
            return {'statusCode': 200, 'body': f'No action - status: {status}'}

    except sagemaker_client.exceptions.ResourceNotFound:
        print("Code Editor app not found (already stopped)")
        return {'statusCode': 200, 'body': 'Already stopped'}
    except Exception as e:
        print(f"Error during auto-shutdown: {str(e)}")
        return {'statusCode': 500, 'body': f'Error: {str(e)}'}
`),
    });

    // Grant Auto-Shutdown Lambda permissions for SageMaker operations
    autoShutdownLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sagemaker:DeleteApp', 'sagemaker:DescribeApp'],
      resources: ['*'],
    }));

    // Scheduled EventBridge rule — triggers Auto-Shutdown every 4 hours
    const autoShutdownRule = new events.Rule(this, 'AutoShutdownRule', {
      description: 'Triggers Code Editor auto-shutdown every 4 hours',
      schedule: events.Schedule.rate(cdk.Duration.hours(4)),
    });
    autoShutdownRule.addTarget(new targets.LambdaFunction(autoShutdownLambda));

    // ========================================================================
    // Game Runner Lambda — async execution of game sessions (10 min timeout)
    // ========================================================================
    // This Lambda is invoked asynchronously by the resolver Lambda to avoid
    // AppSync/API Gateway timeout limits. It runs the full game session
    // (pathfinding + challenge execution) with incremental DynamoDB flushes.
    const gameRunnerLambda = new lambda.Function(this, 'GameRunnerFunction', {
      functionName: 'ai-league-game-runner',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'game_runner_handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/agentic-api')),
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      environment: {
        GAME_SESSIONS_TABLE: gameSessionsTable.tableName,
        AGENT_CONFIGURATIONS_TABLE: agentConfigurationsTable.tableName,
      },
    });

    // Grant Game Runner Lambda read/write access to game sessions
    gameSessionsTable.grantReadWriteData(gameRunnerLambda);

    // Grant Game Runner Lambda AgentCore permissions (for pathfinding + challenge invocations)
    gameRunnerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:InvokeAgentRuntime',
        'bedrock-agentcore:*',
      ],
      resources: ['*'],
    }));

    // Grant Game Runner Lambda Bedrock Guardrail permissions
    gameRunnerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:ApplyGuardrail', 'bedrock:ListGuardrails', 'bedrock:GetGuardrail'],
      resources: ['*'],
    }));

    // Pass game runner function name to the resolver Lambda so it can invoke async
    agenticLambda.addEnvironment('GAME_RUNNER_FUNCTION', gameRunnerLambda.functionName);

    // Grant the resolver Lambda permission to invoke the Game Runner Lambda
    gameRunnerLambda.grantInvoke(agenticLambda);

    // Attach Lambda as data source for AppSync
    const agenticDataSource = agenticApi.addLambdaDataSource(
      'AgenticLambdaDataSource',
      agenticLambda
    );

    // Attach resolvers for all Query fields
    agenticDataSource.createResolver('GetMapResolver', {
      typeName: 'Query',
      fieldName: 'GetMap',
    });
    agenticDataSource.createResolver('GetGameSessionResolver', {
      typeName: 'Query',
      fieldName: 'GetGameSession',
    });
    agenticDataSource.createResolver('GetLeaderboardSubmissionsResolver', {
      typeName: 'Query',
      fieldName: 'GetLeaderboardSubmissions',
    });
    agenticDataSource.createResolver('GetSubmissionHistoryResolver', {
      typeName: 'Query',
      fieldName: 'GetSubmissionHistory',
    });
    agenticDataSource.createResolver('GetLlmConfigurationResolver', {
      typeName: 'Query',
      fieldName: 'GetLlmConfiguration',
    });

    // Attach resolvers for all Mutation fields
    agenticDataSource.createResolver('InvokeAgentCoreRuntimeResolver', {
      typeName: 'Mutation',
      fieldName: 'InvokeAgentCoreRuntime',
    });
    agenticDataSource.createResolver('SubmitToLeaderboardResolver', {
      typeName: 'Mutation',
      fieldName: 'SubmitToLeaderboard',
    });
    agenticDataSource.createResolver('SaveLlmConfigurationResolver', {
      typeName: 'Mutation',
      fieldName: 'SaveLlmConfiguration',
    });

    // Phase 2 Query resolvers (Agent Builder)
    agenticDataSource.createResolver('GetSupervisorAgentResolver', {
      typeName: 'Query',
      fieldName: 'GetSupervisorAgent',
    });
    agenticDataSource.createResolver('ListSubAgentsResolver', {
      typeName: 'Query',
      fieldName: 'ListSubAgents',
    });
    agenticDataSource.createResolver('GetSubAgentResolver', {
      typeName: 'Query',
      fieldName: 'GetSubAgent',
    });
    agenticDataSource.createResolver('ListLambdaToolResolver', {
      typeName: 'Query',
      fieldName: 'ListLambdaTool',
    });
    agenticDataSource.createResolver('ListMemoryResolver', {
      typeName: 'Query',
      fieldName: 'ListMemory',
    });
    agenticDataSource.createResolver('ListGuardrailResolver', {
      typeName: 'Query',
      fieldName: 'ListGuardrail',
    });
    agenticDataSource.createResolver('GetAgentCoreRuntimeResolver', {
      typeName: 'Query',
      fieldName: 'GetAgentCoreRuntime',
    });
    agenticDataSource.createResolver('ListAgentVersionsResolver', {
      typeName: 'Query',
      fieldName: 'ListAgentVersions',
    });
    agenticDataSource.createResolver('GetCodeEditorStatusResolver', {
      typeName: 'Query',
      fieldName: 'GetCodeEditorStatus',
    });
    agenticDataSource.createResolver('GetPresignedDomainUrlResolver', {
      typeName: 'Query',
      fieldName: 'GetPresignedDomainUrl',
    });
    agenticDataSource.createResolver('GetSchemaModelConfigResolver', {
      typeName: 'Query',
      fieldName: 'GetSchemaModelConfig',
    });

    // Phase 2 Mutation resolvers (Agent Builder)
    agenticDataSource.createResolver('UpdateSupervisorAgentResolver', {
      typeName: 'Mutation',
      fieldName: 'UpdateSupervisorAgent',
    });
    agenticDataSource.createResolver('CreateSubAgentResolver', {
      typeName: 'Mutation',
      fieldName: 'CreateSubAgent',
    });
    agenticDataSource.createResolver('UpdateSubAgentResolver', {
      typeName: 'Mutation',
      fieldName: 'UpdateSubAgent',
    });
    agenticDataSource.createResolver('DeleteSubAgentResolver', {
      typeName: 'Mutation',
      fieldName: 'DeleteSubAgent',
    });
    agenticDataSource.createResolver('CreateLambdaToolResolver', {
      typeName: 'Mutation',
      fieldName: 'CreateLambdaTool',
    });
    agenticDataSource.createResolver('DeleteLambdaToolResolver', {
      typeName: 'Mutation',
      fieldName: 'DeleteLambdaTool',
    });
    agenticDataSource.createResolver('StartCodeEditorResolver', {
      typeName: 'Mutation',
      fieldName: 'StartCodeEditor',
    });
    agenticDataSource.createResolver('StopCodeEditorResolver', {
      typeName: 'Mutation',
      fieldName: 'StopCodeEditor',
    });
    agenticDataSource.createResolver('ResetConfigurationResolver', {
      typeName: 'Mutation',
      fieldName: 'ResetConfiguration',
    });
    agenticDataSource.createResolver('SaveSchemaModelConfigResolver', {
      typeName: 'Mutation',
      fieldName: 'SaveSchemaModelConfig',
    });
    agenticDataSource.createResolver('CreateMemoryResolver', {
      typeName: 'Mutation',
      fieldName: 'CreateMemory',
    });
    agenticDataSource.createResolver('DeleteMemoryResolver', {
      typeName: 'Mutation',
      fieldName: 'DeleteMemory',
    });
    agenticDataSource.createResolver('CreateGuardrailResolver', {
      typeName: 'Mutation',
      fieldName: 'CreateGuardrail',
    });
    agenticDataSource.createResolver('DeleteGuardrailResolver', {
      typeName: 'Mutation',
      fieldName: 'DeleteGuardrail',
    });
    agenticDataSource.createResolver('CreateModelResolver', {
      typeName: 'Mutation',
      fieldName: 'CreateModel',
    });
    agenticDataSource.createResolver('GenerateChallengeResolver', {
      typeName: 'Mutation',
      fieldName: 'GenerateChallenge',
    });

    // Fine-Tuning Query resolvers
    agenticDataSource.createResolver('ListCustomModelsResolver', {
      typeName: 'Query',
      fieldName: 'ListCustomModels',
    });
    agenticDataSource.createResolver('GetCustomModelStatusResolver', {
      typeName: 'Query',
      fieldName: 'GetCustomModelStatus',
    });
    agenticDataSource.createResolver('GetTrainingArtifactUrlResolver', {
      typeName: 'Query',
      fieldName: 'GetTrainingArtifactUrl',
    });
    agenticDataSource.createResolver('GetStudioPresignedUrlResolver', {
      typeName: 'Query',
      fieldName: 'GetStudioPresignedUrl',
    });

    // Fine-Tuning Mutation resolvers
    agenticDataSource.createResolver('RegisterCustomModelResolver', {
      typeName: 'Mutation',
      fieldName: 'RegisterCustomModel',
    });
    agenticDataSource.createResolver('DeployCustomModelResolver', {
      typeName: 'Mutation',
      fieldName: 'DeployCustomModel',
    });
    agenticDataSource.createResolver('UndeployCustomModelResolver', {
      typeName: 'Mutation',
      fieldName: 'UndeployCustomModel',
    });
    agenticDataSource.createResolver('DeleteCustomModelResolver', {
      typeName: 'Mutation',
      fieldName: 'DeleteCustomModel',
    });

    // Profile API Lambda function (TypeScript bundled with esbuild)
    const profileLambda = new lambdaNodejs.NodejsFunction(this, 'ProfileApiLambda', {
      functionName: 'ai-league-community-profile-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../lambda/profile-api/index.ts'),
      handler: 'handler',
      environment: {
        USER_PROFILES_TABLE: userProfilesTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant Profile Lambda read/write access to the UserProfiles table
    userProfilesTable.grantReadWriteData(profileLambda);

    // API Gateway REST API with stage name 'api'
    // Resources are /v1/profile so full path through CloudFront is /api/v1/profile
    const api = new apigateway.RestApi(this, 'ProfileApi', {
      restApiName: 'ai-league-community-profile-api',
      description: 'API Gateway for AI League Community Edition profile management',
      deploy: true,
      deployOptions: {
        stageName: 'api',
      },
      disableExecuteApiEndpoint: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Suppress the auto-generated API Gateway endpoint output
    // (API is accessed via CloudFront, not directly)
    api.node.tryRemoveChild('Endpoint');

    // Cognito User Pool authorizer for API Gateway
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: 'ai-league-cognito-authorizer',
    });

    // /v1/profile resource (accessed via CloudFront as /api/v1/profile)
    const v1Resource = api.root.addResource('v1');
    const profileResource = v1Resource.addResource('profile');

    const profileIntegration = new apigateway.LambdaIntegration(profileLambda);

    profileResource.addMethod('GET', profileIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    profileResource.addMethod('PUT', profileIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Maps API Lambda function (TypeScript bundled with esbuild)
    const mapsLambda = new lambdaNodejs.NodejsFunction(this, 'MapsApiLambda', {
      functionName: 'ai-league-community-maps-api',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../lambda/maps-api/index.ts'),
      handler: 'handler',
      environment: {
        MAPS_TABLE: mapsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant Maps Lambda read/write access to the Maps table
    mapsTable.grantReadWriteData(mapsLambda);

    // /v1/maps resource with GET and POST methods
    const mapsResource = v1Resource.addResource('maps');
    const mapsIntegration = new apigateway.LambdaIntegration(mapsLambda);

    mapsResource.addMethod('GET', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    mapsResource.addMethod('POST', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /v1/maps/{mapId} resource with GET, PUT, DELETE methods
    const mapIdResource = mapsResource.addResource('{mapId}');

    mapIdResource.addMethod('GET', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    mapIdResource.addMethod('PUT', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    mapIdResource.addMethod('DELETE', mapsIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // S3 bucket for frontend static assets (block all public access)
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // CloudFront Origin Access Identity for S3 bucket access
    const originAccessIdentity = new cf.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for AI League Community Edition frontend',
    });

    // Grant CloudFront OAI read access to the S3 bucket
    frontendBucket.grantRead(originAccessIdentity);

    // API Gateway domain for CloudFront custom origin
    const apiDomainName = `${api.restApiId}.execute-api.${this.region}.amazonaws.com`;

    // CloudFront distribution with two origins:
    // 1. Default behavior: S3 for static assets
    // 2. /api/* behavior: API Gateway custom origin
    const distribution = new cf.CloudFrontWebDistribution(this, 'FrontendDistribution', {
      originConfigs: [
        // S3 origin for static assets (default behavior)
        {
          s3OriginSource: {
            s3BucketSource: frontendBucket,
            originAccessIdentity,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
          ],
        },
        // API Gateway origin for /api/* path pattern
        {
          customOriginSource: {
            domainName: apiDomainName,
            originProtocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
          },
          behaviors: [
            {
              pathPattern: '/api/*',
              allowedMethods: cf.CloudFrontAllowedMethods.ALL,
              viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              forwardedValues: {
                queryString: true,
                headers: ['Authorization', 'Content-Type'],
              },
              defaultTtl: cdk.Duration.seconds(0),
              minTtl: cdk.Duration.seconds(0),
              maxTtl: cdk.Duration.seconds(0),
            },
          ],
        },
      ],
      // Custom error responses for SPA routing (serve index.html for 403/404)
      errorConfigurations: [
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTtl: 0,
        },
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
          errorCachingMinTtl: 0,
        },
      ],
      defaultRootObject: 'index.html',
    });

    // Build frontend using s3deploy.Source.asset with bundling
    const frontendDir = path.join(__dirname, '../../frontend');

    const frontendAsset = s3deploy.Source.asset(frontendDir, {
      bundling: {
        image: cdk.DockerImage.fromRegistry('node:22-slim'),
        command: [
          'bash', '-c',
          'npm install && npm run build && cp -r dist/* /asset-output/',
        ],
        local: {
          tryBundle(outputDir: string): boolean {
            try {
              execSync('npm install', {
                cwd: frontendDir,
                stdio: 'inherit',
              });
              execSync('npm run build', {
                cwd: frontendDir,
                stdio: 'inherit',
              });
              const distDir = path.join(frontendDir, 'dist');
              copyDirRecursive(distDir, outputDir);
              return true;
            } catch {
              return false;
            }
          },
        },
      },
    });

    // Runtime configuration deployed as aws-exports.json
    const cloudFrontDomain = `https://${distribution.distributionDomainName}`;
    const exportsAsset = s3deploy.Source.jsonData('aws-exports.json', {
      region: this.region,
      Auth: {
        Cognito: {
          userPoolId: this.userPool.userPoolId,
          userPoolClientId: this.userPoolClient.userPoolClientId,
        },
      },
      API: {
        REST: {
          RestApi: {
            endpoint: `${cloudFrontDomain}/api/v1`,
          },
        },
      },
    });

    // Agentic Game Engine settings deployed as settings.json
    const regionPrefix = this.region.split('-')[0];
    const settingsAsset = s3deploy.Source.jsonData('settings.json', {
      graphql: { endpoint: agenticApi.graphqlUrl },
      graphqlApiKey: agenticApi.apiKey,
      sagemakerStudioUrl: `https://studio-${smDomain.attrDomainId}.studio.${this.region}.sagemaker.aws/models/SageMakerPublicHub/Model/huggingface-reasoning-qwen3-06b`,
      defaultModelId: `${regionPrefix}.amazon.nova-2-lite-v1:0`,
      auth: {
        cognito: {
          userPoolId: this.userPool.userPoolId,
          userPoolClientId: this.userPoolClient.userPoolClientId,
          domain: `ai-league-${this.account}`,
        },
      },
    });

    // Single BucketDeployment with frontend assets, runtime config, and agentic settings
    new s3deploy.BucketDeployment(this, 'FrontendDeployment', {
      sources: [frontendAsset, exportsAsset, settingsAsset],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Admin Seed Custom Resource Lambda (TypeScript bundled with esbuild)
    const adminSeedLambda = new lambdaNodejs.NodejsFunction(this, 'AdminSeedFunction', {
      functionName: 'ai-league-admin-seed',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../../lambda/admin-seed/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant the Lambda permissions for Cognito admin operations on the User Pool
    adminSeedLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:CreateGroup',
        ],
        resources: [this.userPool.userPoolArn],
      })
    );

    // CDK Custom Resource that invokes the admin seed Lambda on stack creation
    const adminSeedProvider = new cr.Provider(this, 'AdminSeedProvider', {
      onEventHandler: adminSeedLambda,
    });

    const adminSeedResource = new cdk.CustomResource(this, 'AdminSeedResource', {
      serviceToken: adminSeedProvider.serviceToken,
      properties: {
        UserPoolId: this.userPool.userPoolId,
      },
    });

    // ========================================================================
    // Cleanup Custom Resource — runs on cdk destroy to remove user-created resources
    // ========================================================================

    const cleanupFn = new lambda.Function(this, 'CleanupFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        GATEWAY_URL: gatewayUrl.toString(),
        AGENT_CONFIGURATIONS_TABLE: agentConfigurationsTable.tableName,
        VPC_ID: smVpc.vpcId,
      },
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import os
import re

def handler(event, context):
    """On Delete: clean up user-created Lambdas, Gateway targets, Memories, Guardrails."""
    try:
        if event['RequestType'] != 'Delete':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            return

        # 1. Delete all AgentCoreGatewayTool-* Lambdas (except Pathfinder, already CDK-managed)
        lambda_client = boto3.client('lambda')
        paginator = lambda_client.get_paginator('list_functions')
        for page in paginator.paginate():
            for fn in page['Functions']:
                name = fn['FunctionName']
                if name.startswith('AgentCoreGatewayTool-') and name != 'AgentCoreGatewayTool-Pathfinder':
                    try:
                        lambda_client.delete_function(FunctionName=name)
                        print(f'Deleted Lambda: {name}')
                    except Exception as e:
                        print(f'Failed to delete Lambda {name}: {e}')

        # 2. Delete non-CDK Gateway targets (user-created tools only)
        gateway_url = os.environ.get('GATEWAY_URL', '')
        gw_match = re.search(r'https://([^.]+)\\.gateway', gateway_url)
        if gw_match:
            gw_id = gw_match.group(1)
            ctrl = boto3.client('bedrock-agentcore-control')
            try:
                targets = ctrl.list_gateway_targets(gatewayIdentifier=gw_id)
                for t in targets.get('items', []):
                    # Skip CDK-managed Pathfinder target (CF handles it)
                    if t.get('name') == 'AgentCoreGatewayTool-Pathfinder':
                        continue
                    try:
                        ctrl.delete_gateway_target(gatewayIdentifier=gw_id, targetId=t['targetId'])
                        print(f'Deleted Gateway target: {t.get("name", t["targetId"])}')
                    except Exception as e:
                        print(f'Failed to delete Gateway target {t["targetId"]}: {e}')
            except Exception as e:
                print(f'Failed to list Gateway targets: {e}')

        # 3. Delete all AgentCore Memories
        try:
            ctrl = boto3.client('bedrock-agentcore-control')
            memories = ctrl.list_memories()
            for m in memories.get('memories', memories.get('items', [])):
                mem_id = m.get('id', '')
                if mem_id:
                    try:
                        ctrl.delete_memory(memoryId=mem_id)
                        print(f'Deleted Memory: {mem_id}')
                    except Exception as e:
                        print(f'Failed to delete Memory {mem_id}: {e}')
        except Exception as e:
            print(f'Failed to list Memories: {e}')

        # 4. Delete all Bedrock Guardrails (community edition creates them with prefix)
        try:
            bedrock = boto3.client('bedrock')
            guardrails = bedrock.list_guardrails()
            for g in guardrails.get('guardrails', []):
                gr_id = g.get('id', '')
                if gr_id:
                    try:
                        bedrock.delete_guardrail(guardrailIdentifier=gr_id)
                        print(f'Deleted Guardrail: {gr_id}')
                    except Exception as e:
                        print(f'Failed to delete Guardrail {gr_id}: {e}')
        except Exception as e:
            print(f'Failed to list Guardrails: {e}')

        # 5. Delete SageMaker-created EFS and security groups in our VPC (blocks VPC deletion)
        # SageMaker domain auto-creates EFS for home directories and security groups.
        # Must delete mount targets, then EFS, then non-default SGs in the VPC.
        # Scoped to our VPC only (passed via environment variable).
        try:
            import time
            ec2 = boto3.client('ec2')
            efs = boto3.client('efs')
            vpc_id = os.environ.get('VPC_ID', '')
            if not vpc_id:
                print('No VPC_ID configured, skipping EFS/SG cleanup')
            else:
                # Delete EFS mount targets and file systems in our VPC
                fs_list = efs.describe_file_systems()
                for fs in fs_list.get('FileSystems', []):
                    fs_id = fs['FileSystemId']
                    # Check mount targets — only process if they're in our VPC
                    mts = efs.describe_mount_targets(FileSystemId=fs_id).get('MountTargets', [])
                    in_our_vpc = any(mt.get('VpcId') == vpc_id for mt in mts)
                    if not in_our_vpc and mts:
                        continue
                    if not mts:
                        # No mount targets — check tags to see if SageMaker created it
                        try:
                            tags = efs.describe_tags(FileSystemId=fs_id).get('Tags', [])
                            is_sagemaker = any('ManagedByAmazonSageMakerResource' in t.get('Key', '') for t in tags)
                            if not is_sagemaker:
                                continue
                        except Exception:
                            continue
                    print(f'Found EFS in our VPC: {fs_id}')
                    for mt in mts:
                        try:
                            efs.delete_mount_target(MountTargetId=mt['MountTargetId'])
                            print(f'  Deleted mount target: {mt["MountTargetId"]}')
                        except Exception as e:
                            print(f'  Failed to delete mount target: {e}')
                    # Wait for mount targets to be deleted
                    for _ in range(30):
                        remaining = efs.describe_mount_targets(FileSystemId=fs_id).get('MountTargets', [])
                        if not remaining:
                            break
                        time.sleep(2)
                    try:
                        efs.delete_file_system(FileSystemId=fs_id)
                        print(f'  Deleted EFS: {fs_id}')
                    except Exception as e:
                        print(f'  Failed to delete EFS {fs_id}: {e}')

                # Delete non-default security groups in our VPC
                sgs = ec2.describe_security_groups(Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}])
                for sg in sgs.get('SecurityGroups', []):
                    if sg['GroupName'] == 'default':
                        continue
                    sg_id = sg['GroupId']
                    # Remove all ingress/egress rules first (handles cross-SG refs)
                    try:
                        if sg.get('IpPermissions'):
                            ec2.revoke_security_group_ingress(GroupId=sg_id, IpPermissions=sg['IpPermissions'])
                        if sg.get('IpPermissionsEgress'):
                            ec2.revoke_security_group_egress(GroupId=sg_id, IpPermissions=sg['IpPermissionsEgress'])
                    except Exception:
                        pass
                # Now delete them (second pass after all rules removed)
                for sg in sgs.get('SecurityGroups', []):
                    if sg['GroupName'] == 'default':
                        continue
                    try:
                        ec2.delete_security_group(GroupId=sg['GroupId'])
                        print(f'  Deleted SG: {sg["GroupId"]} ({sg["GroupName"]})')
                    except Exception as e:
                        print(f'  Failed to delete SG {sg["GroupId"]}: {e}')
        except Exception as e:
            print(f'Failed to clean up EFS/SGs: {e}')

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f'Cleanup error: {e}')
        # Don't fail the stack deletion on cleanup errors
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
`),
    });

    // Grant cleanup Lambda permissions for all resource types it needs to delete
    cleanupFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:ListFunctions', 'lambda:DeleteFunction'],
      resources: ['*'],
    }));
    cleanupFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock-agentcore:ListGatewayTargets', 'bedrock-agentcore:DeleteGatewayTarget',
        'bedrock-agentcore:ListMemories', 'bedrock-agentcore:DeleteMemory',
        'bedrock-agentcore-control:ListGatewayTargets', 'bedrock-agentcore-control:DeleteGatewayTarget',
        'bedrock-agentcore-control:ListMemories', 'bedrock-agentcore-control:DeleteMemory',
      ],
      resources: ['*'],
    }));
    cleanupFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:ListGuardrails', 'bedrock:DeleteGuardrail'],
      resources: ['*'],
    }));
    cleanupFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'elasticfilesystem:DescribeFileSystems', 'elasticfilesystem:DescribeTags',
        'elasticfilesystem:DescribeMountTargets', 'elasticfilesystem:DeleteMountTarget',
        'elasticfilesystem:DeleteFileSystem',
      ],
      resources: ['*'],
    }));
    cleanupFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:DescribeSecurityGroups', 'ec2:DeleteSecurityGroup',
        'ec2:RevokeSecurityGroupIngress', 'ec2:RevokeSecurityGroupEgress',
      ],
      resources: ['*'],
    }));
    agentConfigurationsTable.grantReadData(cleanupFn);

    const cleanupProvider = new cr.Provider(this, 'CleanupProvider', {
      onEventHandler: cleanupFn,
    });

    const cleanupResource = new cdk.CustomResource(this, 'CleanupResource', {
      serviceToken: cleanupProvider.serviceToken,
      properties: {
        // Trigger property ensures the resource exists but only runs handler on Delete
        Version: '1',
      },
    });

    // Dependency chain for clean destroy:
    // CleanupResource depends on Gateway, PathfindingTarget, and VPC.
    // On destroy, CF deletes in reverse: CleanupResource first (triggering the cleanup handler
    // which removes orphan gateway targets and SageMaker EFS), then PathfindingGatewayTarget,
    // then Gateway (now empty), then VPC (now free of EFS ENIs).
    const cleanupCfn = cleanupResource.node.defaultChild as cdk.CfnResource;
    cleanupCfn.addDependency(gateway);
    cleanupCfn.addDependency(pathfindingTarget);
    cleanupCfn.addDependency(smVpc.node.findChild('Resource') as cdk.CfnResource);

    // Stack outputs
    new cdk.CfnOutput(this, 'UserInterfaceDomainName', {
      value: cloudFrontDomain,
      description: 'CloudFront Distribution URL for the frontend application',
    });

    new cdk.CfnOutput(this, 'AdminPassword', {
      value: adminSeedResource.getAttString('AdminPassword'),
      description: 'Generated admin password (only set on first deployment when user is created)',
    });

    new cdk.CfnOutput(this, 'AgenticApiEndpoint', {
      value: agenticApi.graphqlUrl,
      description: 'AppSync GraphQL API endpoint for the Agentic Game Engine',
    });

    new cdk.CfnOutput(this, 'AgenticApiKey', {
      value: agenticApi.apiKey || '',
      description: 'AppSync API Key for the Agentic Game Engine',
    });

    new cdk.CfnOutput(this, 'AgentCoreRuntimeArn', {
      value: agentRuntime.getAtt('AgentRuntimeArn').toString(),
      description: 'AgentCore Runtime ARN for the community agent',
    });

    new cdk.CfnOutput(this, 'AgentCoreRuntimeRoleArn', {
      value: agentCoreRuntimeRole.roleArn,
      description: 'IAM Role ARN for AgentCore Runtime instances (use when provisioning a runtime)',
    });
  }
}
