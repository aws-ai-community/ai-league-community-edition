import { useState, useCallback, useRef, useEffect } from 'react';
import { warmUpModels, getWarmUpStatus } from '../services/graphqlClient';

export interface WarmUpState {
  phase: 'idle' | 'detecting' | 'warming' | 'ready' | 'timeout' | 'error' | 'skipped';
  elapsedSeconds: number;
  models: { arn: string; status: string }[];
  errorMessage?: string;
}

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_SECONDS = 180;

const initialState: WarmUpState = {
  phase: 'idle',
  elapsedSeconds: 0,
  models: [],
};

export function useModelWarmup() {
  const [state, setState] = useState<WarmUpState>(initialState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startWarmup = useCallback(async (modelArns: string[]) => {
    if (modelArns.length === 0) {
      setState({ ...initialState, phase: 'skipped' });
      return;
    }

    setState({
      phase: 'warming',
      elapsedSeconds: 0,
      models: modelArns.map((arn) => ({ arn, status: 'pending' })),
    });
    elapsedRef.current = 0;

    let sessionId: string;
    try {
      const response = await warmUpModels(modelArns);
      if (!response?.WarmUpModels?.sessionId) {
        throw new Error('Warm-up service returned an empty response. Please try again.');
      }
      sessionId = response.WarmUpModels.sessionId;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        phase: 'error',
        errorMessage: err instanceof Error ? err.message : 'Failed to initiate warm-up',
      }));
      return;
    }

    intervalRef.current = setInterval(async () => {
      elapsedRef.current += 3;

      if (elapsedRef.current >= TIMEOUT_SECONDS) {
        stopPolling();
        setState((prev) => ({
          ...prev,
          phase: 'timeout',
          elapsedSeconds: elapsedRef.current,
        }));
        return;
      }

      try {
        const statusResponse = await getWarmUpStatus(sessionId);
        const session = statusResponse.WarmUpStatus;

        const models = (session.models ?? []).map((m) => ({
          arn: m.modelArn,
          status: m.status,
        }));

        if (session.status === 'ready') {
          stopPolling();
          setState({
            phase: 'ready',
            elapsedSeconds: elapsedRef.current,
            models,
          });
        } else if (session.status === 'timeout') {
          stopPolling();
          setState({
            phase: 'timeout',
            elapsedSeconds: elapsedRef.current,
            models,
            errorMessage: session.message ?? undefined,
          });
        } else {
          setState({
            phase: 'warming',
            elapsedSeconds: elapsedRef.current,
            models,
          });
        }
      } catch (err) {
        stopPolling();
        setState((prev) => ({
          ...prev,
          phase: 'error',
          elapsedSeconds: elapsedRef.current,
          errorMessage: err instanceof Error ? err.message : 'Failed to check warm-up status',
        }));
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const cancel = useCallback(() => {
    stopPolling();
    setState(initialState);
  }, [stopPolling]);

  const proceedAnyway = useCallback(() => {
    stopPolling();
    setState((prev) => ({ ...prev, phase: 'ready' }));
  }, [stopPolling]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return { state, startWarmup, cancel, proceedAnyway };
}
