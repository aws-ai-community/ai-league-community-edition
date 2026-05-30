import React from 'react';
import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import { TILE_METADATA, type TileKey } from './tileData';

export interface TileTooltipProps {
  tileKey: TileKey;
  children: React.ReactNode;
}

export function TileTooltip({ tileKey, children }: TileTooltipProps) {
  const metadata = TILE_METADATA[tileKey];

  return (
    <Popover
      triggerType="custom"
      content={
        <SpaceBetween size="xxs">
          <Box fontWeight="bold">{metadata.name}</Box>
          <Box variant="small">{metadata.description}</Box>
          {metadata.points !== undefined && (
            <Box variant="small">Points: {metadata.points}</Box>
          )}
          {metadata.damage !== undefined && (
            <Box variant="small">Damage: -{metadata.damage} life</Box>
          )}
          {metadata.requirements && (
            <Box variant="small">{metadata.requirements}</Box>
          )}
        </SpaceBetween>
      }
    >
      {children}
    </Popover>
  );
}

export default TileTooltip;
