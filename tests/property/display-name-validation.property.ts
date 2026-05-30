import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 4: Display Name Validation
 *
 * For any string, the profile update validation SHALL accept it if and only if its
 * trimmed length is between 1 and 50 characters inclusive. Strings that are empty,
 * whitespace-only, or exceed 50 characters SHALL be rejected with a validation error.
 *
 * **Validates: Requirements 5.3, 5.7**
 */

// Mock DynamoDB client
const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-dynamodb', () => {
  class DynamoDBClient {
    send = mockSend;
  }
  return { DynamoDBClient };
});

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class DynamoDBDocumentClient {
    send = mockSend;
    static from() {
      return new DynamoDBDocumentClient();
    }
  }
  class GetCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class UpdateCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return { DynamoDBDocumentClient, GetCommand, UpdateCommand };
});

vi.stubEnv('USER_PROFILES_TABLE', 'TestUserProfilesTable');

import { handler } from '../../lambda/profile-api/index.js';
import type { APIGatewayProxyEvent } from 'aws-lambda';

function createPutEvent(displayName: string): APIGatewayProxyEvent {
  return {
    httpMethod: 'PUT',
    body: JSON.stringify({ displayName }),
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
        claims: {
          sub: 'test-user-id-123',
          email: 'test@example.com',
        },
      },
      accountId: '123456789',
      apiId: 'testapi',
      httpMethod: 'PUT',
      identity: {} as never,
      path: '/profile',
      protocol: 'HTTP/1.1',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test',
      resourcePath: '/profile',
      stage: 'test',
    },
  } as APIGatewayProxyEvent;
}

describe('Feature: aws-ai-league-community-edition, Property 4: Display name validation', () => {
  beforeEach(() => {
    mockSend.mockReset();
    // Mock successful DynamoDB update
    mockSend.mockResolvedValue({
      Attributes: {
        userId: 'test-user-id-123',
        displayName: 'updated',
        avatar: null,
      },
    });
  });

  it('accepts display names with trimmed length between 1 and 50 characters', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate strings that, after trimming, have length 1-50
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length >= 1 && s.trim().length <= 50),
        async (displayName: string) => {
          mockSend.mockReset();
          mockSend.mockResolvedValue({
            Attributes: {
              userId: 'test-user-id-123',
              displayName: displayName.trim(),
              avatar: null,
            },
          });

          const event = createPutEvent(displayName);
          const result = await handler(event);

          expect(result.statusCode).toBe(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects empty strings with 400 status', async () => {
    const event = createPutEvent('');
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Display name must be between 1 and 50 characters');
  });

  it('rejects whitespace-only strings with 400 status', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate whitespace-only strings (spaces, tabs, newlines)
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 1, maxLength: 100 }).map(arr => arr.join('')),
        async (whitespaceOnly: string) => {
          const event = createPutEvent(whitespaceOnly);
          const result = await handler(event);

          expect(result.statusCode).toBe(400);
          const body = JSON.parse(result.body);
          expect(body.error).toContain('Display name must be between 1 and 50 characters');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects strings exceeding 50 characters after trimming with 400 status', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate strings with trimmed length > 50
        fc.string({ minLength: 51, maxLength: 200 }).filter(s => s.trim().length > 50),
        async (longName: string) => {
          const event = createPutEvent(longName);
          const result = await handler(event);

          expect(result.statusCode).toBe(400);
          const body = JSON.parse(result.body);
          expect(body.error).toContain('Display name must be between 1 and 50 characters');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validation accepts if and only if trimmed length is 1-50 (universal property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary strings including edge cases
        fc.oneof(
          fc.constant(''),                                                    // empty
          fc.array(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 20 }).map(arr => arr.join('')), // whitespace-only
          fc.string({ minLength: 1, maxLength: 50 }),                         // potentially valid
          fc.string({ minLength: 51, maxLength: 200 }),                       // potentially too long
        ),
        async (displayName: string) => {
          mockSend.mockReset();
          mockSend.mockResolvedValue({
            Attributes: {
              userId: 'test-user-id-123',
              displayName: displayName.trim(),
              avatar: null,
            },
          });

          const trimmedLength = displayName.trim().length;
          const shouldAccept = trimmedLength >= 1 && trimmedLength <= 50;

          const event = createPutEvent(displayName);
          const result = await handler(event);

          if (shouldAccept) {
            expect(result.statusCode).toBe(200);
          } else {
            expect(result.statusCode).toBe(400);
            const body = JSON.parse(result.body);
            expect(body.error).toContain('Display name must be between 1 and 50 characters');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
