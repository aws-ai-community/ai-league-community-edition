import { loadSettings } from './settingsLoader';

// Response types matching the GraphQL schema
export interface GameSessionResponse {
  sessionId: string;
  status: string;
  gameEvents: string | null;
  consumedTiles: string | null;
  plannedPath: string | null;
  error: string | null;
  agentResponse: string | null;
  finalScore: number | null;
  qaScore: number | null;
  lifeBonusScore: number | null;
  givenTokenBonus: number | null;
  treasureBonus: number | null;
  livesRemaining: number | null;
  reachedTreasure: boolean | null;
  customModelCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface InvokeRuntimeResponse {
  sessionId: string;
  status: string;
  message: string | null;
  gameEvents: string | null;
  finalScore: number | null;
  qaScore: number | null;
  lifeBonusScore: number | null;
  givenTokenBonus: number | null;
  treasureBonus: number | null;
  livesRemaining: number | null;
  reachedTreasure: boolean | null;
}

export interface LeaderboardEntry {
  userId: string;
  alias: string | null;
  avatar: string | null;
  bestScore: number | null;
  lastScore: number | null;
  totalSubmissions: number | null;
  rank: number | null;
}

export interface SubmissionHistoryEntry {
  updatedTime: string | null;
  mapId: string | null;
  leaderboardId: string | null;
  finalScore: number | null;
  correctAnswers: number | null;
  totalChallenges: number | null;
  qaScore: number | null;
  lifeBonusScore: number | null;
  givenTokenBonus: number | null;
  livesRemaining: number | null;
}

export interface MutationResponse {
  success: boolean;
  statusCode: number | null;
  message: string | null;
}

export interface LlmConfigurationResponse {
  defaultModel: string | null;
  challengeGeneration: string | null;
  challengeGrading: string | null;
  gameCommentary: string | null;
}

// Core GraphQL request function
async function graphqlRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const settings = await loadSettings();
  const { endpoint } = settings.graphql;
  const apiKey = settings.graphqlApiKey;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GraphQL request failed: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`GraphQL request failed: HTTP ${response.status} ${response.statusText}`);
  }

  let body: { data?: T; errors?: { message: string }[] };
  try {
    body = await response.json();
  } catch {
    throw new Error(`GraphQL request failed: response is not valid JSON (HTTP ${response.status})`);
  }

  if (body.errors && body.errors.length > 0) {
    throw new Error(body.errors[0].message);
  }

  return body.data as T;
}

// Typed helper functions

export async function getMap(mapId: string): Promise<{ GetMap: { mapData: string | null } }> {
  const query = `
    query GetMap($mapId: String!) {
      GetMap(mapId: $mapId) {
        mapData
      }
    }
  `;
  return graphqlRequest<{ GetMap: { mapData: string | null } }>(query, { mapId });
}

export async function getGameSession(sessionId: string): Promise<{ GetGameSession: GameSessionResponse }> {
  const query = `
    query GetGameSession($sessionId: String!) {
      GetGameSession(sessionId: $sessionId) {
        sessionId
        status
        gameEvents
        consumedTiles
        plannedPath
        error
        agentResponse
        finalScore
        qaScore
        lifeBonusScore
        givenTokenBonus
        treasureBonus
        livesRemaining
        reachedTreasure
        customModelCount
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ GetGameSession: GameSessionResponse }>(query, { sessionId });
}

export async function getLeaderboardSubmissions(leaderboardId: string): Promise<{ GetLeaderboardSubmissions: { entries: LeaderboardEntry[] } }> {
  const query = `
    query GetLeaderboardSubmissions($leaderboardId: String!) {
      GetLeaderboardSubmissions(leaderboardId: $leaderboardId) {
        entries {
          userId
          alias
          avatar
          bestScore
          lastScore
          totalSubmissions
          rank
        }
      }
    }
  `;
  return graphqlRequest<{ GetLeaderboardSubmissions: { entries: LeaderboardEntry[] } }>(query, { leaderboardId });
}

export async function getSubmissionHistory(mapId?: string): Promise<{ GetSubmissionHistory: { items: SubmissionHistoryEntry[] } }> {
  const query = `
    query GetSubmissionHistory($mapId: String) {
      GetSubmissionHistory(mapId: $mapId) {
        items {
          updatedTime
          mapId
          leaderboardId
          finalScore
          correctAnswers
          totalChallenges
          qaScore
          lifeBonusScore
          givenTokenBonus
          livesRemaining
        }
      }
    }
  `;
  return graphqlRequest<{ GetSubmissionHistory: { items: SubmissionHistoryEntry[] } }>(query, { mapId });
}

export async function invokeAgentCoreRuntime(input: { mapId: string; navigationPath: string; customModelCount?: number; mapData?: string }): Promise<{ InvokeAgentCoreRuntime: InvokeRuntimeResponse }> {
  const query = `
    mutation InvokeAgentCoreRuntime($mapId: String!, $navigationPath: String!, $customModelCount: Int, $mapData: String) {
      InvokeAgentCoreRuntime(mapId: $mapId, navigationPath: $navigationPath, customModelCount: $customModelCount, mapData: $mapData) {
        sessionId
        status
        message
        gameEvents
        finalScore
        qaScore
        lifeBonusScore
        givenTokenBonus
        treasureBonus
        livesRemaining
        reachedTreasure
      }
    }
  `;
  return graphqlRequest<{ InvokeAgentCoreRuntime: InvokeRuntimeResponse }>(query, {
    mapId: input.mapId,
    navigationPath: input.navigationPath,
    customModelCount: input.customModelCount,
    mapData: input.mapData,
  });
}

export async function submitToLeaderboard(leaderboardId: string, sessionId: string): Promise<{ SubmitToLeaderboard: MutationResponse }> {
  const query = `
    mutation SubmitToLeaderboard($leaderboardId: String!, $sessionId: String!) {
      SubmitToLeaderboard(leaderboardId: $leaderboardId, sessionId: $sessionId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ SubmitToLeaderboard: MutationResponse }>(query, { leaderboardId, sessionId });
}

export async function getLlmConfiguration(): Promise<{ GetLlmConfiguration: LlmConfigurationResponse }> {
  const query = `
    query GetLlmConfiguration {
      GetLlmConfiguration {
        defaultModel
        challengeGeneration
        challengeGrading
        gameCommentary
      }
    }
  `;
  return graphqlRequest<{ GetLlmConfiguration: LlmConfigurationResponse }>(query);
}

export async function saveLlmConfiguration(config: { defaultModel?: string; challengeGeneration?: string; challengeGrading?: string; gameCommentary?: string }): Promise<{ SaveLlmConfiguration: MutationResponse }> {
  const query = `
    mutation SaveLlmConfiguration($defaultModel: String, $challengeGeneration: String, $challengeGrading: String, $gameCommentary: String) {
      SaveLlmConfiguration(defaultModel: $defaultModel, challengeGeneration: $challengeGeneration, challengeGrading: $challengeGrading, gameCommentary: $gameCommentary) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ SaveLlmConfiguration: MutationResponse }>(query, {
    defaultModel: config.defaultModel,
    challengeGeneration: config.challengeGeneration,
    challengeGrading: config.challengeGrading,
    gameCommentary: config.gameCommentary,
  });
}
