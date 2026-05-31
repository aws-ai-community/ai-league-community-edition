import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 2: Tile metadata completeness by category
 *
 * For any tile in the registry, verify non-empty name and description.
 * Challenge tiles must have numeric points and damage.
 * Door tiles must have non-empty requirements string.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
 */

import { TILE_METADATA, ALL_TILE_KEYS } from '../../frontend/src/components/map-builder/tileData';

describe('Feature: map-builder, Property 2: Tile metadata completeness by category', () => {
  it('every tile has a non-empty name and description', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_TILE_KEYS),
        (tileKey) => {
          const meta = TILE_METADATA[tileKey];
          expect(meta).toBeDefined();
          expect(meta.name).toBeDefined();
          expect(meta.name.length).toBeGreaterThan(0);
          expect(meta.description).toBeDefined();
          expect(meta.description.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('challenge tiles have numeric points and damage', () => {
    const challengeKeys = ALL_TILE_KEYS.filter(
      (key) => TILE_METADATA[key].category === 'Challenge'
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...challengeKeys),
        (tileKey) => {
          const meta = TILE_METADATA[tileKey];
          expect(meta.category).toBe('Challenge');
          expect(typeof meta.points).toBe('number');
          expect(typeof meta.damage).toBe('number');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('door tiles have non-empty requirements string', () => {
    const doorKeys = ALL_TILE_KEYS.filter(
      (key) => TILE_METADATA[key].category === 'Door'
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...doorKeys),
        (tileKey) => {
          const meta = TILE_METADATA[tileKey];
          expect(meta.category).toBe('Door');
          expect(typeof meta.requirements).toBe('string');
          expect(meta.requirements!.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all tile keys in ALL_TILE_KEYS have corresponding metadata entries', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_TILE_KEYS),
        (tileKey) => {
          expect(TILE_METADATA[tileKey]).toBeDefined();
          expect(TILE_METADATA[tileKey].key).toBe(tileKey);
        }
      ),
      { numRuns: 100 }
    );
  });
});
