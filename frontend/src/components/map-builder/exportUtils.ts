import { TileKey, TILE_METADATA } from './tileData';
import type { TileOverride } from './MapSettings';

export interface ExportPayload {
  grid: TileKey[][];
  settings: {
    startingLives: number;
    timeLimit: number;
    tileOverrides: Record<string, TileOverride>;
  };
}

/**
 * Returns only tile overrides that differ from TILE_METADATA defaults.
 */
function filterNonDefaultOverrides(
  tileOverrides: Record<string, TileOverride>
): Record<string, TileOverride> {
  const filtered: Record<string, TileOverride> = {};

  for (const [key, override] of Object.entries(tileOverrides)) {
    const metadata = TILE_METADATA[key as TileKey];
    const defaultPoints = metadata?.points ?? 0;
    const defaultDamage = metadata?.damage ?? 0;

    if (override.points !== defaultPoints || override.damage !== defaultDamage) {
      filtered[key] = override;
    }
  }

  return filtered;
}

/**
 * Exports a grid and settings to a JSON string.
 * Output: { "grid": [...], "settings": { "startingLives": N, "timeLimit": N, "tileOverrides": {...} } }
 * Only includes overrides that differ from TILE_METADATA defaults.
 */
export function exportGrid(
  grid: TileKey[][],
  startingLives: number,
  timeLimit: number,
  tileOverrides: Record<string, TileOverride>
): string {
  const filteredOverrides = filterNonDefaultOverrides(tileOverrides);
  const payload: ExportPayload = {
    grid,
    settings: {
      startingLives,
      timeLimit,
      tileOverrides: filteredOverrides,
    },
  };
  return JSON.stringify(payload);
}
