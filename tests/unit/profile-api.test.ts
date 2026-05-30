import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Use vi.hoisted so mockSend is available inside the hoisted vi.mock factory
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => {
  class MockDynamoDBClient {}
  return { DynamoDBClient: MockDynamoDBClient };
});

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class MockDynamoDBDocumentClient {
    send = mockSend;
    static from() {
      return new MockDynamoDBDocumentClient();
    }
  }
  return {
    DynamoDBDocumentClient: MockDynamoDBDocumentClient,
    GetCommand: class GetCommand {
      _type = 'Get';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    UpdateCommand: class UpdateCommand {
      _type = 'Update';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
  };
});

// Set environment variables before importing handler
process.env.USER_PROFILES_TABLE = 'test-user-profiles-table';

import { handler, AVATAR_OPTIONS } from '../../lambda/profile-api/index';

function createEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    body: null,
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
          sub: 'user-123-abc',
          email: 'test@example.com',
        },
      },
      accountId: '123456789',
      apiId: 'test-api',
      httpMethod: 'GET',
      identity: {} as never,
      path: '/profile',
      protocol: 'HTTP/1.1',
      requestId: 'req-123',
      requestTimeEpoch: Date.now(),
      resourceId: 'resource-123',
      resourcePath: '/profile',
      stage: 'test',
    },
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe('Profile API Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /profile', () => {
    it('returns profile for existing user', async () => {
      mockSend.mockResolvedValue({
        Item: {
          userId: 'user-123-abc',
          displayName: 'TestUser',
          avatar: 'avatar-robot-1',
        },
      });

      const event = createEvent({ httpMethod: 'GET' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.userId).toBe('user-123-abc');
      expect(body.displayName).toBe('TestUser');
      expect(body.avatar).toBe('avatar-robot-1');
    });

    it('returns null defaults for new user', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const event = createEvent({ httpMethod: 'GET' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.userId).toBe('user-123-abc');
      expect(body.displayName).toBeNull();
      expect(body.avatar).toBeNull();
    });

    it('returns 401 for missing auth', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        requestContext: {
          authorizer: null,
          accountId: '123456789',
          apiId: 'test-api',
          httpMethod: 'GET',
          identity: {} as never,
          path: '/profile',
          protocol: 'HTTP/1.1',
          requestId: 'req-123',
          requestTimeEpoch: Date.now(),
          resourceId: 'resource-123',
          resourcePath: '/profile',
          stage: 'test',
        },
      } as Partial<APIGatewayProxyEvent>);

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('PUT /profile - display name validation', () => {
    it('validates display name length (1-50 chars) - accepts valid name', async () => {
      mockSend.mockResolvedValue({
        Attributes: {
          userId: 'user-123-abc',
          displayName: 'ValidName',
          avatar: null,
        },
      });

      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ displayName: 'ValidName' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.displayName).toBe('ValidName');
    });

    it('accepts display name at exactly 50 characters', async () => {
      const name50 = 'A'.repeat(50);
      mockSend.mockResolvedValue({
        Attributes: {
          userId: 'user-123-abc',
          displayName: name50,
          avatar: null,
        },
      });

      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ displayName: name50 }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.displayName).toBe(name50);
    });

    it('accepts display name at exactly 1 character', async () => {
      mockSend.mockResolvedValue({
        Attributes: {
          userId: 'user-123-abc',
          displayName: 'A',
          avatar: null,
        },
      });

      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ displayName: 'A' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.displayName).toBe('A');
    });

    it('rejects empty/whitespace-only display name', async () => {
      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ displayName: '   ' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Display name must be between 1 and 50 characters');
    });

    it('rejects empty string display name', async () => {
      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ displayName: '' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Display name must be between 1 and 50 characters');
    });

    it('rejects display name exceeding 50 characters', async () => {
      const longName = 'A'.repeat(51);
      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ displayName: longName }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Display name must be between 1 and 50 characters');
    });
  });

  describe('PUT /profile - avatar validation', () => {
    it('validates avatar ID against predefined list - accepts valid avatar', async () => {
      mockSend.mockResolvedValue({
        Attributes: {
          userId: 'user-123-abc',
          displayName: null,
          avatar: 'avatar-robot-1',
        },
      });

      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ avatar: 'avatar-robot-1' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.avatar).toBe('avatar-robot-1');
    });

    it('accepts all valid avatar options', async () => {
      for (const avatarId of AVATAR_OPTIONS) {
        mockSend.mockResolvedValue({
          Attributes: {
            userId: 'user-123-abc',
            displayName: null,
            avatar: avatarId,
          },
        });

        const event = createEvent({
          httpMethod: 'PUT',
          body: JSON.stringify({ avatar: avatarId }),
        });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body.avatar).toBe(avatarId);
      }
    });

    it('rejects invalid avatar ID', async () => {
      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ avatar: 'invalid-avatar-id' }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Invalid avatar selection');
    });
  });

  describe('PUT /profile - authentication', () => {
    it('returns 401 for missing auth', async () => {
      const event = createEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({ displayName: 'Test' }),
        requestContext: {
          authorizer: null,
          accountId: '123456789',
          apiId: 'test-api',
          httpMethod: 'PUT',
          identity: {} as never,
          path: '/profile',
          protocol: 'HTTP/1.1',
          requestId: 'req-123',
          requestTimeEpoch: Date.now(),
          resourceId: 'resource-123',
          resourcePath: '/profile',
          stage: 'test',
        },
      } as Partial<APIGatewayProxyEvent>);

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unauthorized');
    });
  });
});
