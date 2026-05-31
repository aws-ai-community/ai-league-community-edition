import { describe, it, expect } from 'vitest';
import { validateMap, ValidationResult } from '../../frontend/src/components/map-builder/validation';
import { TileKey } from '../../frontend/src/components/map-builder/tileData';

describe('validateMap', () => {
  it('returns valid for a grid with exactly one start and one treasure', () => {
    const grid: TileKey[][] = [
      ['start', 'normal', 'normal'],
      ['normal', 'wall', 'normal'],
      ['normal', 'normal', 'treasure'],
    ];
    const result = validateMap(grid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when no start tile exists', () => {
    const grid: TileKey[][] = [
      ['normal', 'normal'],
      ['normal', 'treasure'],
    ];
    const result = validateMap(grid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Map must contain exactly one start tile');
  });

  it('returns error when no treasure tile exists', () => {
    const grid: TileKey[][] = [
      ['start', 'normal'],
      ['normal', 'normal'],
    ];
    const result = validateMap(grid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Map must contain exactly one treasure tile');
  });

  it('returns errors when both start and treasure are missing', () => {
    const grid: TileKey[][] = [
      ['normal', 'wall'],
      ['normal', 'normal'],
    ];
    const result = validateMap(grid);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain('Map must contain exactly one start tile');
    expect(result.errors).toContain('Map must contain exactly one treasure tile');
  });

  it('returns error when multiple start tiles exist', () => {
    const grid: TileKey[][] = [
      ['start', 'normal'],
      ['start', 'treasure'],
    ];
    const result = validateMap(grid);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Map must contain exactly one start tile, but found 2');
  });

  it('returns error when multiple treasure tiles exist', () => {
    const grid: TileKey[][] = [
      ['start', 'treasure'],
      ['normal', 'treasure'],
    ];
    const result = validateMap(grid);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Map must contain exactly one treasure tile, but found 2');
  });

  it('handles a grid with various tile types correctly', () => {
    const grid: TileKey[][] = [
      ['start', 'c1', 'c40'],
      ['wall', 'c30', 'normal'],
      ['c7', 'normal', 'treasure'],
    ];
    const result = validateMap(grid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
