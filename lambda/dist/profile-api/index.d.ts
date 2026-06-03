import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
export declare const AVATAR_OPTIONS: readonly ["avatar-robot-1", "avatar-robot-2", "avatar-robot-3", "avatar-cloud-1", "avatar-cloud-2", "avatar-cloud-3", "avatar-ai-1", "avatar-ai-2", "avatar-ai-3", "avatar-league-1", "avatar-league-2", "avatar-league-3"];
export type AvatarId = typeof AVATAR_OPTIONS[number];
export declare const handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;
