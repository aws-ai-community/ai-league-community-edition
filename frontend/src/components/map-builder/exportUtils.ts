import { TileKey } from './tileData';

/**
 * Exports a grid to a JSON string in list-of-lists format.
 * Each row is an array of tile key strings.
 */
export function exportGrid(grid: TileKey[][]): string {
  return JSON.stringify(grid);
}
