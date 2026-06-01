import type { ChallengeAssignment } from './ChallengeEditor';

/**
 * Validates that a valid path exists from the start tile to at least one treasure tile.
 * Uses BFS to explore all reachable cells from the start position, treating walls as impassable.
 *
 * @param grid - 2D array of tile keys
 * @param startRow - Row of the start tile
 * @param startCol - Column of the start tile
 * @returns Validation result with valid flag and optional error message
 */
export function validatePath(
  grid: string[][],
  startRow: number,
  startCol: number
): { valid: boolean; error?: string } {
  const rows = grid.length;
  if (rows === 0) {
    return { valid: false, error: 'Grid is empty' };
  }
  const cols = grid[0].length;

  // BFS from start position
  const visited = new Set<string>();
  const queue: [number, number][] = [[startRow, startCol]];
  visited.add(`${startRow},${startCol}`);

  const directions = [
    [-1, 0], // up
    [1, 0],  // down
    [0, -1], // left
    [0, 1],  // right
  ];

  while (queue.length > 0) {
    const [row, col] = queue.shift()!;

    // Check if we reached a treasure tile
    if (grid[row][col] === 'treasure') {
      return { valid: true };
    }

    // Explore adjacent cells
    for (const [dr, dc] of directions) {
      const newRow = row + dr;
      const newCol = col + dc;
      const key = `${newRow},${newCol}`;

      // Skip out-of-bounds
      if (newRow < 0 || newRow >= rows || newCol < 0 || newCol >= cols) {
        continue;
      }

      // Skip already visited
      if (visited.has(key)) {
        continue;
      }

      // Skip walls (impassable)
      if (grid[newRow][newCol] === 'wall') {
        continue;
      }

      visited.add(key);
      queue.push([newRow, newCol]);
    }
  }

  return { valid: false, error: 'No valid path exists from start tile to any treasure tile' };
}

/**
 * Determines whether a map is playable.
 * A map is playable when all non-passive challenge tiles on the grid have challenge assignments
 * (question + expectedAnswer + gradingStrategy).
 *
 * Passive tiles (c7 coins, c8 spikes) do not require assignments.
 *
 * @param grid - 2D array of tile keys
 * @param challenges - Record of challenge assignments keyed by "row,col"
 * @returns true if all challenge tiles that require assignments have them
 */
export function isMapPlayable(
  grid: string[][],
  challenges: Record<string, ChallengeAssignment>
): boolean {
  // Tile types that require challenge assignments
  const REQUIRES_ASSIGNMENT = new Set([
    'c1', 'c2', 'c3', 'c4', 'c5', 'c6',
    'c17', 'c18',
    'c30', 'c31', 'c32', 'c33',
    'c40', 'c41', 'c42', 'c43',
  ]);

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const cell = grid[row][col];
      if (REQUIRES_ASSIGNMENT.has(cell)) {
        const key = `${row},${col}`;
        const assignment = challenges[key];
        if (
          !assignment ||
          !assignment.question.trim() ||
          !assignment.expectedAnswer.trim() ||
          !assignment.gradingStrategy.trim()
        ) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Finds the start tile position in the grid.
 * Returns the row and column of the first 'start' tile found, or null if none exists.
 */
export function findStartPosition(grid: string[][]): { row: number; col: number } | null {
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === 'start') {
        return { row, col };
      }
    }
  }
  return null;
}
