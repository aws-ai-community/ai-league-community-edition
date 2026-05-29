import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.USER_PROFILES_TABLE!;

export const AVATAR_OPTIONS = [
  'avatar-robot-1', 'avatar-robot-2', 'avatar-robot-3',
  'avatar-cloud-1', 'avatar-cloud-2', 'avatar-cloud-3',
  'avatar-ai-1', 'avatar-ai-2', 'avatar-ai-3',
  'avatar-league-1', 'avatar-league-2', 'avatar-league-3',
] as const;

export type AvatarId = typeof AVATAR_OPTIONS[number];

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

async function handleGet(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId },
    })
  );

  const profile = result.Item;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      userId,
      displayName: profile?.displayName ?? null,
      avatar: profile?.avatar ?? null,
    }),
  };
}

async function handlePut(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  let body: { displayName?: string; avatar?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid request body" }),
    };
  }

  const updateExpressionParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, string> = {};

  // Validate and process displayName
  if (body.displayName !== undefined) {
    const trimmed = body.displayName.trim();
    if (trimmed.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Display name must be between 1 and 50 characters" }),
      };
    }
    if (trimmed.length > 50) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Display name must be between 1 and 50 characters" }),
      };
    }
    updateExpressionParts.push("#displayName = :displayName");
    expressionAttributeNames["#displayName"] = "displayName";
    expressionAttributeValues[":displayName"] = trimmed;
  }

  // Validate and process avatar
  if (body.avatar !== undefined) {
    if (!(AVATAR_OPTIONS as readonly string[]).includes(body.avatar)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid avatar selection" }),
      };
    }
    updateExpressionParts.push("#avatar = :avatar");
    expressionAttributeNames["#avatar"] = "avatar";
    expressionAttributeValues[":avatar"] = body.avatar;
  }

  // If nothing to update, return current profile
  if (updateExpressionParts.length === 0) {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId },
      })
    );
    const profile = result.Item;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        userId,
        displayName: profile?.displayName ?? null,
        avatar: profile?.avatar ?? null,
      }),
    };
  }

  // Add updatedAt timestamp
  const now = new Date().toISOString();
  updateExpressionParts.push("#updatedAt = :updatedAt");
  expressionAttributeNames["#updatedAt"] = "updatedAt";
  expressionAttributeValues[":updatedAt"] = now;

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { userId },
        UpdateExpression: "SET " + updateExpressionParts.join(", "),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
      })
    );

    const updated = result.Attributes!;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        userId,
        displayName: updated.displayName ?? null,
        avatar: updated.avatar ?? null,
      }),
    };
  } catch {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to update profile" }),
    };
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  switch (event.httpMethod) {
    case "GET":
      return handleGet(event);
    case "PUT":
      return handlePut(event);
    default:
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
  }
};
