import { useMap } from '../../contexts/MapContext';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { TILE_METADATA, TILE_SPRITES, TileKey } from './tileData';

export interface TileOverride {
  points: number;
  damage: number;
}

export default function MapSettings() {
  const {
    startingLives,
    setStartingLives,
    timeLimit,
    setTimeLimit,
    tileOverrides,
    setTileOverride,
  } = useMap();

  return (
    <Container header={<Header variant="h3">Map Settings</Header>}>
      <SpaceBetween size="l">
        <FormField label="Starting Lives">
          <Input
            type="number"
            value={String(startingLives)}
            onChange={({ detail }) => setStartingLives(Number(detail.value))}
          />
        </FormField>

        <FormField label="Time Limit (seconds)">
          <Input
            type="number"
            value={String(timeLimit)}
            onChange={({ detail }) => setTimeLimit(Number(detail.value))}
          />
        </FormField>

        {Object.entries(tileOverrides).map(([tileKey, override]) => {
          const metadata = TILE_METADATA[tileKey as TileKey];
          const sprite = TILE_SPRITES[tileKey as TileKey];
          return (
            <div key={tileKey}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <img src={sprite} alt={metadata.name} width={24} height={24} />
                <span>{metadata.name}</span>
              </div>
              <SpaceBetween size="xs">
                <FormField label="Points">
                  <Input
                    type="number"
                    value={String(override.points)}
                    onChange={({ detail }) =>
                      setTileOverride(tileKey as TileKey, { ...override, points: Number(detail.value) })
                    }
                  />
                </FormField>
                <FormField label="Damage">
                  <Input
                    type="number"
                    value={String(override.damage)}
                    onChange={({ detail }) =>
                      setTileOverride(tileKey as TileKey, { ...override, damage: Number(detail.value) })
                    }
                  />
                </FormField>
              </SpaceBetween>
            </div>
          );
        })}
      </SpaceBetween>
    </Container>
  );
}
