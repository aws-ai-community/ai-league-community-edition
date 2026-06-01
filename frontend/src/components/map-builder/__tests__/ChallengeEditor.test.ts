import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isMapPlayable } from '../pathValidation';
import type { ChallengeAssignment } from '../ChallengeEditor';

/**
 * Property 1: Map save preserves challenge assignments
 *
 * For any valid map with challenge tiles, the challenges record contains an entry
 * for every challenge tile position when isMapPlayable returns true.
 *
 * **Validates: Requirements 3.7, 3.10**
 */

// Tile types that require challenge assignments (non-passive)
const CHALLENGE_TILES_REQUIRING_ASSIGNMENT = [
  'c1', 'c2', 'c3', 'c4', 'c5', 'c6',
  'c17', 'c18',
  'c30', 'c31', 'c32', 'c33',
  'c40', 'c41', 'c42', 'c43',
] as const;

// All tile types that can appear on the grid
const ALL_PLACEABLE_TILES = [
  'normal', 'wall', 'start', 'treasure',
  'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8',
  'c17', 'c18',
  'c30', 'c31', 'c32', 'c33',
  'c40', 'c41', 'c42', 'c43',
] as const;

const GRADING_STRATEGIES = ['exact_match', 'contains_match', 'json_exact_match', 'guardrail_block'] as const;

/**
 * Generates a valid ChallengeAssignment with non-empty fields.
 */
function challengeAssignmentArbitrary(tileType: string): fc.Arbitrary<ChallengeAssignment> {
  return fc.tuple(
    fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
    fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    fc.constantFrom(...GRADING_STRATEGIES),
  ).map(([question, expectedAnswer, gradingStrategy]) => ({
    type: tileType,
    question,
    expectedAnswer,
    gradingStrategy,
  }));
}

/**
 * Generates a grid with random challenge tile placements and a complete
 * challenges record that covers all non-passive challenge tiles.
 */
function gridWithChallengesArbitrary() {
  return fc.tuple(
    fc.integer({ min: 3, max: 8 }),
    fc.integer({ min: 3, max: 8 }),
  ).chain(([rows, cols]) => {
    return fc.tuple(
      fc.constant(rows),
      fc.constant(cols),
      fc.integer({ min: 0, max: rows - 1 }), // startRow
      fc.integer({ min: 0, max: cols - 1 }), // startCol
      // Generate grid cells
      fc.array(
        fc.array(
          fc.constantFrom(...ALL_PLACEABLE_TILES),
          { minLength: cols, maxLength: cols }
        ),
        { minLength: rows, maxLength: rows }
      ),
    );
  }).chain(([rows, cols, startRow, startCol, grid]) => {
    // Place start tile
    grid[startRow][startCol] = 'start';

    // Find all challenge tile positions that require assignments
    const challengePositions: { row: number; col: number; type: string }[] = [];
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        const cell = grid[row][col];
        if ((CHALLENGE_TILES_REQUIRING_ASSIGNMENT as readonly string[]).includes(cell)) {
          challengePositions.push({ row, col, type: cell });
        }
      }
    }

    // Generate challenge assignments for all positions
    if (challengePositions.length === 0) {
      return fc.constant({ grid, challenges: {} as Record<string, ChallengeAssignment>, challengePositions });
    }

    const assignmentArbitraries = challengePositions.map(pos =>
      challengeAssignmentArbitrary(pos.type).map(assignment => ({
        key: `${pos.row},${pos.col}`,
        assignment,
      }))
    );

    return fc.tuple(...assignmentArbitraries).map(assignments => {
      const challenges: Record<string, ChallengeAssignment> = {};
      for (const { key, assignment } of assignments) {
        challenges[key] = assignment;
      }
      return { grid, challenges, challengePositions };
    });
  });
}

describe('Property 1: Map save preserves challenge assignments', () => {
  it('if isMapPlayable returns true, every non-passive challenge tile position has a corresponding entry in the challenges dict', () => {
    fc.assert(
      fc.property(
        gridWithChallengesArbitrary(),
        ({ grid, challenges, challengePositions }) => {
          const playable = isMapPlayable(grid, challenges);

          if (playable) {
            // Every non-passive challenge tile must have a valid entry
            for (const pos of challengePositions) {
              const key = `${pos.row},${pos.col}`;
              const assignment = challenges[key];

              // Entry must exist
              expect(assignment).toBeDefined();

              // Entry must have non-empty question, expectedAnswer, and gradingStrategy
              expect(assignment.question.trim().length).toBeGreaterThan(0);
              expect(assignment.expectedAnswer.trim().length).toBeGreaterThan(0);
              expect(assignment.gradingStrategy.trim().length).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('isMapPlayable returns false when any challenge tile is missing an assignment', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 3, max: 6 }),
          fc.integer({ min: 3, max: 6 }),
        ).chain(([rows, cols]) => {
          return fc.tuple(
            fc.constant(rows),
            fc.constant(cols),
            // Place at least one challenge tile
            fc.integer({ min: 0, max: rows - 1 }),
            fc.integer({ min: 0, max: cols - 1 }),
            fc.constantFrom(...CHALLENGE_TILES_REQUIRING_ASSIGNMENT),
          );
        }).map(([rows, cols, challengeRow, challengeCol, challengeType]) => {
          // Create a grid with at least one challenge tile
          const grid: string[][] = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => 'normal')
          );
          grid[0][0] = 'start';
          grid[challengeRow][challengeCol] = challengeType;

          // Provide an EMPTY challenges record (missing the assignment)
          const challenges: Record<string, ChallengeAssignment> = {};

          return { grid, challenges };
        }),
        ({ grid, challenges }) => {
          const playable = isMapPlayable(grid, challenges);
          expect(playable).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isMapPlayable returns false when a challenge tile has empty question or answer', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 3, max: 6 }),
          fc.integer({ min: 3, max: 6 }),
          fc.constantFrom(...CHALLENGE_TILES_REQUIRING_ASSIGNMENT),
          fc.constantFrom('question', 'expectedAnswer', 'gradingStrategy') as fc.Arbitrary<'question' | 'expectedAnswer' | 'gradingStrategy'>,
        ).map(([rows, cols, challengeType, emptyField]) => {
          const grid: string[][] = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => 'normal')
          );
          grid[0][0] = 'start';
          // Place challenge tile at position (1, 1)
          const challengeRow = Math.min(1, rows - 1);
          const challengeCol = Math.min(1, cols - 1);
          grid[challengeRow][challengeCol] = challengeType;

          // Create assignment with one empty field
          const key = `${challengeRow},${challengeCol}`;
          const assignment: ChallengeAssignment = {
            type: challengeType,
            question: 'What is 2+2?',
            expectedAnswer: '4',
            gradingStrategy: 'exact_match',
          };
          // Make one field empty
          assignment[emptyField] = '   '; // whitespace-only counts as empty

          const challenges: Record<string, ChallengeAssignment> = { [key]: assignment };

          return { grid, challenges };
        }),
        ({ grid, challenges }) => {
          const playable = isMapPlayable(grid, challenges);
          expect(playable).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
