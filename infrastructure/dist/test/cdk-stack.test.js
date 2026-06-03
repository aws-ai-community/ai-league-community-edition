"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = __importStar(require("aws-cdk-lib"));
const assertions_1 = require("aws-cdk-lib/assertions");
const cdk_stack_1 = require("../lib/cdk-stack");
// Force CDK to skip all bundling during tests
process.env.CDK_BUNDLING_STACKS = '';
describe('CdkStack - Agentic Game Engine Infrastructure', () => {
    let template;
    beforeAll(() => {
        const app = new cdk.App();
        const stack = new cdk_stack_1.CdkStack(app, 'TestStack');
        template = assertions_1.Template.fromStack(stack);
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
                        GAME_SESSIONS_TABLE: assertions_1.Match.anyValue(),
                        LEADERBOARD_TABLE: assertions_1.Match.anyValue(),
                        SUBMISSIONS_TABLE: assertions_1.Match.anyValue(),
                        AGENT_CONFIGURATIONS_TABLE: assertions_1.Match.anyValue(),
                        MAPS_TABLE: assertions_1.Match.anyValue(),
                    },
                },
            });
        });
        test('has bedrock:InvokeModel permission', () => {
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Action: assertions_1.Match.arrayWith(['bedrock:InvokeModel']),
                            Effect: 'Allow',
                            Resource: '*',
                        }),
                    ]),
                },
            });
        });
    });
});
//# sourceMappingURL=cdk-stack.test.js.map