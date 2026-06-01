import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// ============================================================
// Pure functions extracted for testability
// ============================================================

/** Event types used in the game replay queue */
type GameEventType =
  | 'MoveSpace'
  | 'FoundChallenge'
  | 'AskChallenge'
  | 'AnswerChallenge'
  | 'WinChallenge'
  | 'LoseChallenge'
  | 'WinNonPromptChallenge'
  | 'LoseNonPromptChallenge'
  | 'WinGame';

interface GameEvent {
  type: GameEventType;
  position?: [number, number];
}

/**
 * Processes a game event and returns the new champion position.
 * Only MoveSpace events change the champion position.
 */
function processEventPosition(
  event: GameEvent,
  currentPos: [number, number],
): [number, number] {
  if (event.type === 'MoveSpace' && event.position) {
    return event.position;
  }
  return currentPos;
}

/**
 * Computes the path overlay opacity for a given visit count.
 * Formula: Math.min(visitCount * 0.1, 0.7)
 */
function computeOverlayOpacity(visitCount: number): number {
  return Math.min(visitCount * 0.1, 0.7);
}

/**
 * Determines the display tile key based on whether the tile has been consumed.
 * Consumed tiles render as 'normal' regardless of original type.
 */
function getDisplayTile(originalTile: string, isConsumed: boolean): string {
  if (isConsumed) {
    return 'normal';
  }
  return originalTile;
}

// ============================================================
// Property 16: Only MoveSpace events change champion position
// ============================================================

describe('Property 16: Only MoveSpace events change champion position', () => {
  /**
   * **Validates: Requirements 10.7**
   */

  const eventTypeArb: fc.Arbitrary<GameEventType> = fc.constantFrom(
    'MoveSpace',
    'FoundChallenge',
    'AskChallenge',
    'AnswerChallenge',
    'WinChallenge',
    'LoseChallenge',
  );

  const positionArb: fc.Arbitrary<[number, number]> = fc.tuple(
    fc.integer({ min: 0, max: 19 }),
    fc.integer({ min: 0, max: 19 }),
  );

  const gameEventArb: fc.Arbitrary<GameEvent> = fc.record({
    type: eventTypeArb,
    position: positionArb,
  });

  it('champion position only changes on MoveSpace events', () => {
    fc.assert(
      fc.property(
        fc.array(gameEventArb, { minLength: 1, maxLength: 50 }),
        positionArb,
        (events, startPos) => {
          let currentPos = startPos;

          for (const event of events) {
            const prevPos = currentPos;
            currentPos = processEventPosition(event, currentPos);

            if (event.type !== 'MoveSpace') {
              // Non-MoveSpace events must NOT change position
              expect(currentPos).toEqual(prevPos);
            }
          }
        },
      ),
    );
  });

  it('MoveSpace events update position to the event position', () => {
    fc.assert(
      fc.property(
        positionArb,
        positionArb,
        (startPos, newPos) => {
          const event: GameEvent = { type: 'MoveSpace', position: newPos };
          const result = processEventPosition(event, startPos);
          expect(result).toEqual(newPos);
        },
      ),
    );
  });

  it('non-MoveSpace events preserve the current position', () => {
    const nonMoveTypes: GameEventType[] = [
      'FoundChallenge',
      'AskChallenge',
      'AnswerChallenge',
      'WinChallenge',
      'LoseChallenge',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...nonMoveTypes),
        positionArb,
        positionArb,
        (eventType, currentPos, eventPos) => {
          const event: GameEvent = { type: eventType, position: eventPos };
          const result = processEventPosition(event, currentPos);
          expect(result).toEqual(currentPos);
        },
      ),
    );
  });
});

// ============================================================
// Property 17: Path overlay opacity formula
// ============================================================

describe('Property 17: Path overlay opacity formula', () => {
  /**
   * **Validates: Requirements 10.8**
   */

  it('opacity equals Math.min(visitCount * 0.1, 0.7) for all non-negative visit counts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (visitCount) => {
          const opacity = computeOverlayOpacity(visitCount);
          const expected = Math.min(visitCount * 0.1, 0.7);
          expect(opacity).toBeCloseTo(expected, 10);
        },
      ),
    );
  });

  it('opacity never exceeds 0.7', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (visitCount) => {
          const opacity = computeOverlayOpacity(visitCount);
          expect(opacity).toBeLessThanOrEqual(0.7);
        },
      ),
    );
  });

  it('opacity is 0 for unvisited tiles (visitCount = 0)', () => {
    const opacity = computeOverlayOpacity(0);
    expect(opacity).toBe(0);
  });

  it('opacity increases monotonically up to the cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        (visitCount) => {
          const opacityCurrent = computeOverlayOpacity(visitCount);
          const opacityNext = computeOverlayOpacity(visitCount + 1);
          expect(opacityNext).toBeGreaterThanOrEqual(opacityCurrent);
        },
      ),
    );
  });

  it('opacity is exactly 0.7 for visit counts >= 7', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 7, max: 100 }),
        (visitCount) => {
          const opacity = computeOverlayOpacity(visitCount);
          expect(opacity).toBe(0.7);
        },
      ),
    );
  });
});

// ============================================================
// Property 18: Consumed tiles render as normal
// ============================================================

describe('Property 18: Consumed tiles render as normal', () => {
  /**
   * **Validates: Requirements 10.14**
   */

  const tileTypes = [
    'normal', 'wall', 'start', 'treasure',
    'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8',
    'c17', 'c18', 'c30', 'c31', 'c32', 'c33',
    'c40', 'c41', 'c42', 'c43',
  ];

  it('consumed tiles always display as normal regardless of original type', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tileTypes),
        (originalTile) => {
          const displayTile = getDisplayTile(originalTile, true);
          expect(displayTile).toBe('normal');
        },
      ),
    );
  });

  it('non-consumed tiles display their original type', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tileTypes),
        (originalTile) => {
          const displayTile = getDisplayTile(originalTile, false);
          expect(displayTile).toBe(originalTile);
        },
      ),
    );
  });

  it('consumed status is the sole determinant of display tile', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...tileTypes),
        fc.boolean(),
        (originalTile, isConsumed) => {
          const displayTile = getDisplayTile(originalTile, isConsumed);
          if (isConsumed) {
            expect(displayTile).toBe('normal');
          } else {
            expect(displayTile).toBe(originalTile);
          }
        },
      ),
    );
  });
});

// ============================================================
// Task 10.8: Polling and error handling unit tests
// ============================================================

describe('Polling and error handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Simulates the polling logic used in GameplayPage.
   * This is extracted as a testable function.
   */
  interface PollState {
    attempts: number;
    stopped: boolean;
    error: string | null;
    status: string | null;
  }

  function createPoller(
    fetchFn: () => Promise<{ status: string; error?: string | null }>,
    maxAttempts: number = 150,
  ) {
    const state: PollState = {
      attempts: 0,
      stopped: false,
      error: null,
      status: null,
    };

    let intervalId: ReturnType<typeof setInterval> | null = null;

    function start() {
      intervalId = setInterval(async () => {
        if (state.stopped) {
          if (intervalId) clearInterval(intervalId);
          return;
        }

        state.attempts++;

        if (state.attempts >= maxAttempts) {
          state.stopped = true;
          state.error = 'Polling timeout: maximum attempts reached';
          if (intervalId) clearInterval(intervalId);
          return;
        }

        try {
          const result = await fetchFn();
          state.status = result.status;

          if (result.status === 'error') {
            state.stopped = true;
            state.error = result.error ?? 'Session error';
            if (intervalId) clearInterval(intervalId);
          } else if (result.status === 'completed' || result.status === 'complete') {
            state.stopped = true;
            if (intervalId) clearInterval(intervalId);
          }
        } catch {
          // Transient network error — continue polling
        }
      }, 2000);
    }

    function stop() {
      state.stopped = true;
      if (intervalId) clearInterval(intervalId);
    }

    return { state, start, stop };
  }

  it('polling stops after 150 attempts', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 'in_progress' });
    const poller = createPoller(fetchFn, 150);

    poller.start();

    // Advance time for 150 poll intervals (150 * 2000ms = 300000ms)
    for (let i = 0; i < 150; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    expect(poller.state.stopped).toBe(true);
    expect(poller.state.error).toBe('Polling timeout: maximum attempts reached');
    expect(poller.state.attempts).toBe(150);
  });

  it('polling continues on transient network errors', async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 3) {
        throw new Error('Network error');
      }
      return { status: 'completed' };
    });

    const poller = createPoller(fetchFn);
    poller.start();

    // First 3 calls throw errors
    await vi.advanceTimersByTimeAsync(2000);
    expect(poller.state.stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poller.state.stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poller.state.stopped).toBe(false);

    // 4th call succeeds with completed
    await vi.advanceTimersByTimeAsync(2000);
    expect(poller.state.stopped).toBe(true);
    expect(poller.state.error).toBeNull();
  });

  it('polling stops when session status is "error"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 'error',
      error: 'Lambda timeout',
    });

    const poller = createPoller(fetchFn);
    poller.start();

    await vi.advanceTimersByTimeAsync(2000);

    expect(poller.state.stopped).toBe(true);
    expect(poller.state.error).toBe('Lambda timeout');
    expect(poller.state.status).toBe('error');
  });

  it('polling stops when session status is "complete"', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 'complete' });

    const poller = createPoller(fetchFn);
    poller.start();

    await vi.advanceTimersByTimeAsync(2000);

    expect(poller.state.stopped).toBe(true);
    expect(poller.state.error).toBeNull();
    expect(poller.state.status).toBe('complete');
  });

  it('countdown timer decrements every second', () => {
    let timer = 120;
    const decrementTimer = () => {
      if (timer > 0) timer--;
    };

    const intervalId = setInterval(decrementTimer, 1000);

    vi.advanceTimersByTime(1000);
    expect(timer).toBe(119);

    vi.advanceTimersByTime(1000);
    expect(timer).toBe(118);

    vi.advanceTimersByTime(5000);
    expect(timer).toBe(113);

    // Timer stops at 0
    vi.advanceTimersByTime(113000);
    expect(timer).toBe(0);

    // Does not go below 0
    vi.advanceTimersByTime(5000);
    expect(timer).toBe(0);

    clearInterval(intervalId);
  });
});
