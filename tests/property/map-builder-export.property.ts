import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 7: Export produces valid JSON matching grid state
 *
 * For any valid grid, exportGrid produces JSON that parses back to the same
 * dimensions and tile keys, and includes a well-formed settings object.
 *
 * **Validates: Requirements 11.2, 11.3**
 */

import { exportGrid } from '../../frontend/src/components/map-builder/exportUtils';
import { createGrid, placeTile } from '../../frontend/src/components/map-builder/gridUtils';
import { ALL_TILE_KEYS, TileKey } from '../../frontend/src/components/map-builder/tileData';

describe('Feature: map-builder, Property 7: Export produces valid JSON matching grid state', () => {
  it('exportGrid produces JSON that parses back to the same dimensions and tile keys', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        fc.array(
          fc.record({
            row: fc.integer({ min: 0, max: 11 }),
            col: fc.integer({ min: 0, max: 11 }),
            tile: fc.constantFrom(...ALL_TILE_KEYS),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (width, height, placements) => {
          let grid = createGrid(width, height);

          // Apply random tile placements within bounds
          for (const { row, col, tile } of placements) {
            if (row < height && col < width) {
              grid = placeTile(grid, row, col, tile as TileKey);
            }
          }

          const json = exportGrid(grid, 5, 5, {});

          // Should be valid JSON
          const parsed = JSON.parse(json);

          // Should have grid and settings top-level keys
          expect(parsed).toHaveProperty('grid');
          expect(parsed).toHaveProperty('settings');

          // Should have same dimensions
          expect(parsed.grid.length).toBe(height);
          for (let r = 0; r < height; r++) {
            expect(parsed.grid[r].length).toBe(width);
          }

          // Should have same tile keys
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              expect(parsed.grid[r][c]).toBe(grid[r][c]);
            }
          }

          // Settings should have expected fields
          expect(parsed.settings.startingLives).toBe(5);
          expect(parsed.settings.timeLimit).toBe(5);
          expect(parsed.settings.tileOverrides).toEqual({});
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exportGrid of a fresh grid produces all-normal JSON', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          const grid = createGrid(width, height);
          const json = exportGrid(grid, 5, 5, {});
          const parsed = JSON.parse(json);

          expect(parsed.grid.length).toBe(height);
          for (let r = 0; r < height; r++) {
            expect(parsed.grid[r].length).toBe(width);
            for (let c = 0; c < width; c++) {
              expect(parsed.grid[r][c]).toBe('normal');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exportGrid output is a string', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 2, max: 12 }),
        (width, height) => {
          const grid = createGrid(width, height);
          const result = exportGrid(grid, 5, 5, {});
          expect(typeof result).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });
});
