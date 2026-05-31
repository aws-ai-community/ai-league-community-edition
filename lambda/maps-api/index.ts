import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.MAPS_TABLE;
if (!TABLE_NAME) {
  throw new Error("MAPS_TABLE environment variable is required");
}

const VALID_TILE_KEYS = new Set([
  "normal",
  "wall",
  "start",
  "treasure",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
  "c17",
  "c18",
  "c30",
  "c31",
  "c32",
  "c33",
  "c40",
  "c41",
  "c42",
  "c43",
]);

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function getUserId(event: APIGatewayProxyEvent): string | null {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims || !claims.sub) {
    return null;
  }
  return claims.sub as string;
}

interface ValidationError {
  error: string;
}

function validateMapBody(body: {
  name?: string;
  width?: number;
  height?: number;
  grid?: string[][];
  startingLives?: number;
  timeLimit?: number;
  tileOverrides?: Record<string, { points: number; damage: number }>;
}): ValidationError | null {
  // Validate name
  if (body.name !== undefined) {
    const trimmedName = typeof body.name === 'string' ? body.name.trim() : '';
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      return { error: "Map name must be between 1 and 100 characters" };
    }
  }

  // Validate dimensions
  if (body.width !== undefined) {
    if (!Number.isInteger(body.width) || body.width < 2 || body.width > 12) {
      return { error: "Grid dimensions must be between 2 and 12" };
    }
  }
  if (body.height !== undefined) {
    if (!Number.isInteger(body.height) || body.height < 2 || body.height > 12) {
      return { error: "Grid dimensions must be between 2 and 12" };
    }
  }

  // Validate grid
  if (body.grid !== undefined) {
    if (!Array.isArray(body.grid)) {
      return { error: "Grid must be an array" };
    }

    // Infer dimensions from grid if not explicitly provided
    const inferredHeight = body.grid.length;
    const inferredWidth = inferredHeight > 0 && Array.isArray(body.grid[0]) ? body.grid[0].length : 0;
    const effectiveHeight = body.height ?? inferredHeight;
    const effectiveWidth = body.width ?? inferredWidth;

    // Validate inferred/provided dimensions are within range
    if (effectiveHeight < 2 || effectiveHeight > 12) {
      return { error: "Grid dimensions must be between 2 and 12" };
    }
    if (effectiveWidth < 2 || effectiveWidth > 12) {
      return { error: "Grid dimensions must be between 2 and 12" };
    }

    if (body.grid.length !== effectiveHeight) {
      return { error: "Grid row count must match height" };
    }

    let startCount = 0;
    let treasureCount = 0;

    for (const row of body.grid) {
      if (!Array.isArray(row)) {
        return { error: "Each grid row must be an array" };
      }
      if (row.length !== effectiveWidth) {
        return { error: "Each grid row length must match width" };
      }
      for (const cell of row) {
        if (!VALID_TILE_KEYS.has(cell)) {
          return { error: `Invalid tile key: ${cell}` };
        }
        if (cell === "start") startCount++;
        if (cell === "treasure") treasureCount++;
      }
    }

    if (startCount !== 1) {
      return { error: "Grid must contain exactly one start tile" };
    }
    if (treasureCount !== 1) {
      return { error: "Grid must contain exactly one treasure tile" };
    }
  }

  // Validate startingLives
  if (body.startingLives !== undefined) {
    if (!Number.isInteger(body.startingLives) || body.startingLives < 1) {
      return { error: "startingLives must be an integer greater than or equal to 1" };
    }
  }

  // Validate timeLimit
  if (body.timeLimit !== undefined) {
    if (!Number.isInteger(body.timeLimit) || body.timeLimit < 1) {
      return { error: "timeLimit must be an integer greater than or equal to 1" };
    }
  }

  // Validate tileOverrides
  if (body.tileOverrides !== undefined) {
    if (typeof body.tileOverrides !== "object" || body.tileOverrides === null || Array.isArray(body.tileOverrides)) {
      return { error: "tileOverrides must be an object" };
    }
    for (const [key, value] of Object.entries(body.tileOverrides)) {
      if (!VALID_TILE_KEYS.has(key)) {
        return { error: `Invalid tile key in tileOverrides: ${key}` };
      }
      if (typeof value !== "object" || value === null) {
        return { error: `tileOverrides entry for ${key} must be an object with points and damage` };
      }
      const entry = value as { points?: number; damage?: number };
      if (entry.points === undefined || !Number.isInteger(entry.points) || entry.points < 0) {
        return { error: `tileOverrides entry for ${key} must have integer points >= 0` };
      }
      if (entry.damage === undefined || !Number.isInteger(entry.damage) || entry.damage < 0) {
        return { error: `tileOverrides entry for ${key} must have integer damage >= 0` };
      }
    }
  }

  return null;
}

async function handleList(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
        ProjectionExpression: "mapId, #n, width, height, updatedAt",
        ExpressionAttributeNames: { "#n": "name" },
      })
    );

    const maps = (result.Items || []).map((item) => ({
      mapId: item.mapId,
      name: item.name,
      width: item.width,
      height: item.height,
      updatedAt: item.updatedAt,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ maps }),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

async function handleGet(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const mapId = event.pathParameters?.mapId;
  if (!mapId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing mapId" }),
    };
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId, mapId },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Map not found" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result.Item),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

async function handleCreate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  let body: { name?: string; width?: number; height?: number; grid?: string[][]; startingLives?: number; timeLimit?: number; tileOverrides?: Record<string, { points: number; damage: number }> };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  // Trim name
  if (body.name && typeof body.name === 'string') {
    body.name = body.name.trim();
  }

  // Require all fields for create
  if (!body.name || body.width === undefined || body.height === undefined || !body.grid) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing required fields: name, width, height, grid" }),
    };
  }

  const validationError = validateMapBody(body);
  if (validationError) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify(validationError),
    };
  }

  const now = new Date().toISOString();
  const mapId = crypto.randomUUID();

  const item: Record<string, unknown> = {
    userId,
    mapId,
    name: body.name,
    width: body.width,
    height: body.height,
    grid: body.grid,
    createdAt: now,
    updatedAt: now,
  };

  if (body.startingLives !== undefined) {
    item.startingLives = body.startingLives;
  }
  if (body.timeLimit !== undefined) {
    item.timeLimit = body.timeLimit;
  }
  if (body.tileOverrides !== undefined) {
    item.tileOverrides = body.tileOverrides;
  }

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify(item),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

async function handleUpdate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const mapId = event.pathParameters?.mapId;
  if (!mapId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing mapId" }),
    };
  }

  let body: { name?: string; width?: number; height?: number; grid?: string[][]; startingLives?: number; timeLimit?: number; tileOverrides?: Record<string, { points: number; damage: number }> };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  // If width or height is being changed, grid must also be provided
  if ((body.width !== undefined || body.height !== undefined) && body.grid === undefined) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Grid must be provided when changing dimensions" }),
    };
  }

  // Trim name if provided
  if (body.name !== undefined && typeof body.name === 'string') {
    body.name = body.name.trim();
  }

  const validationError = validateMapBody(body);
  if (validationError) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify(validationError),
    };
  }

  // Verify the map belongs to the user
  try {
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId, mapId },
      })
    );

    if (!existing.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Map not found" }),
      };
    }
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }

  // Build update expression
  const updateExpressionParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updateExpressionParts.push("#n = :name");
    expressionAttributeNames["#n"] = "name";
    expressionAttributeValues[":name"] = body.name;
  }
  if (body.width !== undefined) {
    updateExpressionParts.push("#w = :width");
    expressionAttributeNames["#w"] = "width";
    expressionAttributeValues[":width"] = body.width;
  }
  if (body.height !== undefined) {
    updateExpressionParts.push("#h = :height");
    expressionAttributeNames["#h"] = "height";
    expressionAttributeValues[":height"] = body.height;
  }
  if (body.grid !== undefined) {
    updateExpressionParts.push("#g = :grid");
    expressionAttributeNames["#g"] = "grid";
    expressionAttributeValues[":grid"] = body.grid;
  }
  if (body.startingLives !== undefined) {
    updateExpressionParts.push("#sl = :startingLives");
    expressionAttributeNames["#sl"] = "startingLives";
    expressionAttributeValues[":startingLives"] = body.startingLives;
  }
  if (body.timeLimit !== undefined) {
    updateExpressionParts.push("#tl = :timeLimit");
    expressionAttributeNames["#tl"] = "timeLimit";
    expressionAttributeValues[":timeLimit"] = body.timeLimit;
  }
  if (body.tileOverrides !== undefined) {
    updateExpressionParts.push("#to = :tileOverrides");
    expressionAttributeNames["#to"] = "tileOverrides";
    expressionAttributeValues[":tileOverrides"] = body.tileOverrides;
  }

  if (updateExpressionParts.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "No fields to update" }),
    };
  }

  // Add updatedAt timestamp
  const now = new Date().toISOString();
  updateExpressionParts.push("#u = :updatedAt");
  expressionAttributeNames["#u"] = "updatedAt";
  expressionAttributeValues[":updatedAt"] = now;

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId, mapId },
        UpdateExpression: "SET " + updateExpressionParts.join(", "),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
      })
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result.Attributes),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

async function handleDelete(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const mapId = event.pathParameters?.mapId;
  if (!mapId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing mapId" }),
    };
  }

  // Verify the map belongs to the user before deleting
  try {
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId, mapId },
      })
    );

    if (!existing.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Map not found" }),
      };
    }
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }

  try {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { userId, mapId },
      })
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Map deleted" }),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const mapId = event.pathParameters?.mapId;

  switch (method) {
    case "GET":
      if (mapId) {
        return handleGet(event);
      }
      return handleList(event);
    case "POST":
      return handleCreate(event);
    case "PUT":
      return handleUpdate(event);
    case "DELETE":
      return handleDelete(event);
    default:
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
  }
};
