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
    QueryCommand: class QueryCommand {
      _type = 'Query';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    GetCommand: class GetCommand {
      _type = 'Get';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    PutCommand: class PutCommand {
      _type = 'Put';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    UpdateCommand: class UpdateCommand {
      _type = 'Update';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
    DeleteCommand: class DeleteCommand {
      _type = 'Delete';
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
  };
});

// Set environment variables before importing handler
vi.hoisted(() => {
  process.env.MAPS_TABLE = 'test-maps-table';
});

import { handler } from '../../lambda/maps-api/index';

function createEvent(
  overrides: Partial<APIGatewayProxyEvent> = {}
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/v1/maps',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/v1/maps',
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
      path: '/v1/maps',
      protocol: 'HTTP/1.1',
      requestId: 'req-123',
      requestTimeEpoch: Date.now(),
      resourceId: 'resource-123',
      resourcePath: '/v1/maps',
      stage: 'test',
    },
    ...overrides,
  } as APIGatewayProxyEvent;
}

function createNoAuthEvent(
  overrides: Partial<APIGatewayProxyEvent> = {}
): APIGatewayProxyEvent {
  return createEvent({
    ...overrides,
    requestContext: {
      authorizer: null,
      accountId: '123456789',
      apiId: 'test-api',
      httpMethod: overrides.httpMethod || 'GET',
      identity: {} as never,
      path: '/v1/maps',
      protocol: 'HTTP/1.1',
      requestId: 'req-123',
      requestTimeEpoch: Date.now(),
      resourceId: 'resource-123',
      resourcePath: '/v1/maps',
      stage: 'test',
    },
  } as Partial<APIGatewayProxyEvent>);
}

// A valid grid: 3x3 with one start and one treasure
const VALID_GRID = [
  ['start', 'normal', 'normal'],
  ['normal', 'wall', 'normal'],
  ['normal', 'normal', 'treasure'],
];

describe('Maps API Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /v1/maps - list maps', () => {
    it('returns list of maps for user', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            mapId: 'map-1',
            name: 'Test Map',
            width: 5,
            height: 5,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      const event = createEvent({ httpMethod: 'GET' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.maps).toHaveLength(1);
      expect(body.maps[0].mapId).toBe('map-1');
      expect(body.maps[0].name).toBe('Test Map');
    });

    it('returns 401 for missing auth', async () => {
      const event = createNoAuthEvent({ httpMethod: 'GET' });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('POST /v1/maps - create map', () => {
    it('creates a map with valid data (returns 201)', async () => {
      mockSend.mockResolvedValue({});

      const event = createEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'My Map',
          width: 3,
          height: 3,
          grid: VALID_GRID,
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.name).toBe('My Map');
      expect(body.width).toBe(3);
      expect(body.height).toBe(3);
      expect(body.grid).toEqual(VALID_GRID);
      expect(body.mapId).toBeDefined();
      expect(body.userId).toBe('user-123-abc');
    });

    it('rejects invalid name (returns 400)', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: '',
          width: 3,
          height: 3,
          grid: VALID_GRID,
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('name');
    });

    it('rejects name exceeding 100 characters (returns 400)', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'A'.repeat(101),
          width: 3,
          height: 3,
          grid: VALID_GRID,
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('name');
    });

    it('rejects dimensions out of range (returns 400)', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'My Map',
          width: 13,
          height: 3,
          grid: VALID_GRID,
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('dimensions');
    });

    it('rejects width below minimum (returns 400)', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'My Map',
          width: 1,
          height: 3,
          grid: VALID_GRID,
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('dimensions');
    });

    it('rejects invalid tile keys (returns 400)', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'My Map',
          width: 3,
          height: 3,
          grid: [
            ['start', 'normal', 'normal'],
            ['normal', 'INVALID_TILE', 'normal'],
            ['normal', 'normal', 'treasure'],
          ],
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Invalid tile key');
    });

    it('rejects missing start/treasure (returns 400)', async () => {
      const event = createEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'My Map',
          width: 3,
          height: 3,
          grid: [
            ['normal', 'normal', 'normal'],
            ['normal', 'wall', 'normal'],
            ['normal', 'normal', 'normal'],
          ],
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('start');
    });

    it('returns 401 for missing auth', async () => {
      const event = createNoAuthEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          name: 'My Map',
          width: 3,
          height: 3,
          grid: VALID_GRID,
        }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('GET /v1/maps/{mapId} - get map', () => {
    it('returns 404 for non-existent map', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const event = createEvent({
        httpMethod: 'GET',
        pathParameters: { mapId: 'non-existent-id' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Map not found');
    });

    it('returns map data for existing map', async () => {
      mockSend.mockResolvedValue({
        Item: {
          userId: 'user-123-abc',
          mapId: 'map-1',
          name: 'Test Map',
          width: 3,
          height: 3,
          grid: VALID_GRID,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      const event = createEvent({
        httpMethod: 'GET',
        pathParameters: { mapId: 'map-1' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.mapId).toBe('map-1');
      expect(body.name).toBe('Test Map');
    });

    it('returns 401 for missing auth', async () => {
      const event = createNoAuthEvent({
        httpMethod: 'GET',
        pathParameters: { mapId: 'map-1' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('DELETE /v1/maps/{mapId} - delete map', () => {
    it('returns 404 for non-existent map', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const event = createEvent({
        httpMethod: 'DELETE',
        pathParameters: { mapId: 'non-existent-id' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Map not found');
    });

    it('deletes existing map successfully', async () => {
      // First call (Get) returns the item, second call (Delete) succeeds
      mockSend
        .mockResolvedValueOnce({
          Item: {
            userId: 'user-123-abc',
            mapId: 'map-1',
            name: 'Test Map',
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent({
        httpMethod: 'DELETE',
        pathParameters: { mapId: 'map-1' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Map deleted');
    });

    it('returns 401 for missing auth', async () => {
      const event = createNoAuthEvent({
        httpMethod: 'DELETE',
        pathParameters: { mapId: 'map-1' },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Unauthorized');
    });
  });
});
