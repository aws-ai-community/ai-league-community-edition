import React from 'react';
import { TILE_METADATA, type TileKey } from './tileData';

export interface TileTooltipProps {
  tileKey: TileKey;
  children: React.ReactNode;
}

export function TileTooltip({ tileKey, children }: TileTooltipProps) {
  const metadata = TILE_METADATA[tileKey];

  // Build tooltip text
  const lines: string[] = [metadata.name, metadata.description];
  if (metadata.points !== undefined) {
    lines.push(`Points: ${metadata.points}`);
  }
  if (metadata.damage !== undefined && metadata.damage > 0) {
    lines.push(`Damage: -${metadata.damage} life`);
  }
  if (metadata.requirements) {
    lines.push(metadata.requirements);
  }

  const tooltipText = lines.join('\n');

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} title={tooltipText}>
      {children}
    </div>
  );
}

export default TileTooltip;
