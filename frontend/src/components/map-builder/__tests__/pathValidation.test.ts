import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePath, findStartPosition } from '../pathValidation';

/**
 * Property 2: Path validation ensures reachability
 *
 * For any grid that passes the Map Builder's path validation, there SHALL exist
 * at least one valid path (sequence of adjacent non-wall cells) from the start tile
 * to at least one treasure tile.
 *
 * **Validates: Requirements 3.11**
 */

// All non-wall tile types that can appear on the grid
const WALKABLE_TILES = [
  'normal', 'start', 'treasure',
  'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8',
  'c17', 'c18',
  'c30', 'c31', 'c32', 'c33',
  'c40', 'c41', 'c42', 'c43',
] as const;

const ALL_TILES = [...WALKABLE_TILES, 'wall'] as const;

/**
 * BFS implementation independent of the one under test, used to verify reachability.
 */
function bfsReachable(grid: string[][], startRow: number, startCol: number): Set<string> {
  const rows = grid.length;
  const cols = grid[0].length;
  const visited = new Set<string>();
  const queue: [number, number][] = [[startRow, startCol]];
  visited.add(`${startRow},${startCol}`);

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length > 0) {
    const [row, col] = queue.shift()!;
    for (const [dr, dc] of directions) {
      const nr = row + dr;
      const nc = col + dc;
      const key = `${nr},${nc}`;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited.has(key) && grid[nr][nc] !== 'wall') {
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
  }

  return visited;
}

/**
 * Generates a random grid of size rows x cols with a guaranteed start tile and treasure tile.
 * Walls are placed randomly.
 */
function gridArbitrary(minSize: number, maxSize: number) {
  return fc.tuple(
    fc.integer({ min: minSize, max: maxSize }), // rows
    fc.integer({ min: minSize, max: maxSize }), // cols
  ).chain(([rows, cols]) => {
    // Generate start and treasure positions
    return fc.tuple(
      fc.constant(rows),
      fc.constant(cols),
      fc.integer({ min: 0, max: rows - 1 }), // startRow
      fc.integer({ min: 0, max: cols - 1 }), // startCol
      fc.integer({ min: 0, max: rows - 1 }), // treasureRow
      fc.integer({ min: 0, max: cols - 1 }), // treasureCol
      // For each cell, decide if it's a wall or a walkable tile
      fc.array(
        fc.array(
          fc.oneof(
            fc.constant('wall'),
            fc.constant('normal'),
            fc.constantFrom(...WALKABLE_TILES.filter(t => t !== 'start' && t !== 'treasure')),
          ),
          { minLength: cols, maxLength: cols }
        ),
        { minLength: rows, maxLength: rows }
      ),
    );
  }).map(([rows, cols, startRow, startCol, treasureRow, treasureCol, grid]) => {
    // Cast to string[][] to allow 'start' and 'treasure' assignments
    const g = grid as string[][];
    // Place start and treasure tiles (overriding whatever was generated)
    g[startRow][startCol] = 'start';
    // Ensure treasure is at a different position than start
    if (treasureRow === startRow && treasureCol === startCol) {
      // Move treasure to a different position
      treasureCol = (treasureCol + 1) % cols;
      if (treasureRow === startRow && treasureCol === startCol) {
        treasureRow = (treasureRow + 1) % rows;
      }
    }
    g[treasureRow][treasureCol] = 'treasure';
    return { grid: g, startRow, startCol, treasureRow, treasureCol };
  });
}

describe('Property 2: Path validation ensures reachability', () => {
  it('if validatePath returns valid=true, BFS from start actually reaches treasure', () => {
    fc.assert(
      fc.property(
        gridArbitrary(3, 10),
        ({ grid, startRow, startCol }) => {
          const result = validatePath(grid, startRow, startCol);

          if (result.valid) {
            // If validation says valid, BFS must reach at least one treasure
            const reachable = bfsReachable(grid, startRow, startCol);
            const rows = grid.length;
            const cols = grid[0].length;
            let treasureReachable = false;

            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                if (grid[r][c] === 'treasure' && reachable.has(`${r},${c}`)) {
                  treasureReachable = true;
                }
              }
            }

            expect(treasureReachable).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('if no treasure exists, validatePath returns valid=false', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 3, max: 8 }),
          fc.integer({ min: 3, max: 8 }),
        ).chain(([rows, cols]) => {
          return fc.tuple(
            fc.constant(rows),
            fc.constant(cols),
            fc.integer({ min: 0, max: rows - 1 }),
            fc.integer({ min: 0, max: cols - 1 }),
            fc.array(
              fc.array(
                fc.constantFrom('normal', 'wall', 'c1', 'c2', 'c7', 'c8'),
                { minLength: cols, maxLength: cols }
              ),
              { minLength: rows, maxLength: rows }
            ),
          );
        }).map(([_rows, _cols, startRow, startCol, grid]) => {
          // Place start but NO treasure — cast to string[][] for assignment
          const g = grid as string[][];
          g[startRow][startCol] = 'start';
          return { grid: g, startRow, startCol };
        }),
        ({ grid, startRow, startCol }) => {
          const result = validatePath(grid, startRow, startCol);
          expect(result.valid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('if treasure is completely walled off, validatePath returns valid=false', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 5, max: 10 }),
          fc.integer({ min: 5, max: 10 }),
        ).chain(([rows, cols]) => {
          // Place start in top-left quadrant, treasure in bottom-right quadrant
          return fc.tuple(
            fc.constant(rows),
            fc.constant(cols),
            fc.integer({ min: 0, max: Math.floor(rows / 2) - 1 }), // startRow
            fc.integer({ min: 0, max: Math.floor(cols / 2) - 1 }), // startCol
            fc.integer({ min: Math.floor(rows / 2) + 1, max: rows - 1 }), // treasureRow
            fc.integer({ min: Math.floor(cols / 2) + 1, max: cols - 1 }), // treasureCol
          );
        }).map(([rows, cols, startRow, startCol, treasureRow, treasureCol]) => {
          // Create a grid with a wall barrier separating start from treasure
          const grid: string[][] = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => 'normal')
          );

          grid[startRow][startCol] = 'start';
          grid[treasureRow][treasureCol] = 'treasure';

          // Create a complete wall barrier around the treasure tile
          // Wall off all adjacent cells to treasure
          const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
          for (const [dr, dc] of directions) {
            const wr = treasureRow + dr;
            const wc = treasureCol + dc;
            if (wr >= 0 && wr < rows && wc >= 0 && wc < cols && !(wr === startRow && wc === startCol)) {
              grid[wr][wc] = 'wall';
            }
          }

          return { grid, startRow, startCol };
        }),
        ({ grid, startRow, startCol }) => {
          const result = validatePath(grid, startRow, startCol);
          expect(result.valid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
