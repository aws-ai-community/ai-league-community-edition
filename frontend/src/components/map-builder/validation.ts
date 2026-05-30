import { TileKey } from './tileData';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a map grid for playability.
 * A valid map must contain exactly one 'start' tile and exactly one 'treasure' tile.
 */
export function validateMap(grid: TileKey[][]): ValidationResult {
  const errors: string[] = [];

  let startCount = 0;
  let treasureCount = 0;

  for (const row of grid) {
    for (const cell of row) {
      if (cell === 'start') {
        startCount++;
      } else if (cell === 'treasure') {
        treasureCount++;
      }
    }
  }

  if (startCount === 0) {
    errors.push('Map must contain exactly one start tile');
  } else if (startCount > 1) {
    errors.push('Map must contain exactly one start tile, but found ' + startCount);
  }

  if (treasureCount === 0) {
    errors.push('Map must contain exactly one treasure tile');
  } else if (treasureCount > 1) {
    errors.push('Map must contain exactly one treasure tile, but found ' + treasureCount);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
