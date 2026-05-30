import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 5: Avatar Selection Persistence
 *
 * For any valid avatar ID from the predefined avatar list, selecting that avatar via
 * the profile API SHALL persist it to the backend and return the same avatar ID when
 * the profile is subsequently retrieved.
 *
 * **Validates: Requirements 5.2**
 */

// In-memory store simulating DynamoDB
const store = new Map<string, Record<string, unknown>>();

const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-dynamodb', () => {
  class DynamoDBClient {}
  return { DynamoDBClient };
});

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class GetCommand {
    _type = 'GetCommand';
    input: { TableName: string; Key: { userId: string } };
    constructor(input: { TableName: string; Key: { userId: string } }) {
      this.input = input;
    }
  }
  class UpdateCommand {
    _type = 'UpdateCommand';
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class DynamoDBDocumentClient {
    send = mockSend;
    static from() {
      return new DynamoDBDocumentClient();
    }
  }
  return { DynamoDBDocumentClient, GetCommand, UpdateCommand };
});

vi.hoisted(() => {
  process.env.USER_PROFILES_TABLE = 'TestUserProfiles';
});

import { handler, AVATAR_OPTIONS } from '../../lambda/profile-api/index.js';
import type { APIGatewayProxyEvent } from 'aws-lambda';

function makeEvent(method: string, body?: string): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    body: body ?? null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/profile',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/profile',
    requestContext: {
      authorizer: {
        claims: { sub: 'test-user-123' },
      },
      accountId: '123456789',
      apiId: 'testapi',
      httpMethod: method,
      identity: {} as never,
      path: '/profile',
      protocol: 'HTTP/1.1',
      requestId: 'req-1',
      requestTimeEpoch: Date.now(),
      resourceId: 'res-1',
      resourcePath: '/profile',
      stage: 'test',
    },
  } as unknown as APIGatewayProxyEvent;
}

describe('Feature: aws-ai-league-community-edition, Property 5: Avatar selection persistence', () => {
  beforeEach(() => {
    mockSend.mockReset();
    store.clear();
  });

  it('PUT then GET returns the same avatar ID for any valid avatar selection', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a random valid avatar ID from the predefined list
        fc.constantFrom(...AVATAR_OPTIONS),
        async (avatarId: string) => {
          mockSend.mockReset();
          store.clear();

          // Mock DynamoDB behavior using in-memory store
          mockSend.mockImplementation((command: { _type: string; input: Record<string, unknown> }) => {
            if (command._type === 'UpdateCommand') {
              const input = command.input as {
                Key: { userId: string };
                ExpressionAttributeValues: Record<string, string>;
              };
              const userId = input.Key.userId;
              const existing = store.get(userId) ?? { userId };

              // Apply expression attribute values to simulate DynamoDB update
              const values = input.ExpressionAttributeValues;
              if (values[':avatar']) {
                existing.avatar = values[':avatar'];
              }
              if (values[':displayName']) {
                existing.displayName = values[':displayName'];
              }
              if (values[':updatedAt']) {
                existing.updatedAt = values[':updatedAt'];
              }

              store.set(userId, existing);

              return Promise.resolve({ Attributes: { ...existing } });
            }

            if (command._type === 'GetCommand') {
              const input = command.input as { Key: { userId: string } };
              const userId = input.Key.userId;
              const item = store.get(userId);
              return Promise.resolve({ Item: item ?? undefined });
            }

            return Promise.resolve({});
          });

          // PUT: select the avatar
          const putEvent = makeEvent('PUT', JSON.stringify({ avatar: avatarId }));
          const putResult = await handler(putEvent);

          expect(putResult.statusCode).toBe(200);
          const putBody = JSON.parse(putResult.body);
          expect(putBody.avatar).toBe(avatarId);

          // GET: retrieve the profile and verify the avatar persisted
          const getEvent = makeEvent('GET');
          const getResult = await handler(getEvent);

          expect(getResult.statusCode).toBe(200);
          const getBody = JSON.parse(getResult.body);
          expect(getBody.avatar).toBe(avatarId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
