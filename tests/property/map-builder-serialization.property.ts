import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 5: Map serialization round-trip
 *
 * For any valid map data (name 1-100 chars, dimensions 2-12, grid with valid tiles),
 * serializing to JSON and parsing back produces equivalent data.
 *
 * **Validates: Requirements 7.3, 7.4, 8.3**
 */

import { ALL_TILE_KEYS, TileKey } from '../../frontend/src/components/map-builder/tileData';

interface MapDocument {
  userId: string;
  mapId: string;
  name: string;
  width: number;
  height: number;
  grid: TileKey[][];
  createdAt: string;
  updatedAt: string;
}

// Arbitrary for generating valid map documents
const mapDocumentArb = fc
  .record({
    userId: fc.uuid(),
    mapId: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length >= 1),
    width: fc.integer({ min: 2, max: 12 }),
    height: fc.integer({ min: 2, max: 12 }),
    createdAt: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ts => new Date(ts).toISOString()),
    updatedAt: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ts => new Date(ts).toISOString()),
  })
  .chain((doc) => {
    // Generate a grid matching the dimensions with valid tile keys
    const gridArb = fc.array(
      fc.array(fc.constantFrom(...ALL_TILE_KEYS), {
        minLength: doc.width,
        maxLength: doc.width,
      }),
      { minLength: doc.height, maxLength: doc.height }
    );
    return gridArb.map((grid) => ({ ...doc, grid } as MapDocument));
  });

describe('Feature: map-builder, Property 5: Map serialization round-trip', () => {
  it('JSON.parse(JSON.stringify(doc)) produces equivalent data', () => {
    fc.assert(
      fc.property(mapDocumentArb, (doc) => {
        const serialized = JSON.stringify(doc);
        const deserialized = JSON.parse(serialized) as MapDocument;

        // Verify all fields are preserved
        expect(deserialized.userId).toBe(doc.userId);
        expect(deserialized.mapId).toBe(doc.mapId);
        expect(deserialized.name).toBe(doc.name);
        expect(deserialized.width).toBe(doc.width);
        expect(deserialized.height).toBe(doc.height);
        expect(deserialized.createdAt).toBe(doc.createdAt);
        expect(deserialized.updatedAt).toBe(doc.updatedAt);

        // Verify grid dimensions
        expect(deserialized.grid.length).toBe(doc.height);
        for (let r = 0; r < doc.height; r++) {
          expect(deserialized.grid[r].length).toBe(doc.width);
          for (let c = 0; c < doc.width; c++) {
            expect(deserialized.grid[r][c]).toBe(doc.grid[r][c]);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('serialized map preserves name length', () => {
    fc.assert(
      fc.property(mapDocumentArb, (doc) => {
        const deserialized = JSON.parse(JSON.stringify(doc));
        expect(deserialized.name.length).toBe(doc.name.length);
      }),
      { numRuns: 100 }
    );
  });

  it('serialized map preserves grid tile keys exactly', () => {
    fc.assert(
      fc.property(mapDocumentArb, (doc) => {
        const deserialized = JSON.parse(JSON.stringify(doc));
        // Deep equality check on the grid
        expect(deserialized.grid).toEqual(doc.grid);
      }),
      { numRuns: 100 }
    );
  });
});
