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

/**
 * Validates settings values for startingLives, timeLimit, and tileOverrides.
 */
export function validateSettings(
  startingLives: number,
  timeLimit: number,
  tileOverrides: Record<string, { points: number; damage: number }>
): ValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(startingLives) || startingLives < 1) {
    errors.push('Starting Lives must be an integer of 1 or greater');
  }

  if (!Number.isInteger(timeLimit) || timeLimit < 1) {
    errors.push('Time Limit must be an integer of 1 or greater');
  }

  for (const [tileKey, override] of Object.entries(tileOverrides)) {
    if (!Number.isInteger(override.points) || override.points < 0) {
      errors.push(`Points for ${tileKey} must be a non-negative integer`);
    }
    if (!Number.isInteger(override.damage) || override.damage < 0) {
      errors.push(`Damage for ${tileKey} must be a non-negative integer`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
