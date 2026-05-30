import { useState, useCallback, type DragEvent, type MouseEvent } from 'react';
import { TILE_SPRITES, type TileKey } from './tileData';
import { TileTooltip } from './TileTooltip';

interface MapGridProps {
  grid: TileKey[][];
  onCellDrop: (row: number, col: number, tileKey: TileKey) => void;
  onCellClick: (row: number, col: number) => void;
  onCellRightClick: (row: number, col: number) => void;
}

export function MapGrid({ grid, onCellDrop, onCellClick, onCellRightClick }: MapGridProps) {
  const [dragOverCell, setDragOverCell] = useState<{ row: number; col: number } | null>(null);

  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;

  // Compute cell size based on grid dimensions — larger grids get smaller cells
  const maxCells = Math.max(rows, cols);
  const cellSize = maxCells <= 5 ? 64 : maxCells <= 8 ? 48 : 36;

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, row: number, col: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOverCell({ row, col });
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, row: number, col: number) => {
      e.preventDefault();
      setDragOverCell(null);
      const raw = e.dataTransfer.getData('text/plain');
      if (raw && raw in TILE_SPRITES) {
        onCellDrop(row, col, raw as TileKey);
      }
    },
    [onCellDrop]
  );

  const handleClick = useCallback(
    (_e: MouseEvent<HTMLDivElement>, row: number, col: number) => {
      onCellClick(row, col);
    },
    [onCellClick]
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, row: number, col: number) => {
      e.preventDefault();
      onCellRightClick(row, col);
    },
    [onCellRightClick]
  );

  return (
    <div
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
        gap: 1,
        backgroundColor: '#333',
        border: '1px solid #444',
        borderRadius: 4,
        padding: 1,
      }}
      role="grid"
      aria-label="Map grid"
    >
      {grid.map((row, rowIdx) =>
        row.map((tileKey, colIdx) => {
          const isDragOver =
            dragOverCell?.row === rowIdx && dragOverCell?.col === colIdx;

          return (
            <TileTooltip key={`${rowIdx}-${colIdx}`} tileKey={tileKey}>
              <div
                role="gridcell"
                aria-label={`Cell ${rowIdx},${colIdx}: ${tileKey}`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  aspectRatio: '1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDragOver ? '#4a90d9' : '#1e1e2e',
                  border: isDragOver ? '2px solid #6bb5ff' : '1px solid #3a3a4a',
                  borderRadius: 2,
                  cursor: 'pointer',
                  transition: 'background-color 0.1s, border-color 0.1s',
                  boxSizing: 'border-box',
                }}
                onDragOver={(e) => handleDragOver(e, rowIdx, colIdx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, rowIdx, colIdx)}
                onClick={(e) => handleClick(e, rowIdx, colIdx)}
                onContextMenu={(e) => handleContextMenu(e, rowIdx, colIdx)}
              >
                <img
                  src={TILE_SPRITES[tileKey]}
                  alt={tileKey}
                  style={{
                    width: '85%',
                    height: '85%',
                    objectFit: 'contain',
                    imageRendering: 'pixelated',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                  draggable={false}
                />
              </div>
            </TileTooltip>
          );
        })
      )}
    </div>
  );
}
