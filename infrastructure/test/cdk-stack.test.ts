import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CdkStack } from '../lib/cdk-stack';

// Force CDK to skip all bundling during tests
process.env.CDK_BUNDLING_STACKS = '';

describe('CdkStack - Agentic Game Engine Infrastructure', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new CdkStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  // =========================================================================
  // Snapshot Test (resource count verification)
  // =========================================================================

  test('synthesizes expected resource types', () => {
    // Verify key resource types exist in the template
    template.resourceCountIs('AWS::DynamoDB::Table', 6); // UserProfiles, Maps, AgentConfigurations, GameSessions, Leaderboard, Submissions
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 1);
    template.resourceCountIs('AWS::AppSync::ApiKey', 1);
    template.resourceCountIs('AWS::AppSync::GraphQLSchema', 1);
  });

  // =========================================================================
  // AgentConfigurations Table
  // =========================================================================

  describe('AgentConfigurations Table', () => {
    test('has userId partition key and sk sort key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-agent-configurations',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
      });
    });

    test('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-agent-configurations',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    test('has GSI1 with gsi1pk partition key and gsi1sk sort key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-agent-configurations',
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      });
    });
  });

  // =========================================================================
  // GameSessions Table
  // =========================================================================

  describe('GameSessions Table', () => {
    test('has sessionId partition key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-game-sessions',
        KeySchema: [
          { AttributeName: 'sessionId', KeyType: 'HASH' },
        ],
      });
    });

    test('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-game-sessions',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  // =========================================================================
  // AgenticLeaderboard Table
  // =========================================================================

  describe('AgenticLeaderboard Table', () => {
    test('has leaderboardId partition key and sk sort key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-agentic-leaderboard',
        KeySchema: [
          { AttributeName: 'leaderboardId', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
      });
    });

    test('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-agentic-leaderboard',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  // =========================================================================
  // AgenticSubmissions Table
  // =========================================================================

  describe('AgenticSubmissions Table', () => {
    test('has userId partition key and updatedTime sort key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-agentic-submissions',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'updatedTime', KeyType: 'RANGE' },
        ],
      });
    });

    test('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ai-league-community-agentic-submissions',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  // =========================================================================
  // AppSync API
  // =========================================================================

  describe('AppSync API', () => {
    test('exists with API_KEY authentication', () => {
      template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
        Name: 'ai-league-agentic-api',
        AuthenticationType: 'API_KEY',
      });
    });

    test('has an API key resource', () => {
      template.resourceCountIs('AWS::AppSync::ApiKey', 1);
    });
  });

  // =========================================================================
  // Lambda Function
  // =========================================================================

  describe('Agentic Lambda Function', () => {
    test('has all 5 required environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ai-league-agentic-api',
        Environment: {
          Variables: {
            GAME_SESSIONS_TABLE: Match.anyValue(),
            LEADERBOARD_TABLE: Match.anyValue(),
            SUBMISSIONS_TABLE: Match.anyValue(),
            AGENT_CONFIGURATIONS_TABLE: Match.anyValue(),
            MAPS_TABLE: Match.anyValue(),
          },
        },
      });
    });

    test('has bedrock:InvokeModel permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['bedrock:InvokeModel']),
              Effect: 'Allow',
              Resource: '*',
            }),
          ]),
        },
      });
    });
  });
});
