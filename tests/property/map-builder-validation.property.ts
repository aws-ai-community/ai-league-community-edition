import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 6: Map validation correctness
 *
 * For any grid with valid tile keys, validateMap returns valid=true iff exactly
 * one start and one treasure exist.
 *
 * **Validates: Requirements 10.1, 10.2, 10.4**
 */

import { validateMap } from '../../frontend/src/components/map-builder/validation';
import { createGrid, placeTile } from '../../frontend/src/components/map-builder/gridUtils';
import { ALL_TILE_KEYS, TileKey } from '../../frontend/src/components/map-builder/tileData';

// Tile keys that are NOT start or treasure
const NON_SPECIAL_KEYS = ALL_TILE_KEYS.filter(
  (k) => k !== 'start' && k !== 'treasure'
);

describe('Feature: map-builder, Property 6: Map validation correctness', () => {
  it('valid=true iff exactly one start and one treasure exist', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        (width, height, startCount, treasureCount) => {
          // Build a grid with the specified number of start and treasure tiles
          let grid = createGrid(width, height);

          // Place start tiles
          let placed = 0;
          for (let r = 0; r < height && placed < startCount; r++) {
            for (let c = 0; c < width && placed < startCount; c++) {
              if (grid[r][c] === 'normal') {
                grid = placeTile(grid, r, c, 'start');
                placed++;
              }
            }
          }

          // Place treasure tiles
          placed = 0;
          for (let r = height - 1; r >= 0 && placed < treasureCount; r--) {
            for (let c = width - 1; c >= 0 && placed < treasureCount; c--) {
              if (grid[r][c] === 'normal') {
                grid = placeTile(grid, r, c, 'treasure');
                placed++;
              }
            }
          }

          const result = validateMap(grid);

          if (startCount === 1 && treasureCount === 1) {
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
          } else {
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('grid with exactly one start and one treasure is valid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          let grid = createGrid(width, height);
          // Place start at (0,0) and treasure at (height-1, width-1)
          grid = placeTile(grid, 0, 0, 'start');
          grid = placeTile(grid, height - 1, width - 1, 'treasure');

          const result = validateMap(grid);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('grid with no start tile is invalid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          let grid = createGrid(width, height);
          // Only place treasure, no start
          grid = placeTile(grid, height - 1, width - 1, 'treasure');

          const result = validateMap(grid);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.toLowerCase().includes('start'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('grid with no treasure tile is invalid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          let grid = createGrid(width, height);
          // Only place start, no treasure
          grid = placeTile(grid, 0, 0, 'start');

          const result = validateMap(grid);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.toLowerCase().includes('treasure'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('grid with random non-start/non-treasure tiles is invalid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 2, max: 8 }),
        fc.array(fc.constantFrom(...NON_SPECIAL_KEYS), { minLength: 1, maxLength: 10 }),
        (width, height, tiles) => {
          let grid = createGrid(width, height);

          // Place random non-start/non-treasure tiles
          for (let i = 0; i < tiles.length && i < width * height; i++) {
            const r = Math.floor(i / width);
            const c = i % width;
            if (r < height) {
              grid = placeTile(grid, r, c, tiles[i] as TileKey);
            }
          }

          const result = validateMap(grid);
          expect(result.valid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
