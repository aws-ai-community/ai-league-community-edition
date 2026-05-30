import React from 'react';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { TILE_METADATA, TILE_SPRITES, TileKey } from './tileData';

export interface TilePaletteProps {
  selectedTile: TileKey | null;
  onTileSelect: (tileKey: TileKey) => void;
}

const CATEGORIES = ['Special', 'Challenge', 'Key', 'Door'] as const;

function getTilesByCategory(category: string): TileKey[] {
  return (Object.values(TILE_METADATA) as { key: TileKey; category: string }[])
    .filter((tile) => tile.category === category)
    .map((tile) => tile.key);
}

export function TilePalette({ selectedTile, onTileSelect }: TilePaletteProps) {
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, tileKey: TileKey) => {
    e.dataTransfer.setData('text/plain', tileKey);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <SpaceBetween size="s">
      {CATEGORIES.map((category) => {
        const tiles = getTilesByCategory(category);
        return (
          <ExpandableSection
            key={category}
            headerText={category}
            defaultExpanded
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {tiles.map((tileKey) => {
                const metadata = TILE_METADATA[tileKey];
                const isSelected = selectedTile === tileKey;
                return (
                  <div
                    key={tileKey}
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, tileKey)}
                    onClick={() => onTileSelect(tileKey)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onTileSelect(tileKey);
                      }
                    }}
                    aria-label={`${metadata.name} tile`}
                    aria-pressed={isSelected}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '4px',
                      cursor: 'grab',
                      borderRadius: '4px',
                      border: isSelected
                        ? '2px solid #0972d3'
                        : '2px solid transparent',
                      backgroundColor: isSelected
                        ? 'rgba(9, 114, 211, 0.1)'
                        : 'transparent',
                      width: '64px',
                    }}
                  >
                    <img
                      src={TILE_SPRITES[tileKey]}
                      alt={metadata.name}
                      width={48}
                      height={48}
                      draggable={false}
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <span
                      style={{
                        fontSize: '11px',
                        textAlign: 'center',
                        marginTop: '2px',
                        lineHeight: '1.2',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%',
                      }}
                    >
                      {metadata.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </ExpandableSection>
        );
      })}
    </SpaceBetween>
  );
}
