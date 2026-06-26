import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModelWarmup } from '../useModelWarmup';

vi.mock('../../services/graphqlClient', () => ({
  warmUpModels: vi.fn(),
  getWarmUpStatus: vi.fn(),
}));

import { warmUpModels, getWarmUpStatus } from '../../services/graphqlClient';

const mockWarmUpModels = vi.mocked(warmUpModels);
const mockGetWarmUpStatus = vi.mocked(getWarmUpStatus);

describe('useModelWarmup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in idle phase', () => {
    const { result } = renderHook(() => useModelWarmup());

    expect(result.current.state.phase).toBe('idle');
    expect(result.current.state.elapsedSeconds).toBe(0);
    expect(result.current.state.models).toEqual([]);
  });

  it('transitions from idle → warming → ready', async () => {
    const sessionId = 'session-123';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/my-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: {
        sessionId,
        status: 'pending',
        models: [{ modelArn, status: 'pending' }],
      },
    });

    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: {
        sessionId,
        status: 'ready',
        models: [{ modelArn, status: 'ready' }],
      },
    });

    const { result } = renderHook(() => useModelWarmup());

    // Start warmup
    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    expect(result.current.state.phase).toBe('warming');
    expect(result.current.state.models).toEqual([{ arn: modelArn, status: 'pending' }]);

    // Advance to first poll interval (3 seconds)
    await act(async () => {
      vi.advanceTimersByTime(3000);
      // Allow the async poll callback to resolve
      await vi.runAllTimersAsync();
    });

    expect(result.current.state.phase).toBe('ready');
    expect(result.current.state.models).toEqual([{ arn: modelArn, status: 'ready' }]);
  });

  it('transitions from warming → timeout after 180s', async () => {
    const sessionId = 'session-timeout';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/slow-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: {
        sessionId,
        status: 'pending',
        models: [{ modelArn, status: 'pending' }],
      },
    });

    // Always return "warming" status
    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: {
        sessionId,
        status: 'warming',
        models: [{ modelArn, status: 'warming' }],
      },
    });

    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    expect(result.current.state.phase).toBe('warming');

    // Advance time to 180 seconds (60 poll intervals of 3s)
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await vi.runAllTimersAsync();
      });

      if (result.current.state.phase === 'timeout') {
        break;
      }
    }

    expect(result.current.state.phase).toBe('timeout');
    expect(result.current.state.elapsedSeconds).toBeGreaterThanOrEqual(180);
  });

  it('skips warmup immediately when model ARNs list is empty', async () => {
    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([]);
    });

    expect(result.current.state.phase).toBe('skipped');
    expect(mockWarmUpModels).not.toHaveBeenCalled();
    expect(mockGetWarmUpStatus).not.toHaveBeenCalled();
  });

  it('cancel resets state to idle', async () => {
    const sessionId = 'session-cancel';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/cancel-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: {
        sessionId,
        status: 'pending',
        models: [{ modelArn, status: 'pending' }],
      },
    });

    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: {
        sessionId,
        status: 'warming',
        models: [{ modelArn, status: 'warming' }],
      },
    });

    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    expect(result.current.state.phase).toBe('warming');

    // Cancel the warmup
    act(() => {
      result.current.cancel();
    });

    expect(result.current.state.phase).toBe('idle');
    expect(result.current.state.elapsedSeconds).toBe(0);
    expect(result.current.state.models).toEqual([]);
  });

  it('proceedAnyway after timeout sets phase to ready', async () => {
    const sessionId = 'session-proceed';
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/proceed-model';

    mockWarmUpModels.mockResolvedValue({
      WarmUpModels: {
        sessionId,
        status: 'pending',
        models: [{ modelArn, status: 'pending' }],
      },
    });

    // Always return warming to trigger timeout
    mockGetWarmUpStatus.mockResolvedValue({
      WarmUpStatus: {
        sessionId,
        status: 'warming',
        models: [{ modelArn, status: 'warming' }],
      },
    });

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

      if (result.current.state.phase === 'timeout') {
        break;
      }
    }

    expect(result.current.state.phase).toBe('timeout');

    // User proceeds anyway
    act(() => {
      result.current.proceedAnyway();
    });

    expect(result.current.state.phase).toBe('ready');
  });

  it('transitions to error phase when warmUpModels throws', async () => {
    const modelArn = 'arn:aws:bedrock:us-east-1:123456:imported-model/error-model';

    mockWarmUpModels.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useModelWarmup());

    await act(async () => {
      await result.current.startWarmup([modelArn]);
    });

    expect(result.current.state.phase).toBe('error');
    expect(result.current.state.errorMessage).toBe('Network error');
  });
});
