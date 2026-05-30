import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 7: Export produces valid JSON matching grid state
 *
 * For any valid grid, exportGrid produces JSON that parses back to the same
 * dimensions and tile keys.
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

          const json = exportGrid(grid);

          // Should be valid JSON
          const parsed = JSON.parse(json);

          // Should have same dimensions
          expect(parsed.length).toBe(height);
          for (let r = 0; r < height; r++) {
            expect(parsed[r].length).toBe(width);
          }

          // Should have same tile keys
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              expect(parsed[r][c]).toBe(grid[r][c]);
            }
          }
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
          const json = exportGrid(grid);
          const parsed = JSON.parse(json);

          expect(parsed.length).toBe(height);
          for (let r = 0; r < height; r++) {
            expect(parsed[r].length).toBe(width);
            for (let c = 0; c < width; c++) {
              expect(parsed[r][c]).toBe('normal');
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
          const result = exportGrid(grid);
          expect(typeof result).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });
});
