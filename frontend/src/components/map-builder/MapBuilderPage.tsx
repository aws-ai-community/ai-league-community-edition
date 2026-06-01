import Alert from '@cloudscape-design/components/alert';
import Flashbar, { FlashbarProps } from '@cloudscape-design/components/flashbar';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { MapProvider, useMap } from '../../contexts/MapContext';
import MapToolbar from './MapToolbar';
import { TilePalette } from './TilePalette';
import { MapGrid } from './MapGrid';
import MapSettings from './MapSettings';
import ChallengeEditor from './ChallengeEditor';

function MapBuilderContent() {
  const {
    grid,
    selectedTile,
    selectTile,
    placeTile,
    resetCell,
    validate,
    error,
    success,
    clearNotifications,
    challenges,
    setChallenges,
  } = useMap();

  const validationResult = validate();

  const handleCellClick = (row: number, col: number) => {
    if (selectedTile) {
      placeTile(row, col, selectedTile);
    }
  };

  const handleCellRightClick = (row: number, col: number) => {
    resetCell(row, col);
  };

  const flashbarItems: FlashbarProps.MessageDefinition[] = [];

  if (error) {
    flashbarItems.push({
      type: 'error',
      content: error,
      dismissible: true,
      onDismiss: clearNotifications,
      id: 'error-notification',
    });
  }

  if (success) {
    flashbarItems.push({
      type: 'success',
      content: success,
      dismissible: true,
      onDismiss: clearNotifications,
      id: 'success-notification',
    });
  }

  return (
    <SpaceBetween size="l">
      <MapToolbar />

      {flashbarItems.length > 0 && <Flashbar items={flashbarItems} />}

      {!validationResult.valid && (
        <Alert type="warning" header="Validation issues">
          {validationResult.errors.join('. ')}
        </Alert>
      )}

      <div
        style={{
          display: 'flex',
          gap: '24px',
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            width: '250px',
            flexShrink: 0,
            maxHeight: 'calc(100vh - 300px)',
            overflowY: 'auto',
          }}
        >
          <TilePalette selectedTile={selectedTile} onTileSelect={selectTile} />
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <MapGrid
            grid={grid}
            onCellDrop={placeTile}
            onCellClick={handleCellClick}
            onCellRightClick={handleCellRightClick}
          />
        </div>

        <div
          style={{
            width: '280px',
            flexShrink: 0,
            maxHeight: 'calc(100vh - 300px)',
            overflowY: 'auto',
          }}
        >
          <SpaceBetween size="m">
            <MapSettings />
            <ChallengeEditor
              challenges={challenges}
              onChallengesChange={setChallenges}
              grid={grid}
            />
          </SpaceBetween>
        </div>
      </div>
    </SpaceBetween>
  );
}

export default function MapBuilderPage() {
  return (
    <MapProvider>
      <MapBuilderContent />
    </MapProvider>
  );
}
