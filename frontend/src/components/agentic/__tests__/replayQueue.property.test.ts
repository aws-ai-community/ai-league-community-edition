/**
 * Property-Based Test: MoveSpace-Only Position Updates (Property 12)
 *
 * Validates: Requirements 11.1, 11.5
 *
 * Verifies that for any random sequence of game events, the champion position
 * only changes on MoveSpace events. All other event types must leave the
 * position unchanged.
 *
 * This tests the core logic extracted from GameplayPage.tsx's processEventRef:
 * - getEventPos extracts position from event.position or event.row/col
 * - Position updates ONLY when event.type === 'MoveSpace' AND position exists
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// --- Pure function extracted from GameplayPage.tsx processEventRef logic ---

interface GameEvent {
  type: string;
  position?: { row: number; col: number };
  row?: number;
  col?: number;
}

type Position = [number, number];

/**
 * Extract position from a game event.
 * Mirrors getEventPos from GameplayPage.tsx.
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

/**
 * Pure function that computes the next champion position given the current
 * position and a game event.
 *
 * Mirrors the position update logic from processEventRef.current in GameplayPage.tsx:
 *   if (event.type === 'MoveSpace' && pos) { setChampionPos([pos.row, pos.col]); }
 */
function computeNextPosition(currentPos: Position, event: GameEvent): Position {
  const pos = getEventPos(event);
  if (event.type === 'MoveSpace' && pos) {
    return [pos.row, pos.col];
  }
  return currentPos;
}

// --- Arbitraries ---

const eventTypes = [
  'MoveSpace',
  'FoundChallenge',
  'AskChallenge',
  'AnswerChallenge',
  'WinChallenge',
  'LoseChallenge',
  'WinNonPromptChallenge',
  'LoseNonPromptChallenge',
  'WinGame',
] as const;

const eventTypeArb = fc.constantFrom(...eventTypes);

const positionArb = fc.record({ row: fc.nat({ max: 25 }), col: fc.nat({ max: 25 }) });

/** Arbitrary for a game event with a position (using event.position format) */
const gameEventWithPositionArb: fc.Arbitrary<GameEvent> = fc.record({
  type: eventTypeArb,
  position: positionArb,
});

/** Arbitrary for a game event with flat row/col format */
const gameEventFlatPosArb: fc.Arbitrary<GameEvent> = fc.record({
  type: eventTypeArb,
  row: fc.nat({ max: 25 }),
  col: fc.nat({ max: 25 }),
});

/** Arbitrary for a game event without any position data */
const gameEventNoPosArb: fc.Arbitrary<GameEvent> = fc.record({
  type: eventTypeArb,
});

/** Combined arbitrary that generates events in any of the three position formats */
const gameEventArb: fc.Arbitrary<GameEvent> = fc.oneof(
  gameEventWithPositionArb,
  gameEventFlatPosArb,
  gameEventNoPosArb,
);

const initialPositionArb: fc.Arbitrary<Position> = fc.tuple(fc.nat({ max: 25 }), fc.nat({ max: 25 }));

// --- Property Tests ---

describe('Property 12: MoveSpace-Only Position Updates', () => {
  /**
   * **Validates: Requirements 11.1, 11.5**
   *
   * For any random sequence of game events processed one-by-one,
   * the champion position only changes after MoveSpace events.
   */
  it('champion position only changes on MoveSpace events', () => {
    fc.assert(
      fc.property(
        initialPositionArb,
        fc.array(gameEventArb, { minLength: 1, maxLength: 50 }),
        (initialPos, events) => {
          let currentPos: Position = initialPos;

          for (const event of events) {
            const prevPos = currentPos;
            const nextPos = computeNextPosition(currentPos, event);

            if (event.type !== 'MoveSpace') {
              // Non-MoveSpace events must NOT change position
              expect(nextPos[0]).toBe(prevPos[0]);
              expect(nextPos[1]).toBe(prevPos[1]);
            }

            currentPos = nextPos;
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 11.1, 11.5**
   *
   * For a MoveSpace event with valid position data, the position is updated
   * to the event's position.
   */
  it('MoveSpace events with position data update the champion position', () => {
    fc.assert(
      fc.property(
        initialPositionArb,
        positionArb,
        (initialPos, eventPos) => {
          const event: GameEvent = { type: 'MoveSpace', position: eventPos };
          const nextPos = computeNextPosition(initialPos, event);

          expect(nextPos[0]).toBe(eventPos.row);
          expect(nextPos[1]).toBe(eventPos.col);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 11.1, 11.5**
   *
   * A MoveSpace event WITHOUT position data does NOT change position.
   */
  it('MoveSpace events without position data do not change position', () => {
    fc.assert(
      fc.property(
        initialPositionArb,
        (initialPos) => {
          const event: GameEvent = { type: 'MoveSpace' };
          const nextPos = computeNextPosition(initialPos, event);

          expect(nextPos[0]).toBe(initialPos[0]);
          expect(nextPos[1]).toBe(initialPos[1]);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.1, 11.5**
   *
   * After processing a full sequence of events, the final position equals
   * the position from the LAST MoveSpace event with valid position (or
   * the initial position if no MoveSpace events had valid positions).
   */
  it('final position equals last MoveSpace position or initial', () => {
    fc.assert(
      fc.property(
        initialPositionArb,
        fc.array(gameEventArb, { minLength: 0, maxLength: 50 }),
        (initialPos, events) => {
          let currentPos: Position = initialPos;
          for (const event of events) {
            currentPos = computeNextPosition(currentPos, event);
          }

          // Find the last MoveSpace event with valid position
          const lastMoveSpace = [...events]
            .reverse()
            .find((e) => e.type === 'MoveSpace' && getEventPos(e) !== null);

          if (lastMoveSpace) {
            const expectedPos = getEventPos(lastMoveSpace)!;
            expect(currentPos[0]).toBe(expectedPos.row);
            expect(currentPos[1]).toBe(expectedPos.col);
          } else {
            // No valid MoveSpace events — position unchanged
            expect(currentPos[0]).toBe(initialPos[0]);
            expect(currentPos[1]).toBe(initialPos[1]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
