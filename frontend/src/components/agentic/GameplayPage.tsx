import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Textarea from '@cloudscape-design/components/textarea';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Grid from '@cloudscape-design/components/grid';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Alert from '@cloudscape-design/components/alert';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';

import { useAuth } from '../../contexts/AuthProvider';
import { listMaps, getMap as getMapFromApi, MapDocument } from '../../services/mapsApi';
import { invokeAgentCoreRuntime, getGameSession, submitToLeaderboard, createModel, getAgentCoreRuntime, listCustomModels, getSupervisorAgent, listSubAgents } from '../../services/graphqlClient';
import { useModelWarmup } from '../../hooks/useModelWarmup';
import { WarmUpOverlay } from './WarmUpOverlay';
import { TILE_SPRITES, TileKey } from '../map-builder/tileData';
import { PREDEFINED_MAPS, PredefinedMap } from '../../data/predefinedMaps';
import championSprite from '../../assets/sprites/avatar.png';
import livesSprite from '../../assets/sprites/lives.png';
import timeSprite from '../../assets/sprites/time.png';

// Normal tile used as background for all non-wall cells
const NORMAL_BG = TILE_SPRITES['normal'];

/**
 * Compute the number of distinct deployed custom models referenced in agent configuration.
 * Counts deployed custom models whose deploymentArn matches any modelId in the
 * supervisor or sub-agent configs.
 */
async function computeCustomModelCount(): Promise<number> {
  try {
    // Fetch custom models and agent config in parallel
    const [customModelsRes, supervisorRes, subAgentsRes] = await Promise.all([
      listCustomModels(),
      getSupervisorAgent().catch(() => null),
      listSubAgents().catch(() => null),
    ]);

    const customModels = customModelsRes.ListCustomModels || [];
    const deployedModels = customModels.filter(
      (m) => m.status === 'Deployed' && m.deploymentArn
    );

    if (deployedModels.length === 0) return 0;

    // Collect all modelId values from agent configs
    const configModelIds = new Set<string>();

    const supervisor = supervisorRes?.GetSupervisorAgent;
    if (supervisor?.modelId) {
      configModelIds.add(supervisor.modelId);
    }

    const subAgents = subAgentsRes?.ListSubAgents || [];
    for (const agent of subAgents) {
      if (agent.modelId) {
        configModelIds.add(agent.modelId);
      }
    }

    // Count deployed custom models whose deploymentArn is referenced in any agent config
    let count = 0;
    for (const model of deployedModels) {
      if (model.deploymentArn && configModelIds.has(model.deploymentArn)) {
        count++;
      }
    }

    return count;
  } catch (err) {
    console.warn('Failed to compute custom model count:', err);
    return 0;
  }
}

type GamePhase = 'setup' | 'playing' | 'gameover';

interface MapOption {
  label: string;
  value: string;
  type: 'saved' | 'predefined';
}

// Game event types from the backend
interface GameEvent {
  type: string;
  position?: { row: number; col: number };
  row?: number;
  col?: number;
  question?: string;
  answer?: string;
  response?: string;
  correct?: boolean;
  points?: number;
  damage?: number;
  lives?: number;
  score?: number;
  message?: string;
  // Backend-specific fields
  scoreAfter?: number;
  livesAfter?: number;
  challengePoints?: number;
  challengeId?: string;
  challengeName?: string;
  totalScore?: number;
  // Score summary fields
  finalScore?: number;
  qaScore?: number;
  challengeScore?: number;
  lifeBonusScore?: number;
  givenTokenBonus?: number;
  treasureBonus?: number;
  livesRemaining?: number;
  coinBonus?: number;
  challengesAttempted?: number;
  tokensUsed?: number;
  customModelCount?: number;
}

// Event type delay mapping (ms)
const EVENT_DELAYS: Record<string, number> = {
  MoveSpace: 300,
  FoundChallenge: 500,
  AskChallenge: 600,
  AnswerChallenge: 600,
  WinChallenge: 400,
  LoseChallenge: 400,
  WinNonPromptChallenge: 400,
  LoseNonPromptChallenge: 400,
  WinGame: 800,
};

// Combat log entry for display
interface CombatLogEntry {
  type: string;
  message: string;
  color: string;
}

// NOTE: computeBfsPath removed — Phase 2 delegates pathfinding to the server-side AgentCore Runtime.
// If the user manually enters a path in the textarea (starting with '['), it is passed directly
// to the backend as a Phase 1 override. No client-side BFS computation is needed.

/**
 * Helper to extract row/col from a game event.
 * Handles both backend format (position.row/col) and flat format (row/col).
 */
function getEventPos(event: GameEvent): { row: number; col: number } | null {
  if (event.position && event.position.row !== undefined && event.position.col !== undefined) {
    return { row: event.position.row, col: event.position.col };
  }
  if (event.row !== undefined && event.col !== undefined) {
    return { row: event.row, col: event.col };
  }
  return null;
}

export default function GameplayPage() {
  const { getAccessToken } = useAuth();

  // Map selection state
  const [mapOptions, setMapOptions] = useState<MapOption[]>([]);
  const [selectedMap, setSelectedMap] = useState<SelectProps.Option | null>(null);
  const [mapData, setMapData] = useState<{ grid: string[][]; startRow: number; startCol: number; timeLimit: number; lives: number } | null>(null);
  const [loadingMaps, setLoadingMaps] = useState(false);

  // Game state
  const [phase, setPhase] = useState<GamePhase>('setup');
  const [championPos, setChampionPos] = useState<[number, number] | null>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(5);
  const [maxLives, setMaxLives] = useState(5);
  const [timer, setTimer] = useState(0);
  const [navigationPrompt, setNavigationPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Replay queue state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([]);
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  const [consumedTiles, setConsumedTiles] = useState<Set<string>>(new Set());
  const [plannedPath, setPlannedPath] = useState<{ row: number; col: number }[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);

  // Game over modal state
  const [showGameOverModal, setShowGameOverModal] = useState(false);
  const [scoreSummary, setScoreSummary] = useState<GameEvent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Model warm-up state
  const { state: warmUpState, startWarmup, cancel: cancelWarmupHook, proceedAnyway } = useModelWarmup();
  const pendingGameStartRef = useRef(false);

  // Wrap cancel to also reset pending game start
  const cancelWarmup = useCallback(() => {
    pendingGameStartRef.current = false;
    cancelWarmupHook();
  }, [cancelWarmupHook]);

  // Refs for polling and replay
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const replayQueueRef = useRef<GameEvent[]>([]);
  const replayingRef = useRef(false);
  const processedEventCountRef = useRef(0);
  const allGameEventsRef = useRef<GameEvent[]>([]);
  const combatLogEndRef = useRef<HTMLDivElement | null>(null);

  // Load available maps on mount
  useEffect(() => {
    let cancelled = false;

    async function loadMaps() {
      setLoadingMaps(true);
      try {
        const token = await getAccessToken();
        const savedMaps = await listMaps(token);

        const playableSaved: MapOption[] = savedMaps
          .filter(() => true)
          .map((m) => ({
            label: m.name,
            value: m.mapId,
            type: 'saved' as const,
          }));

        const predefinedOptions: MapOption[] = PREDEFINED_MAPS.map((pm, idx) => ({
          label: `[Predefined] ${pm.label}`,
          value: `predefined-${idx}`,
          type: 'predefined' as const,
        }));

        if (!cancelled) {
          setMapOptions([...playableSaved, ...predefinedOptions]);
        }
      } catch {
        if (!cancelled) {
          const predefinedOptions: MapOption[] = PREDEFINED_MAPS.map((pm, idx) => ({
            label: `[Predefined] ${pm.label}`,
            value: `predefined-${idx}`,
            type: 'predefined' as const,
          }));
          setMapOptions(predefinedOptions);
        }
      } finally {
        if (!cancelled) setLoadingMaps(false);
      }
    }

    loadMaps();
    return () => { cancelled = true; };
  }, [getAccessToken]);

  // Load map data when selection changes
  const handleMapSelect = useCallback(async (option: SelectProps.Option) => {
    setSelectedMap(option);
    setError(null);

    const mapOption = mapOptions.find((m) => m.value === option.value);
    if (!mapOption) return;

    if (mapOption.type === 'predefined') {
      const idx = parseInt(mapOption.value.replace('predefined-', ''), 10);
      const pm: PredefinedMap = PREDEFINED_MAPS[idx];
      setMapData({
        grid: pm.grid,
        startRow: pm.startRow,
        startCol: pm.startCol,
        timeLimit: pm.time,
        lives: 5,
      });
      setChampionPos([pm.startRow, pm.startCol]);
      setLives(5);
      setMaxLives(5);
      setTimer(pm.time);
      setScore(0);
    } else {
      try {
        const token = await getAccessToken();
        const mapDoc: MapDocument = await getMapFromApi(token, mapOption.value);
        const startRow = mapDoc.grid.findIndex((row) => row.includes('start'));
        const startCol = startRow >= 0 ? mapDoc.grid[startRow].indexOf('start') : 0;
        const resolvedStartRow = startRow >= 0 ? startRow : 0;
        const resolvedStartCol = startCol >= 0 ? startCol : 0;
        const mapLives = mapDoc.startingLives ?? 5;
        const mapTime = mapDoc.timeLimit ?? 120;

        setMapData({
          grid: mapDoc.grid,
          startRow: resolvedStartRow,
          startCol: resolvedStartCol,
          timeLimit: mapTime,
          lives: mapLives,
        });
        setChampionPos([resolvedStartRow, resolvedStartCol]);
        setLives(mapLives);
        setMaxLives(mapLives);
        setTimer(mapTime);
        setScore(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load map');
      }
    }
  }, [mapOptions, getAccessToken]);

  // Timer countdown
  useEffect(() => {
    if (phase === 'playing' && timer > 0) {
      timerRef.current = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            setPhase('gameover');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, timer > 0]);

  // Auto-scroll combat log
  useEffect(() => {
    if (combatLogEndRef.current) {
      combatLogEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [combatLog]);

  // Convert a game event to a combat log entry
  const eventToCombatLogEntry = (event: GameEvent): CombatLogEntry | null => {
    const pos = getEventPos(event);
    switch (event.type) {
      case 'MoveSpace':
        return { type: event.type, message: `Moved to (${pos?.row}, ${pos?.col})`, color: '#aaa' };
      case 'FoundChallenge':
        return { type: event.type, message: `Found challenge at (${pos?.row}, ${pos?.col})`, color: '#2196f3' };
      case 'AskChallenge':
        return { type: event.type, message: `Q: ${event.question || event.message || 'Unknown question'}`, color: '#2196f3' };
      case 'AnswerChallenge':
        return { type: event.type, message: `A: ${event.response || event.answer || event.message || 'No response'}`, color: '#2196f3' };
      case 'InputPrompt':
        return { type: event.type, message: `Prompt: ${event.message || ''}`, color: '#9c27b0' };
      case 'WinChallenge':
        return { type: event.type, message: `✓ Correct! +${event.points || event.challengePoints || 0} points`, color: '#4caf50' };
      case 'LoseChallenge':
        return { type: event.type, message: `✗ Incorrect. -${event.damage || 1} life`, color: '#f44336' };
      case 'WinNonPromptChallenge':
        return { type: event.type, message: `Collected! +${event.points || 0} points`, color: '#4caf50' };
      case 'LoseNonPromptChallenge':
        return { type: event.type, message: `Trap! -${event.damage || 1} life`, color: '#f44336' };
      case 'WinGame':
        return { type: event.type, message: `🏆 Reached treasure! +${event.points || 0} bonus`, color: '#ffd700' };
      case 'ScoreSummary':
        return { type: event.type, message: `Game complete! Final score: ${event.finalScore || event.totalScore || 0}`, color: '#ffd700' };
      default:
        return { type: event.type, message: event.message || `Event: ${event.type}`, color: '#aaa' };
    }
  };

  // Process a single event from the replay queue (stable ref via useRef)
  const processEventRef = useRef((event: GameEvent) => {
    const pos = getEventPos(event);

    // Update champion position ONLY on MoveSpace events
    if (event.type === 'MoveSpace' && pos) {
      setChampionPos([pos.row, pos.col]);
      const key = `${pos.row},${pos.col}`;
      setVisitCounts((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
    }

    // Consume tile when challenge/pickup events are processed (tile disappears when avatar lands)
    if (pos && (event.type === 'WinChallenge' || event.type === 'LoseChallenge' ||
        event.type === 'WinNonPromptChallenge' || event.type === 'LoseNonPromptChallenge')) {
      const key = `${pos.row},${pos.col}`;
      setConsumedTiles((prev) => new Set([...prev, key]));
    }

    // Update score on win events
    if (event.type === 'WinChallenge' || event.type === 'WinNonPromptChallenge') {
      if (event.scoreAfter !== undefined) {
        setScore(event.scoreAfter);
      } else if (event.score !== undefined) {
        setScore(event.score);
      } else if (event.points !== undefined) {
        setScore((prev) => prev + event.points!);
      }
    }

    // Update lives on loss events
    if (event.type === 'LoseChallenge' || event.type === 'LoseNonPromptChallenge') {
      if (event.livesAfter !== undefined) {
        setLives(event.livesAfter);
      } else if (event.lives !== undefined) {
        setLives(event.lives);
      } else if (event.damage !== undefined) {
        setLives((prev) => Math.max(0, prev - event.damage!));
      }
    }

    // Handle game completion
    if (event.type === 'ScoreSummary') {
      const finalScoreValue = event.finalScore ?? event.totalScore;
      const summaryEvent = { ...event, finalScore: finalScoreValue };
      setScoreSummary(summaryEvent);
      setPhase('gameover');
      setShowGameOverModal(true);
      if (finalScoreValue !== undefined) setScore(finalScoreValue);
      if (event.livesRemaining !== undefined) setLives(event.livesRemaining);
    }

    if (event.type === 'WinGame') {
      if (event.points !== undefined) {
        setScore((prev) => prev + event.points!);
      }
    }

    // Add to combat log
    const logEntry = eventToCombatLogEntry(event);
    if (logEntry) {
      setCombatLog((prev) => [...prev, logEntry]);
    }
  });

  // Process replay queue sequentially with delays using setTimeout chaining
  const startReplayProcessing = useCallback(() => {
    if (replayingRef.current) return;
    replayingRef.current = true;
    setIsReplaying(true);

    const processNext = () => {
      if (replayQueueRef.current.length === 0) {
        replayingRef.current = false;
        setIsReplaying(false);
        return;
      }

      const event = replayQueueRef.current.shift()!;
      const delay = EVENT_DELAYS[event.type] || 300;

      processEventRef.current(event);

      setTimeout(processNext, delay);
    };

    processNext();
  }, []);

  // Start polling for game session updates
  const startPolling = useCallback((sid: string) => {
    pollCountRef.current = 0;
    processedEventCountRef.current = 0;
    let isFirstBatch = true;

    pollingRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      // Stop after 150 attempts (5 min at 2s intervals)
      if (pollCountRef.current > 150) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setError('Game session timed out after 5 minutes');
        return;
      }

      try {
        const response = await getGameSession(sid);
        const session = response.GetGameSession;

        // Parse game events
        let events: GameEvent[] = [];
        if (session.gameEvents) {
          try {
            events = JSON.parse(session.gameEvents);
          } catch {
            // Ignore parse errors
          }
        }

        // Tiles are consumed exclusively during event replay processing in processEventRef
        // No bulk-set from polling — this ensures tiles disappear in sync with avatar movement

        // Get new events since last poll
        const newEvents = events.slice(processedEventCountRef.current);
        processedEventCountRef.current = events.length;

        if (newEvents.length > 0) {
          // On first batch, render planned path and delay before replay
          if (isFirstBatch) {
            isFirstBatch = false;

            // Parse and render planned path
            if (session.plannedPath) {
              try {
                const path: { row: number; col: number }[] = JSON.parse(session.plannedPath);
                setPlannedPath(path);
              } catch {
                // Ignore parse errors
              }
            }

            // Queue events and start replay after 1500ms delay
            replayQueueRef.current.push(...newEvents);
            setTimeout(() => {
              startReplayProcessing();
            }, 1500);
          } else {
            // Queue new events and process
            replayQueueRef.current.push(...newEvents);
            if (!replayingRef.current) {
              startReplayProcessing();
            }
          }
        }

        // Stop polling when session is complete or error
        if (session.status === 'completed' || session.status === 'complete' || session.status === 'error' || session.status === 'game_over') {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          // Store complete events for battle log download
          allGameEventsRef.current = events;

          if (session.status === 'error') {
            setError(session.error || 'Game session encountered an error');
          }
        }
      } catch {
        // Continue polling on transient errors
      }
    }, 2000);
  }, [startReplayProcessing]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // Execute the actual game start (invoke runtime, start timer)
  const executeGameStart = useCallback(async () => {
    if (!selectedMap || !mapData) return;

    setIsStarting(true);

    try {
      const mapOption = mapOptions.find((m) => m.value === selectedMap.value);
      if (!mapOption) throw new Error('Map not found');

      // For predefined maps, pass map data inline to the backend
      // For saved maps, the backend loads from DynamoDB
      let inlineMapData: string | undefined;
      if (mapOption.type === 'predefined') {
        const idx = parseInt(mapOption.value.replace('predefined-', ''), 10);
        const pm = PREDEFINED_MAPS[idx];
        inlineMapData = JSON.stringify({
          grid: pm.grid,
          challenges: pm.challenges,
          defaults: {
            lives: 5,
            livesBonusMultiplier: 250,
            tokenBonus: 1000,
            treasureBonus: 1000,
            time: pm.time,
          },
          tileOverrides: pm.challengeTypeOverrides || {},
          playerStart: { row: pm.startRow, col: pm.startCol },
        });
      }

      // Pass user's prompt text to the agent (e.g., "use strategy swift")
      const navigationPath = navigationPrompt.trim();

      // Compute custom model count for token penalty reduction scoring
      const customModelCount = await computeCustomModelCount();

      const result = await invokeAgentCoreRuntime({
        mapId: mapOption.value,
        navigationPath,
        customModelCount,
        mapData: inlineMapData,
      });

      const sid = result.InvokeAgentCoreRuntime.sessionId;
      if (sid === 'error') {
        const msg = result.InvokeAgentCoreRuntime.message || 'Failed to start game session';
        // Check if this is a "no agent configured" error and show banner with link
        if (msg.toLowerCase().includes('no agent configured')) {
          setError(`NO_AGENT_CONFIGURED:${msg}`);
        } else {
          throw new Error(msg);
        }
        return;
      }
      setSessionId(sid);
      setPhase('playing');
      setChampionPos([mapData.startRow, mapData.startCol]);
      setScore(0);
      setLives(mapData.lives);
      setTimer(mapData.timeLimit);
      setCombatLog([{ type: 'info', message: `Game started! Session: ${sid}`, color: '#aaa' }]);

      // Start polling for events immediately after invocation returns sessionId
      startPolling(sid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setIsStarting(false);
    }
  }, [selectedMap, mapData, mapOptions, navigationPrompt, startPolling]);

  // Start game (with warm-up gate for imported models)
  const handleStartGame = useCallback(async () => {
    if (!selectedMap || !mapData) return;

    setError(null);
    setIsStarting(true);
    setCombatLog([]);
    setVisitCounts({});
    setConsumedTiles(new Set());
    setPlannedPath([]);
    setScoreSummary(null);
    setShowGameOverModal(false);
    setSubmitSuccess(false);
    replayQueueRef.current = [];
    processedEventCountRef.current = 0;

    try {
      // Detect imported models in agent configuration
      const importedModelArns: string[] = [];
      try {
        const [supervisorRes, subAgentsRes] = await Promise.all([
          getSupervisorAgent().catch(() => null),
          listSubAgents().catch(() => null),
        ]);

        const supervisor = supervisorRes?.GetSupervisorAgent;
        if (supervisor?.modelId && supervisor.modelId.includes('imported-model/')) {
          importedModelArns.push(supervisor.modelId);
        }

        const subAgents = subAgentsRes?.ListSubAgents || [];
        for (const agent of subAgents) {
          if (agent.modelId && agent.modelId.includes('imported-model/')) {
            importedModelArns.push(agent.modelId);
          }
        }
      } catch {
        // If detection fails, proceed without warm-up
      }

      // Deduplicate ARNs
      const uniqueArns = [...new Set(importedModelArns)];

      if (uniqueArns.length > 0) {
        // Imported models found — initiate warm-up and wait
        pendingGameStartRef.current = true;
        setIsStarting(false);
        startWarmup(uniqueArns);
        return;
      }

      // No imported models — proceed with game start immediately
      await executeGameStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
      setIsStarting(false);
    }
  }, [selectedMap, mapData, mapOptions, navigationPrompt, startPolling, startWarmup, executeGameStart]);

  // Watch warm-up state: when warm-up completes, proceed with game start
  useEffect(() => {
    if (!pendingGameStartRef.current) return;

    if (warmUpState.phase === 'ready' || warmUpState.phase === 'skipped') {
      pendingGameStartRef.current = false;
      executeGameStart();
    }
  }, [warmUpState.phase, executeGameStart]);

  // Submit to leaderboard
  const handleSubmitToLeaderboard = useCallback(async () => {
    if (!sessionId || !selectedMap) return;

    setIsSubmitting(true);
    setError(null);
    try {
      // Step 1: Get the agent runtime ARN
      const runtimeResponse = await getAgentCoreRuntime();
      const runtimeArn = runtimeResponse.GetAgentCoreRuntime.runtimeArn;
      if (!runtimeArn) {
        setError('Please configure your agent before submitting');
        setIsSubmitting(false);
        return;
      }

      // Step 2: Register the runtime as a model entry (required for submission)
      const modelResponse = await createModel({
        name: 'Agent Run',
        resourceIdentifier: runtimeArn,
        type: 'AGENTCORE_RUNTIME',
      });

      if (!modelResponse.CreateModel.success || !modelResponse.CreateModel.modelId) {
        setError(modelResponse.CreateModel.message || 'Model registration failed. Cannot submit without a registered model.');
        setIsSubmitting(false);
        return;
      }

      const modelId = modelResponse.CreateModel.modelId;

      // Step 3: Submit to leaderboard with required modelId
      const mapOption = mapOptions.find((m) => m.value === selectedMap.value);
      const leaderboardId = `map#${mapOption?.value || selectedMap.value}`;
      await submitToLeaderboard(leaderboardId, sessionId, modelId);
      setSubmitSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit to leaderboard');
    } finally {
      setIsSubmitting(false);
    }
  }, [sessionId, selectedMap, mapOptions]);

  // Download battle log as JSON matching real game format
  const handleDownloadBattleLog = useCallback(() => {
    const events = allGameEventsRef.current;
    if (!events || events.length === 0) return;

    // Build summary from ScoreSummary event (matches real game format)
    const summaryEvent = events.find((e) => e.type === 'ScoreSummary');
    const summary = summaryEvent ? {
      timeRemaining: formatTime(timer),
      livesRemaining: summaryEvent.livesRemaining ?? 0,
      lifeBonus: summaryEvent.lifeBonusScore ?? 0,
      coinsEarned: (summaryEvent.coinBonus ?? 0) + (summaryEvent.challengeScore ?? summaryEvent.qaScore ?? 0),
      treasureBonus: summaryEvent.treasureBonus ?? 0,
      totalScore: summaryEvent.finalScore ?? 0,
      tokensUsed: summaryEvent.tokensUsed ?? 0,
      challengesAttempted: summaryEvent.challengesAttempted ?? 0,
      avgTokensPerChallenge: (summaryEvent.challengesAttempted ?? 0) > 0
        ? Math.round((summaryEvent.tokensUsed ?? 0) / (summaryEvent.challengesAttempted ?? 1))
        : 0,
      tokenBonus: Math.round(summaryEvent.givenTokenBonus ?? 0),
    } : undefined;

    // Format events to match real game structure (only include relevant fields per type)
    const formattedEvents = events.map((e) => {
      const out: Record<string, unknown> = { type: e.type };
      if (e.message !== undefined) out.message = e.message;
      if (e.position) out.position = e.position;
      if (e.challengeId) out.challengeId = e.challengeId;
      if (e.challengeName) out.challengeName = e.challengeName;
      if (e.challengePoints !== undefined) out.challengePoints = e.challengePoints;
      if (e.points !== undefined) out.points = e.points;
      if (e.damage !== undefined) out.damage = e.damage;
      if (e.type === 'ScoreSummary') {
        out.livesRemaining = e.livesRemaining ?? 0;
        out.lifeBonus = e.lifeBonusScore ?? 0;
        out.coinsEarned = (e.coinBonus ?? 0) + (e.challengeScore ?? e.qaScore ?? 0);
        out.tokensUsed = e.tokensUsed ?? 0;
        out.challengesAttempted = e.challengesAttempted ?? 0;
        out.avgTokensPerChallenge = (e.challengesAttempted ?? 0) > 0
          ? Math.round((e.tokensUsed ?? 0) / (e.challengesAttempted ?? 1))
          : 0;
        out.tokenBonus = Math.round(e.givenTokenBonus ?? 0);
        out.treasureBonus = e.treasureBonus ?? 0;
        out.totalScore = e.finalScore ?? 0;
        out.customModelCount = e.customModelCount ?? 0;
      }
      if (e.type === 'WinGame' && e.points !== undefined) {
        out.timeElapsed = mapData ? mapData.timeLimit - timer : 0;
      }
      return out;
    });

    const battleLog = { events: formattedEvents, ...(summary ? { summary } : {}) };
    const blob = new Blob([JSON.stringify(battleLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `battle-log-${sessionId || 'unknown'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [timer, mapData, sessionId]);

  // Play again
  const handlePlayAgain = useCallback(() => {
    setPhase('setup');
    setCombatLog([]);
    setScore(0);
    setVisitCounts({});
    setConsumedTiles(new Set());
    setPlannedPath([]);
    setScoreSummary(null);
    setShowGameOverModal(false);
    setSubmitSuccess(false);
    setSessionId(null);
    replayQueueRef.current = [];
    processedEventCountRef.current = 0;
    if (mapData) {
      setLives(mapData.lives);
      setTimer(mapData.timeLimit);
      setChampionPos([mapData.startRow, mapData.startCol]);
    }
  }, [mapData]);

  // Format timer display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Render hearts for lives
  const renderLives = () => {
    const hearts: ReactElement[] = [];
    for (let i = 0; i < maxLives; i++) {
      hearts.push(
        <img
          key={i}
          src={livesSprite}
          alt={i < lives ? 'life' : 'lost life'}
          style={{
            width: 24,
            height: 24,
            opacity: i < lives ? 1 : 0.3,
            filter: i < lives ? 'none' : 'grayscale(1)',
          }}
        />
      );
    }
    return hearts;
  };

  // Check if a position is on the planned path
  const isOnPlannedPath = (row: number, col: number): boolean => {
    return plannedPath.some((p) => p.row === row && p.col === col);
  };

  // Render the map grid
  const renderGrid = () => {
    if (!mapData) return null;

    const { grid } = mapData;
    const rows = grid.length;
    const cols = rows > 0 ? grid[0].length : 0;
    const maxCells = Math.max(rows, cols);
    const cellSize = maxCells <= 5 ? 64 : maxCells <= 8 ? 48 : 36;

    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <div
          style={{
            display: 'inline-grid',
            gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
            gap: 1,
            backgroundColor: '#333',
            border: '1px solid #444',
            borderRadius: 4,
            padding: 1,
          }}
          role="grid"
          aria-label="Game map grid"
        >
          {grid.map((row, rowIdx) =>
            row.map((tileKey, colIdx) => {
              const posKey = `${rowIdx},${colIdx}`;
              const isConsumed = consumedTiles.has(posKey);
              const visitCount = visitCounts[posKey] || 0;
              const onPath = isOnPlannedPath(rowIdx, colIdx);
              const spriteKey = tileKey as TileKey;
              const sprite = TILE_SPRITES[spriteKey];

              // If tile is consumed, show as normal tile
              const effectiveTileKey = isConsumed ? 'normal' : tileKey;
              const effectiveSprite = isConsumed ? TILE_SPRITES['normal'] : sprite;

              return (
                <div
                  key={`${rowIdx}-${colIdx}`}
                  role="gridcell"
                  aria-label={`Cell ${rowIdx},${colIdx}: ${tileKey}`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundImage: effectiveTileKey === 'wall' ? 'none' : `url(${NORMAL_BG})`,
                    backgroundSize: 'cover',
                    border: '1px solid #3a3a4a',
                    borderRadius: 2,
                    boxSizing: 'border-box',
                    position: 'relative',
                  }}
                >
                  {/* Render wall sprite full-size */}
                  {effectiveTileKey === 'wall' && effectiveSprite && (
                    <img
                      src={effectiveSprite}
                      alt={effectiveTileKey}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        imageRendering: 'pixelated',
                        pointerEvents: 'none',
                        userSelect: 'none',
                      }}
                      draggable={false}
                    />
                  )}

                  {/* Render non-wall, non-normal sprites on top of normal background */}
                  {effectiveTileKey !== 'wall' && effectiveTileKey !== 'normal' && effectiveSprite && (
                    <img
                      src={effectiveSprite}
                      alt={effectiveTileKey}
                      style={{
                        width: '85%',
                        height: '85%',
                        objectFit: 'contain',
                        imageRendering: 'pixelated',
                        pointerEvents: 'none',
                        userSelect: 'none',
                      }}
                      draggable={false}
                    />
                  )}

                  {/* Path overlay: visited tiles get white semi-transparent layer */}
                  {visitCount > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: `rgba(255, 255, 255, ${Math.min(visitCount * 0.1, 0.7)})`,
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}
                    />
                  )}

                  {/* Planned path overlay: show path before replay starts */}
                  {onPath && visitCount === 0 && phase === 'playing' && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0, 229, 255, 0.15)',
                        pointerEvents: 'none',
                        zIndex: 4,
                      }}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Champion sprite rendered as absolutely-positioned overlay */}
        {championPos && (
          <img
            src={championSprite}
            alt="champion"
            style={{
              position: 'absolute',
              top: championPos[0] * (cellSize + 1) + 1,
              left: championPos[1] * (cellSize + 1) + 1,
              width: cellSize,
              height: cellSize,
              objectFit: 'cover',
              imageRendering: 'pixelated',
              zIndex: 20,
              border: '2px solid #00e5ff',
              boxShadow: '0 0 8px rgba(0,229,255,0.8)',
              borderRadius: 2,
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
            draggable={false}
          />
        )}
      </div>
    );
  };

  // Render combat log
  const renderCombatLog = () => {
    if (combatLog.length === 0) {
      return (
        <Box variant="p" color="text-status-inactive">
          No events yet. Select a map and start a game.
        </Box>
      );
    }

    return (
      <div style={{ maxHeight: 400, overflowY: 'auto', fontFamily: 'monospace', fontSize: 13 }}>
        {combatLog.map((entry, idx) => (
          <div
            key={idx}
            style={{
              padding: '4px 8px',
              borderBottom: '1px solid #2a2a3a',
              color: entry.color,
              wordBreak: 'break-word',
            }}
          >
            {entry.message}
          </div>
        ))}
        <div ref={combatLogEndRef} />
      </div>
    );
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1">Game Play</Header>

      {error && error.startsWith('NO_AGENT_CONFIGURED:') && (
        <Alert type="warning" dismissible onDismiss={() => setError(null)}>
          {error.replace('NO_AGENT_CONFIGURED:', '')}{' '}
          <Link href="/agent-builder">Go to Agent Builder</Link>
        </Alert>
      )}

      {error && !error.startsWith('NO_AGENT_CONFIGURED:') && (
        <Alert type="error" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid gridDefinition={[{ colspan: 8 }, { colspan: 4 }]}>
        {/* Left panel: Map and controls */}
        <SpaceBetween size="m">
          {/* Map selector and navigation prompt */}
          {phase === 'setup' && (
            <Container header={<Header variant="h2">Game Setup</Header>}>
              <SpaceBetween size="m">
                <Select
                  selectedOption={selectedMap}
                  onChange={({ detail }) => handleMapSelect(detail.selectedOption)}
                  options={mapOptions.map((m) => ({ label: m.label, value: m.value }))}
                  placeholder="Select a map"
                  loadingText="Loading maps..."
                  statusType={loadingMaps ? 'loading' : 'finished'}
                  empty="No maps available"
                />

                <Textarea
                  value={navigationPrompt}
                  onChange={({ detail }) => setNavigationPrompt(detail.value)}
                  placeholder="e.g., use strategy swift"
                  rows={2}
                  ariaLabel="Navigation Prompt"
                />

                <Button
                  variant="primary"
                  onClick={handleStartGame}
                  disabled={!selectedMap || !mapData}
                  loading={isStarting}
                >
                  Start Game
                </Button>
              </SpaceBetween>
            </Container>
          )}

          {/* Score bar */}
          {mapData && (
            <Container>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                <Box variant="span">
                  <strong>Score:</strong> {score}
                </Box>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {renderLives()}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <img src={timeSprite} alt="timer" style={{ width: 24, height: 24 }} />
                  <Box variant="span">
                    <strong>{formatTime(timer)}</strong>
                  </Box>
                </div>
                {phase === 'playing' && (
                  <StatusIndicator type="in-progress">
                    {isReplaying ? 'Replaying...' : 'Playing'}
                  </StatusIndicator>
                )}
                {phase === 'gameover' && (
                  <StatusIndicator type="stopped">Game Over</StatusIndicator>
                )}
              </div>
            </Container>
          )}

          {/* Map grid */}
          {mapData && (
            <Container header={<Header variant="h2">Map</Header>}>
              <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
                {renderGrid()}
              </div>
            </Container>
          )}
        </SpaceBetween>

        {/* Right panel: Combat Log */}
        <SpaceBetween size="m">
          <Container header={<Header variant="h2">Combat Log</Header>}>
            {renderCombatLog()}
          </Container>

          {/* Play again button when game is over (outside modal) */}
          {phase === 'gameover' && !showGameOverModal && (
            <Container>
              <SpaceBetween size="s">
                <Box variant="p">
                  <strong>Final Score:</strong> {score}
                </Box>
                <Button variant="primary" onClick={handlePlayAgain}>
                  Play Again
                </Button>
              </SpaceBetween>
            </Container>
          )}
        </SpaceBetween>
      </Grid>

      {/* Game Over Modal */}
      <Modal
        visible={showGameOverModal}
        onDismiss={() => setShowGameOverModal(false)}
        header="Game Over"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={handlePlayAgain}>
                Play Again
              </Button>
              <Button variant="normal" onClick={handleDownloadBattleLog}>
                Download Battle Log
              </Button>
              {!submitSuccess && (
                <Button
                  variant="primary"
                  onClick={handleSubmitToLeaderboard}
                  loading={isSubmitting}
                >
                  Submit to Leaderboard
                </Button>
              )}
              {submitSuccess && (
                <StatusIndicator type="success">Submitted!</StatusIndicator>
              )}
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Box variant="h3">Score Breakdown</Box>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Box variant="p"><strong>Challenge Bonus:</strong></Box>
            <Box variant="p">{scoreSummary?.challengeScore ?? scoreSummary?.qaScore ?? 0}</Box>
            <Box variant="p"><strong>Coin Bonus:</strong></Box>
            <Box variant="p">{scoreSummary?.coinBonus ?? 0}</Box>
            <Box variant="p"><strong>Life Bonus:</strong></Box>
            <Box variant="p">{scoreSummary?.lifeBonusScore ?? 0}</Box>
            <Box variant="p"><strong>Token Bonus:</strong></Box>
            <Box variant="p">{Math.round(scoreSummary?.givenTokenBonus ?? 0)}</Box>
            <Box variant="p"><strong>Treasure Bonus:</strong></Box>
            <Box variant="p">{scoreSummary?.treasureBonus ?? 0}</Box>
            <Box variant="p"><strong>Challenges Attempted:</strong></Box>
            <Box variant="p">{scoreSummary?.challengesAttempted ?? 0}</Box>
            <Box variant="p"><strong>Tokens Per Challenge:</strong></Box>
            <Box variant="p">{(scoreSummary?.challengesAttempted ?? 0) > 0 ? Math.round((scoreSummary?.tokensUsed ?? 0) / (scoreSummary?.challengesAttempted ?? 1)) : 0}</Box>
            <Box variant="p"><strong>Total Tokens:</strong></Box>
            <Box variant="p">{scoreSummary?.tokensUsed ?? 0}</Box>
            <Box variant="p"><strong>Lives Remaining:</strong></Box>
            <Box variant="p">{scoreSummary?.livesRemaining ?? 0}</Box>
          </div>
          <hr style={{ border: '1px solid #444' }} />
          <Box variant="h2" textAlign="center">
            Total Score: {scoreSummary?.finalScore ?? score}
          </Box>
        </SpaceBetween>
      </Modal>

      {/* Warm-Up Overlay */}
      <WarmUpOverlay state={warmUpState} onCancel={cancelWarmup} onProceedAnyway={proceedAnyway} />
    </SpaceBetween>
  );
}
