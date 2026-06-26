/**
 * Property 4: Game Timer Protection
 *
 * For any sequence of warm-up state transitions, the game timer shall never be
 * started unless the warm-up status has reached a terminal state (`ready`,
 * `timeout` with player confirmation via proceedAnyway, or `skipped`).
 *
 * This simulates the useEffect behavior in GameplayPage that gates
 * executeGameStart behind warm-up phase transitions.
 *
 * **Validates: Requirements 5.1**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import fc from 'fast-check';
import { useModelWarmup, WarmUpState } from '../useModelWarmup';

vi.mock('../../services/graphqlClient', () => ({
  warmUpModels: vi.fn(),
  getWarmUpStatus: vi.fn(),
}));

import { warmUpModels, getWarmUpStatus } from '../../services/graphqlClient';

const mockWarmUpModels = vi.mocked(warmUpModels);
const mockGetWarmUpStatus = vi.mocked(getWarmUpStatus);

/**
 * Simulates the GameplayPage useEffect logic that gates game start:
 *
 *   useEffect(() => {
 *     if (!pendingGameStartRef.current) return;
 *     if (warmUpState.phase === 'ready' || warmUpState.phase === 'skipped') {
 *       pendingGameStartRef.current = false;
 *       executeGameStart();
 *     }
 *   }, [warmUpState.phase, executeGameStart]);
 *
 * Returns true if executeGameStart would be called for the given phase.
 */
function shouldExecuteGameStart(phase: WarmUpState['phase'], pendingGameStart: boolean): boolean {
  if (!pendingGameStart) return false;
  return phase === 'ready' || phase === 'skipped';
}

/** Valid phases where the game timer is allowed to start */
const VALID_START_PHASES: WarmUpState['phase'][] = ['ready', 'skipped'];

/** Phases where the game timer must NOT start */
const INVALID_START_PHASES: WarmUpState['phase'][] = ['idle', 'detecting', 'warming', 'timeout', 'error'];

describe('Property 4: Game Timer Protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executeGameStart should NOT be called when phase is "warming"', async () => {
    const sessionId = 'session-warming';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/test-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: { sessionId, status: 'pending', models: [{ modelArn, status: 'pending' }] },
    });

    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: { sessionId, status: 'warming', models: [{ modelArn, status: 'warming' }] },
    });

    const executeGameStart = vi.fn();
    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    expect(result.current.state.phase).toBe('warming');

    // Simulate the GameplayPage useEffect guard
    const wouldStart = shouldExecuteGameStart(result.current.state.phase, true);
    if (wouldStart) executeGameStart();

    expect(executeGameStart).not.toHaveBeenCalled();
  });

  it('executeGameStart should NOT be called when phase is "idle"', () => {
    const executeGameStart = vi.fn();
    const { result } = renderHook(() => useModelWarmup());

    expect(result.current.state.phase).toBe('idle');

    const wouldStart = shouldExecuteGameStart(result.current.state.phase, true);
    if (wouldStart) executeGameStart();

    expect(executeGameStart).not.toHaveBeenCalled();
  });

  it('executeGameStart should NOT be called when phase is "error"', async () => {
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/error-model';
    mockWarmUpModels.mockRejectedValue(new Error('Network failure'));

    const executeGameStart = vi.fn();
    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    expect(result.current.state.phase).toBe('error');

    const wouldStart = shouldExecuteGameStart(result.current.state.phase, true);
    if (wouldStart) executeGameStart();

    expect(executeGameStart).not.toHaveBeenCalled();
  });

  it('executeGameStart should NOT be called when phase is "timeout" (without proceedAnyway)', async () => {
    const sessionId = 'session-timeout';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/slow-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: { sessionId, status: 'pending', models: [{ modelArn, status: 'pending' }] },
    });

    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: { sessionId, status: 'warming', models: [{ modelArn, status: 'warming' }] },
    });

    const executeGameStart = vi.fn();
    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    // Advance time to trigger timeout (180s / 3s per poll = 60 polls)
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await vi.runAllTimersAsync();
      });
      if (result.current.state.phase === 'timeout') break;
    }

    expect(result.current.state.phase).toBe('timeout');

    // Without calling proceedAnyway, game start must NOT happen
    const wouldStart = shouldExecuteGameStart(result.current.state.phase, true);
    if (wouldStart) executeGameStart();

    expect(executeGameStart).not.toHaveBeenCalled();
  });

  it('executeGameStart SHOULD be called when phase transitions to "ready"', async () => {
    const sessionId = 'session-ready';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/ready-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: { sessionId, status: 'pending', models: [{ modelArn, status: 'pending' }] },
    });

    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: { sessionId, status: 'ready', models: [{ modelArn, status: 'ready' }] },
    });

    const executeGameStart = vi.fn();
    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    // Advance to first poll to get ready status
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await vi.runAllTimersAsync();
    });

    expect(result.current.state.phase).toBe('ready');

    const wouldStart = shouldExecuteGameStart(result.current.state.phase, true);
    if (wouldStart) executeGameStart();

    expect(executeGameStart).toHaveBeenCalledTimes(1);
  });

  it('executeGameStart SHOULD be called when phase transitions to "skipped"', async () => {
    const executeGameStart = vi.fn();
    const { result } = renderHook(() => useModelWarmup());

    // Empty ARN list triggers skip
    await act(async () => {
      await result.current.startWarmup([]);
    });

    expect(result.current.state.phase).toBe('skipped');

    const wouldStart = shouldExecuteGameStart(result.current.state.phase, true);
    if (wouldStart) executeGameStart();

    expect(executeGameStart).toHaveBeenCalledTimes(1);
  });

  it('executeGameStart SHOULD be called after proceedAnyway (phase becomes "ready")', async () => {
    const sessionId = 'session-proceed';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/proceed-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: { sessionId, status: 'pending', models: [{ modelArn, status: 'pending' }] },
    });

    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: { sessionId, status: 'warming', models: [{ modelArn, status: 'warming' }] },
    });

    const executeGameStart = vi.fn();
    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    // Advance to timeout
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await vi.runAllTimersAsync();
      });
      if (result.current.state.phase === 'timeout') break;
    }

    expect(result.current.state.phase).toBe('timeout');

    // Confirm via proceedAnyway — this transitions to 'ready'
    act(() => {
      result.current.proceedAnyway();
    });

    expect(result.current.state.phase).toBe('ready');

    const wouldStart = shouldExecuteGameStart(result.current.state.phase, true);
    if (wouldStart) executeGameStart();

    expect(executeGameStart).toHaveBeenCalledTimes(1);
  });

  it('property: game timer is never started in any non-terminal phase (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<WarmUpState['phase']>(...INVALID_START_PHASES),
        (phase) => {
          // For any invalid phase, shouldExecuteGameStart must return false
          // even when there is a pending game start
          expect(shouldExecuteGameStart(phase, true)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('property: game timer is always started in valid terminal phases when pending (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<WarmUpState['phase']>(...VALID_START_PHASES),
        (phase) => {
          // For any valid terminal phase with pending game start, executeGameStart fires
          expect(shouldExecuteGameStart(phase, true)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('property: game timer never starts without a pending game start, regardless of phase (fast-check)', () => {
    const ALL_PHASES: WarmUpState['phase'][] = [
      'idle', 'detecting', 'warming', 'ready', 'timeout', 'error', 'skipped',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom<WarmUpState['phase']>(...ALL_PHASES),
        (phase) => {
          // Without a pending game start flag, no phase should trigger executeGameStart
          expect(shouldExecuteGameStart(phase, false)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
