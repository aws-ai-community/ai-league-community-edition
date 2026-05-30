import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 4: Cell reset restores to normal
 *
 * For any valid grid and position, resetCell sets that cell to 'normal'
 * without affecting others.
 *
 * **Validates: Requirements 6.3**
 */

import { createGrid, placeTile, resetCell } from '../../frontend/src/components/map-builder/gridUtils';
import { ALL_TILE_KEYS } from '../../frontend/src/components/map-builder/tileData';

describe('Feature: map-builder, Property 4: Cell reset restores to normal', () => {
  it('resetCell sets the target cell to normal without affecting others', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.constantFrom(...ALL_TILE_KEYS),
        (width, height, tileKey) => {
          const row = Math.floor(Math.random() * height);
          const col = Math.floor(Math.random() * width);

          // Place a tile first, then reset it
          const grid = createGrid(width, height);
          const gridWithTile = placeTile(grid, row, col, tileKey);
          const gridAfterReset = resetCell(gridWithTile, row, col);

          // Target cell should be 'normal'
          expect(gridAfterReset[row][col]).toBe('normal');

          // All other cells should remain unchanged
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              if (r !== row || c !== col) {
                expect(gridAfterReset[r][c]).toBe(gridWithTile[r][c]);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('resetCell on an already-normal cell is a no-op for that cell', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          const row = Math.floor(Math.random() * height);
          const col = Math.floor(Math.random() * width);

          const grid = createGrid(width, height);
          const gridAfterReset = resetCell(grid, row, col);

          // All cells should still be 'normal'
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              expect(gridAfterReset[r][c]).toBe('normal');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('resetCell does not mutate the original grid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.constantFrom(...ALL_TILE_KEYS),
        (width, height, tileKey) => {
          const row = Math.floor(Math.random() * height);
          const col = Math.floor(Math.random() * width);

          const grid = createGrid(width, height);
          const gridWithTile = placeTile(grid, row, col, tileKey);
          const originalCopy = gridWithTile.map(r => [...r]);

          resetCell(gridWithTile, row, col);

          // Original grid should be unchanged
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              expect(gridWithTile[r][c]).toBe(originalCopy[r][c]);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
