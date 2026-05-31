import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 3: Tile placement updates exactly one cell
 *
 * For any valid grid, tile key, and position (row, col), placeTile changes only
 * that one cell and all other cells remain unchanged.
 *
 * **Validates: Requirements 6.1, 6.2**
 */

import { createGrid, placeTile } from '../../frontend/src/components/map-builder/gridUtils';
import { ALL_TILE_KEYS } from '../../frontend/src/components/map-builder/tileData';

describe('Feature: map-builder, Property 3: Tile placement updates exactly one cell', () => {
  it('placeTile changes only the target cell, all others remain unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.constantFrom(...ALL_TILE_KEYS),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 0, max: 11 }),
        (width, height, tileKey, rowSeed, colSeed) => {
          // Generate valid row/col within bounds
          const row = rowSeed % height;
          const col = colSeed % width;

          const grid = createGrid(width, height);
          const newGrid = placeTile(grid, row, col, tileKey);

          // Target cell should have the new tile
          expect(newGrid[row][col]).toBe(tileKey);

          // All other cells should remain 'normal'
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              if (r !== row || c !== col) {
                expect(newGrid[r][c]).toBe(grid[r][c]);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('placeTile does not mutate the original grid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.constantFrom(...ALL_TILE_KEYS),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 0, max: 11 }),
        (width, height, tileKey, rowSeed, colSeed) => {
          const row = rowSeed % height;
          const col = colSeed % width;

          const grid = createGrid(width, height);
          // Deep copy for comparison
          const originalGrid = grid.map(r => [...r]);

          placeTile(grid, row, col, tileKey);

          // Original grid should be unchanged
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              expect(grid[r][c]).toBe(originalGrid[r][c]);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('placeTile with arbitrary position and tile key updates exactly that cell', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.constantFrom(...ALL_TILE_KEYS),
        fc.constantFrom(...ALL_TILE_KEYS),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 0, max: 11 }),
        (width, height, initialTile, newTile, rowSeed, colSeed) => {
          const row = rowSeed % height;
          const col = colSeed % width;

          // Start with a grid that has a different tile placed
          const grid = createGrid(width, height);
          const gridWithInitial = placeTile(grid, row, col, initialTile);
          const gridWithNew = placeTile(gridWithInitial, row, col, newTile);

          // Target cell should have the new tile
          expect(gridWithNew[row][col]).toBe(newTile);

          // All other cells should remain as they were
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              if (r !== row || c !== col) {
                expect(gridWithNew[r][c]).toBe(gridWithInitial[r][c]);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
