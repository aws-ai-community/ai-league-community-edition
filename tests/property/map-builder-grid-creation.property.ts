import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 1: Grid creation produces correct dimensions with default tiles
 *
 * For any width in [2,12] and height in [2,12], createGrid(width, height) produces
 * a grid with exactly `height` rows and `width` columns, all cells set to 'normal'.
 *
 * **Validates: Requirements 2.4, 2.5**
 */

import { createGrid } from '../../frontend/src/components/map-builder/gridUtils';

describe('Feature: map-builder, Property 1: Grid creation produces correct dimensions with default tiles', () => {
  it('creates a grid with exactly height rows and width columns, all normal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          const grid = createGrid(width, height);

          // Verify row count equals height
          expect(grid.length).toBe(height);

          // Verify each row has width columns and all cells are 'normal'
          for (let r = 0; r < height; r++) {
            expect(grid[r].length).toBe(width);
            for (let c = 0; c < width; c++) {
              expect(grid[r][c]).toBe('normal');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('each row is an independent array (no shared references)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          const grid = createGrid(width, height);

          // Verify rows are independent objects
          for (let r = 0; r < height - 1; r++) {
            expect(grid[r]).not.toBe(grid[r + 1]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
