import { loadSettings } from './settingsLoader';

// --- Dual Auth Support ---
// Module-level token getter function, set from the AuthProvider context via setAuthTokenGetter.
// This allows the non-React graphqlClient module to access the Cognito JWT.
type AuthTokenGetter = () => Promise<string>;
let authTokenGetter: AuthTokenGetter | null = null;

/**
 * Register the auth token getter function. Called from the AuthProvider (or a bridge component)
 * to supply the graphqlClient module with access to the Cognito JWT.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  authTokenGetter = getter;
}

/**
 * Attempt to get a JWT auth token from the registered getter.
 * Returns the token string if available, or null if not authenticated / getter not set.
 */
async function getAuthToken(): Promise<string | null> {
  if (!authTokenGetter) {
    return null;
  }
  try {
    return await authTokenGetter();
  } catch {
    // Token retrieval failed (no session, expired, etc.) — treat as unauthenticated
    return null;
  }
}

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

// Core GraphQL request function with dual auth support
async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  requireAuth: boolean = false,
): Promise<T> {
  const settings = await loadSettings();
  const { endpoint } = settings.graphql;
  const apiKey = settings.graphqlApiKey;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Dual auth: try JWT first, fall back to API key
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = token;
  } else if (requireAuth) {
    throw new Error('Authentication required. Please sign in.');
  } else {
    headers['x-api-key'] = apiKey;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
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

export async function submitToLeaderboard(leaderboardId: string, sessionId: string, modelId?: string): Promise<{ SubmitToLeaderboard: MutationResponse }> {
  const query = `
    mutation SubmitToLeaderboard($leaderboardId: String!, $sessionId: String!, $modelId: String) {
      SubmitToLeaderboard(leaderboardId: $leaderboardId, sessionId: $sessionId, modelId: $modelId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ SubmitToLeaderboard: MutationResponse }>(query, { leaderboardId, sessionId, modelId: modelId ?? null });
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

// --- Phase 2: Agent Builder Types and Helpers ---

export interface SupervisorAgentConfig {
  agentId?: string;
  userId?: string;
  name: string;
  systemPrompt: string;
  modelId: string;
  subAgents: string[];
  lambdaTools: string[];
  memoryTool: string | null;
  guardrailTool: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubAgentConfig {
  agentId: string;
  userId?: string;
  name: string;
  systemPrompt: string;
  modelId: string;
  lambdaTools: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LambdaToolConfig {
  toolId: string;
  userId?: string;
  name: string;
  functionName: string;
  runtime?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MemoryToolConfig {
  toolId: string;
  userId?: string;
  name: string;
  memoryId: string;
  description?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GuardrailToolConfig {
  toolId: string;
  userId?: string;
  name: string;
  guardrailId: string;
  description?: string;
  status?: string;
  fullSDKResponse?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentVersionConfig {
  versionId: string;
  userId?: string;
  name?: string;
  supervisorConfig?: string;
  finalScore?: number;
  subAgentCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateModelResponse {
  modelId: string;
  success: boolean;
  message?: string;
}

// Phase 2 Query Helpers

export async function getSupervisorAgent(): Promise<{ GetSupervisorAgent: SupervisorAgentConfig }> {
  const query = `
    query GetSupervisorAgent {
      GetSupervisorAgent {
        agentId
        userId
        name
        systemPrompt
        modelId
        subAgents
        lambdaTools
        memoryTool
        guardrailTool
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ GetSupervisorAgent: SupervisorAgentConfig }>(query, undefined, true);
}

export async function listSubAgents(): Promise<{ ListSubAgents: SubAgentConfig[] }> {
  const query = `
    query ListSubAgents {
      ListSubAgents {
        agentId
        userId
        name
        systemPrompt
        modelId
        lambdaTools
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ ListSubAgents: SubAgentConfig[] }>(query, undefined, true);
}

export async function getSubAgent(agentId: string): Promise<{ GetSubAgent: SubAgentConfig }> {
  const query = `
    query GetSubAgent($agentId: String!) {
      GetSubAgent(agentId: $agentId) {
        agentId
        userId
        name
        systemPrompt
        modelId
        lambdaTools
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ GetSubAgent: SubAgentConfig }>(query, { agentId }, true);
}

export async function listLambdaTools(): Promise<{ ListLambdaTool: LambdaToolConfig[] }> {
  const query = `
    query ListLambdaTool {
      ListLambdaTool {
        toolId
        userId
        name
        functionName
        runtime
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ ListLambdaTool: LambdaToolConfig[] }>(query, undefined, true);
}

export async function listMemoryTools(): Promise<{ ListMemory: MemoryToolConfig[] }> {
  const query = `
    query ListMemory {
      ListMemory {
        toolId
        userId
        name
        memoryId
        description
        status
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ ListMemory: MemoryToolConfig[] }>(query, undefined, true);
}

export async function listGuardrailTools(): Promise<{ ListGuardrail: GuardrailToolConfig[] }> {
  const query = `
    query ListGuardrail {
      ListGuardrail {
        toolId
        userId
        name
        guardrailId
        description
        status
        fullSDKResponse
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ ListGuardrail: GuardrailToolConfig[] }>(query, undefined, true);
}

export async function getAgentCoreRuntime(): Promise<{ GetAgentCoreRuntime: { runtimeArn: string | null; status: string | null; message: string | null } }> {
  const query = `
    query GetAgentCoreRuntime {
      GetAgentCoreRuntime {
        runtimeArn
        status
        message
      }
    }
  `;
  return graphqlRequest<{ GetAgentCoreRuntime: { runtimeArn: string | null; status: string | null; message: string | null } }>(query, undefined, true);
}

export async function listAgentVersions(): Promise<{ ListAgentVersions: AgentVersionConfig[] }> {
  const query = `
    query ListAgentVersions {
      ListAgentVersions {
        versionId
        userId
        name
        supervisorConfig
        finalScore
        subAgentCount
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ ListAgentVersions: AgentVersionConfig[] }>(query, undefined, true);
}

// Phase 2 Mutation Helpers

export async function updateSupervisorAgent(config: { name: string; systemPrompt: string; modelId: string; subAgents: string[]; lambdaTools: string[]; memoryTool?: string | null; guardrailTool?: string | null }): Promise<{ UpdateSupervisorAgent: SupervisorAgentConfig }> {
  const query = `
    mutation UpdateSupervisorAgent($name: String!, $systemPrompt: String!, $modelId: String!, $subAgents: [String!]!, $lambdaTools: [String!]!, $memoryTool: String, $guardrailTool: String) {
      UpdateSupervisorAgent(name: $name, systemPrompt: $systemPrompt, modelId: $modelId, subAgents: $subAgents, lambdaTools: $lambdaTools, memoryTool: $memoryTool, guardrailTool: $guardrailTool) {
        agentId
        userId
        name
        systemPrompt
        modelId
        subAgents
        lambdaTools
        memoryTool
        guardrailTool
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ UpdateSupervisorAgent: SupervisorAgentConfig }>(query, {
    name: config.name,
    systemPrompt: config.systemPrompt,
    modelId: config.modelId,
    subAgents: config.subAgents,
    lambdaTools: config.lambdaTools,
    memoryTool: config.memoryTool ?? null,
    guardrailTool: config.guardrailTool ?? null,
  }, true);
}

export async function createSubAgent(config: { name: string; systemPrompt: string; modelId: string; lambdaTools: string[] }): Promise<{ CreateSubAgent: SubAgentConfig }> {
  const query = `
    mutation CreateSubAgent($name: String!, $systemPrompt: String!, $modelId: String!, $lambdaTools: [String!]!) {
      CreateSubAgent(name: $name, systemPrompt: $systemPrompt, modelId: $modelId, lambdaTools: $lambdaTools) {
        agentId
        userId
        name
        systemPrompt
        modelId
        lambdaTools
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ CreateSubAgent: SubAgentConfig }>(query, {
    name: config.name,
    systemPrompt: config.systemPrompt,
    modelId: config.modelId,
    lambdaTools: config.lambdaTools,
  }, true);
}

export async function updateSubAgent(agentId: string, config: { name: string; systemPrompt: string; modelId: string; lambdaTools: string[] }): Promise<{ UpdateSubAgent: SubAgentConfig }> {
  const query = `
    mutation UpdateSubAgent($agentId: String!, $name: String!, $systemPrompt: String!, $modelId: String!, $lambdaTools: [String!]!) {
      UpdateSubAgent(agentId: $agentId, name: $name, systemPrompt: $systemPrompt, modelId: $modelId, lambdaTools: $lambdaTools) {
        agentId
        userId
        name
        systemPrompt
        modelId
        lambdaTools
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ UpdateSubAgent: SubAgentConfig }>(query, {
    agentId,
    name: config.name,
    systemPrompt: config.systemPrompt,
    modelId: config.modelId,
    lambdaTools: config.lambdaTools,
  }, true);
}

export async function deleteSubAgent(agentId: string): Promise<{ DeleteSubAgent: MutationResponse }> {
  const query = `
    mutation DeleteSubAgent($agentId: String!) {
      DeleteSubAgent(agentId: $agentId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ DeleteSubAgent: MutationResponse }>(query, { agentId }, true);
}

export async function updateLambdaTool(config: { name: string; functionName: string }): Promise<{ UpdateLambdaTool: LambdaToolConfig }> {
  const query = `
    mutation UpdateLambdaTool($name: String!, $functionName: String!) {
      UpdateLambdaTool(name: $name, functionName: $functionName) {
        toolId
        userId
        name
        functionName
        runtime
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ UpdateLambdaTool: LambdaToolConfig }>(query, {
    name: config.name,
    functionName: config.functionName,
  }, true);
}

export async function deleteLambdaTool(toolId: string): Promise<{ DeleteLambdaTool: MutationResponse }> {
  const query = `
    mutation DeleteLambdaTool($toolId: String!) {
      DeleteLambdaTool(toolId: $toolId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ DeleteLambdaTool: MutationResponse }>(query, { toolId }, true);
}

export async function createMemory(config: { name: string; description?: string }): Promise<{ CreateMemory: MemoryToolConfig }> {
  const query = `
    mutation CreateMemory($name: String!, $description: String) {
      CreateMemory(name: $name, description: $description) {
        toolId
        userId
        name
        memoryId
        description
        status
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ CreateMemory: MemoryToolConfig }>(query, {
    name: config.name,
    description: config.description ?? null,
  }, true);
}

export async function deleteMemory(toolId: string): Promise<{ DeleteMemory: MutationResponse }> {
  const query = `
    mutation DeleteMemory($toolId: String!) {
      DeleteMemory(toolId: $toolId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ DeleteMemory: MutationResponse }>(query, { toolId }, true);
}

export async function createGuardrail(config: { name: string; description?: string; blockedInputMessaging?: string; blockedOutputsMessaging?: string; contentPolicyConfig?: string }): Promise<{ CreateGuardrail: GuardrailToolConfig }> {
  const query = `
    mutation CreateGuardrail($name: String!, $description: String, $blockedInputMessaging: String, $blockedOutputsMessaging: String, $contentPolicyConfig: String) {
      CreateGuardrail(name: $name, description: $description, blockedInputMessaging: $blockedInputMessaging, blockedOutputsMessaging: $blockedOutputsMessaging, contentPolicyConfig: $contentPolicyConfig) {
        toolId
        userId
        name
        guardrailId
        description
        status
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ CreateGuardrail: GuardrailToolConfig }>(query, {
    name: config.name,
    description: config.description ?? null,
    blockedInputMessaging: config.blockedInputMessaging ?? null,
    blockedOutputsMessaging: config.blockedOutputsMessaging ?? null,
    contentPolicyConfig: config.contentPolicyConfig ?? null,
  }, true);
}

export async function deleteGuardrail(toolId: string): Promise<{ DeleteGuardrail: MutationResponse }> {
  const query = `
    mutation DeleteGuardrail($toolId: String!) {
      DeleteGuardrail(toolId: $toolId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ DeleteGuardrail: MutationResponse }>(query, { toolId }, true);
}

// --- Phase 3: Lambda Tool Management, IDE Controls, Schema Config, Reset ---

export interface CodeEditorStatusResponse {
  status: string;
  message: string | null;
}

export interface SchemaModelConfigResponse {
  modelId: string;
}

export async function createLambdaTool(name: string): Promise<{ CreateLambdaTool: LambdaToolConfig }> {
  const query = `
    mutation CreateLambdaTool($name: String!) {
      CreateLambdaTool(name: $name) {
        toolId
        userId
        name
        functionName
        runtime
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ CreateLambdaTool: LambdaToolConfig }>(query, { name }, true);
}

export async function getCodeEditorStatus(): Promise<{ GetCodeEditorStatus: CodeEditorStatusResponse }> {
  const query = `
    query GetCodeEditorStatus {
      GetCodeEditorStatus {
        status
        message
      }
    }
  `;
  return graphqlRequest<{ GetCodeEditorStatus: CodeEditorStatusResponse }>(query, undefined, true);
}

export async function startCodeEditor(): Promise<{ StartCodeEditor: CodeEditorStatusResponse }> {
  const query = `
    mutation StartCodeEditor {
      StartCodeEditor {
        status
        message
      }
    }
  `;
  return graphqlRequest<{ StartCodeEditor: CodeEditorStatusResponse }>(query, undefined, true);
}

export async function stopCodeEditor(): Promise<{ StopCodeEditor: CodeEditorStatusResponse }> {
  const query = `
    mutation StopCodeEditor {
      StopCodeEditor {
        status
        message
      }
    }
  `;
  return graphqlRequest<{ StopCodeEditor: CodeEditorStatusResponse }>(query, undefined, true);
}

export async function getSchemaModelConfig(): Promise<{ GetSchemaModelConfig: SchemaModelConfigResponse }> {
  const query = `
    query GetSchemaModelConfig {
      GetSchemaModelConfig {
        modelId
      }
    }
  `;
  return graphqlRequest<{ GetSchemaModelConfig: SchemaModelConfigResponse }>(query, undefined, true);
}

export async function saveSchemaModelConfig(modelId: string): Promise<{ SaveSchemaModelConfig: MutationResponse }> {
  const query = `
    mutation SaveSchemaModelConfig($modelId: String!) {
      SaveSchemaModelConfig(modelId: $modelId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ SaveSchemaModelConfig: MutationResponse }>(query, { modelId }, true);
}

export async function resetConfiguration(): Promise<{ ResetConfiguration: MutationResponse }> {
  const query = `
    mutation ResetConfiguration {
      ResetConfiguration {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ ResetConfiguration: MutationResponse }>(query, undefined, true);
}

export async function getPresignedDomainUrl(): Promise<{ GetPresignedDomainUrl: { authorizedUrl: string; error?: string } }> {
  const query = `query { GetPresignedDomainUrl { authorizedUrl error } }`;
  return graphqlRequest<{ GetPresignedDomainUrl: { authorizedUrl: string; error?: string } }>(query, undefined, true);
}

export async function createModel(config: { name: string; resourceIdentifier: string; type: string; pathfindingPromptStrategy?: string }): Promise<{ CreateModel: CreateModelResponse }> {
  const query = `
    mutation CreateModel($name: String!, $resourceIdentifier: String!, $type: String!, $pathfindingPromptStrategy: String) {
      CreateModel(name: $name, resourceIdentifier: $resourceIdentifier, type: $type, pathfindingPromptStrategy: $pathfindingPromptStrategy) {
        modelId
        success
        message
      }
    }
  `;
  return graphqlRequest<{ CreateModel: CreateModelResponse }>(query, {
    name: config.name,
    resourceIdentifier: config.resourceIdentifier,
    type: config.type,
    pathfindingPromptStrategy: config.pathfindingPromptStrategy ?? null,
  }, true);
}

// --- Fine-Tuning Types and Helpers ---

export interface TrainingArtifactUrlResponse {
  url: string;
  expiresIn: number;
}

export async function getTrainingArtifactUrl(artifactKey: string): Promise<{ GetTrainingArtifactUrl: TrainingArtifactUrlResponse }> {
  const query = `
    query GetTrainingArtifactUrl($artifactKey: String!) {
      GetTrainingArtifactUrl(artifactKey: $artifactKey) {
        url
        expiresIn
      }
    }
  `;
  return graphqlRequest<{ GetTrainingArtifactUrl: TrainingArtifactUrlResponse }>(query, { artifactKey }, true);
}

export interface StudioPresignedUrlResponse {
  url: string;
  error: string | null;
}

export async function getStudioPresignedUrl(): Promise<{ GetStudioPresignedUrl: StudioPresignedUrlResponse }> {
  const query = `
    query GetStudioPresignedUrl {
      GetStudioPresignedUrl {
        url
        error
      }
    }
  `;
  return graphqlRequest<{ GetStudioPresignedUrl: StudioPresignedUrlResponse }>(query, undefined, true);
}

// --- Fine-Tuning Types and Helpers ---

export interface CustomModelResponse {
  modelId: string;
  userId: string | null;
  name: string;
  trainingJobArn: string;
  deploymentArn: string | null;
  status: string;
  baseModelId: string | null;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function registerCustomModel(name: string, trainingJobArn: string): Promise<{ RegisterCustomModel: CustomModelResponse }> {
  const query = `
    mutation RegisterCustomModel($name: String!, $trainingJobArn: String!) {
      RegisterCustomModel(name: $name, trainingJobArn: $trainingJobArn) {
        modelId
        userId
        name
        trainingJobArn
        deploymentArn
        status
        baseModelId
        failureReason
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ RegisterCustomModel: CustomModelResponse }>(query, { name, trainingJobArn }, true);
}

export async function listCustomModels(): Promise<{ ListCustomModels: CustomModelResponse[] }> {
  const query = `
    query ListCustomModels {
      ListCustomModels {
        modelId
        userId
        name
        trainingJobArn
        deploymentArn
        status
        baseModelId
        failureReason
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ ListCustomModels: CustomModelResponse[] }>(query, undefined, true);
}

export async function deployCustomModel(modelId: string): Promise<{ DeployCustomModel: CustomModelResponse }> {
  const query = `
    mutation DeployCustomModel($modelId: String!) {
      DeployCustomModel(modelId: $modelId) {
        modelId
        userId
        name
        trainingJobArn
        deploymentArn
        status
        baseModelId
        failureReason
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ DeployCustomModel: CustomModelResponse }>(query, { modelId }, true);
}

export async function deleteCustomModel(modelId: string, force?: boolean): Promise<{ DeleteCustomModel: MutationResponse }> {
  const query = `
    mutation DeleteCustomModel($modelId: String!, $force: Boolean) {
      DeleteCustomModel(modelId: $modelId, force: $force) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ DeleteCustomModel: MutationResponse }>(query, { modelId, force: force ?? null }, true);
}

export async function undeployCustomModel(modelId: string): Promise<{ UndeployCustomModel: MutationResponse }> {
  const query = `
    mutation UndeployCustomModel($modelId: String!) {
      UndeployCustomModel(modelId: $modelId) {
        success
        statusCode
        message
      }
    }
  `;
  return graphqlRequest<{ UndeployCustomModel: MutationResponse }>(query, { modelId }, true);
}

export async function getCustomModelStatus(modelId: string): Promise<{ GetCustomModelStatus: CustomModelResponse }> {
  const query = `
    query GetCustomModelStatus($modelId: String!) {
      GetCustomModelStatus(modelId: $modelId) {
        modelId
        userId
        name
        trainingJobArn
        deploymentArn
        status
        baseModelId
        failureReason
        createdAt
        updatedAt
      }
    }
  `;
  return graphqlRequest<{ GetCustomModelStatus: CustomModelResponse }>(query, { modelId }, true);
}

export interface GenerateChallengeResponse {
  question: string;
  expectedAnswer: string;
  gradingStrategy: string;
  url?: string;
  pairedQuestion?: string;
  pairedExpectedAnswer?: string;
  pairedGradingStrategy?: string;
  pairedTileType?: string;
}

export async function generateChallenge(tileType: string, grid?: string[][]): Promise<{ GenerateChallenge: GenerateChallengeResponse }> {
  const query = `
    mutation GenerateChallenge($tileType: String!, $grid: [[String]]) {
      GenerateChallenge(tileType: $tileType, grid: $grid) {
        question
        expectedAnswer
        gradingStrategy
        url
        pairedQuestion
        pairedExpectedAnswer
        pairedGradingStrategy
        pairedTileType
      }
    }
  `;
  return graphqlRequest<{ GenerateChallenge: GenerateChallengeResponse }>(query, { tileType, grid: grid || null }, true);
}
