import { TileKey } from './tileData';

/**
 * Creates a new grid of the given dimensions filled with 'normal' tiles.
 */
export function createGrid(width: number, height: number): TileKey[][] {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'normal' as TileKey)
  );
}

/**
 * Returns a new grid with the specified tile placed at (row, col).
 * Does not mutate the original grid.
 */
export function placeTile(
  grid: TileKey[][],
  row: number,
  col: number,
  tileKey: TileKey
): TileKey[][] {
  return grid.map((r, rowIndex) =>
    rowIndex === row
      ? r.map((cell, colIndex) => (colIndex === col ? tileKey : cell))
      : [...r]
  );
}

/**
 * Returns a new grid with the cell at (row, col) reset to 'normal'.
 * Does not mutate the original grid.
 */
export function resetCell(
  grid: TileKey[][],
  row: number,
  col: number
): TileKey[][] {
  return placeTile(grid, row, col, 'normal');
}

/**
 * Returns a resized grid preserving existing tiles where possible.
 * New cells are filled with 'normal'. Cells outside the new bounds are discarded.
 * Does not mutate the original grid.
 */
export function resizeGrid(
  grid: TileKey[][],
  newWidth: number,
  newHeight: number
): TileKey[][] {
  return Array.from({ length: newHeight }, (_, rowIndex) =>
    Array.from({ length: newWidth }, (_, colIndex) => {
      if (rowIndex < grid.length && colIndex < grid[rowIndex].length) {
        return grid[rowIndex][colIndex];
      }
      return 'normal' as TileKey;
    })
  );
}
