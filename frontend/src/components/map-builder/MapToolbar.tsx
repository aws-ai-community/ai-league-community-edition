import { useState } from 'react';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import { useMap } from '../../contexts/MapContext';

const DIMENSION_OPTIONS: SelectProps.Option[] = Array.from({ length: 11 }, (_, i) => ({
  label: String(i + 2),
  value: String(i + 2),
}));

export default function MapToolbar() {
  const {
    width,
    height,
    setDimensions,
    maps,
    isLoading,
    isDirty,
    saveMap,
    loadMap,
    deleteMap,
    newMap,
    exportToClipboard,
    currentMapId,
    currentMapName,
  } = useMap();

  // Modal states
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showNewMapModal, setShowNewMapModal] = useState(false);
  const [mapName, setMapName] = useState('');
  const [saveError, setSaveError] = useState('');

  const handleWidthChange: SelectProps['onChange'] = ({ detail }) => {
    const newWidth = Number(detail.selectedOption.value);
    setDimensions(newWidth, height);
  };

  const handleHeightChange: SelectProps['onChange'] = ({ detail }) => {
    const newHeight = Number(detail.selectedOption.value);
    setDimensions(width, newHeight);
  };

  const handleSaveClick = () => {
    if (currentMapId && currentMapName) {
      // Already has a name, save directly
      saveMap(currentMapName);
    } else {
      // Prompt for name
      setMapName('');
      setSaveError('');
      setShowSaveModal(true);
    }
  };

  const handleSaveConfirm = () => {
    const trimmed = mapName.trim();
    if (!trimmed) {
      setSaveError('Map name is required');
      return;
    }
    if (trimmed.length > 100) {
      setSaveError('Map name must be 100 characters or less');
      return;
    }
    setShowSaveModal(false);
    saveMap(trimmed);
  };

  const handleLoadClick = () => {
    setShowLoadModal(true);
  };

  const handleLoadSelect = (mapId: string) => {
    setShowLoadModal(false);
    loadMap(mapId);
  };

  const handleDeleteClick = () => {
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    if (currentMapId) {
      setShowDeleteModal(false);
      deleteMap(currentMapId);
    }
  };

  const handleExportClick = () => {
    exportToClipboard();
  };

  const handleNewMapClick = () => {
    if (isDirty) {
      setShowNewMapModal(true);
    } else {
      newMap();
    }
  };

  const handleNewMapConfirm = () => {
    setShowNewMapModal(false);
    newMap();
  };

  return (
    <>
      <Header
        variant="h1"
        description={currentMapName ? `Editing: ${currentMapName}` : 'Create a new map'}
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <FormField label="Width">
              <Select
                selectedOption={{ label: String(width), value: String(width) }}
                options={DIMENSION_OPTIONS}
                onChange={handleWidthChange}
                ariaLabel="Grid width"
              />
            </FormField>
            <FormField label="Height">
              <Select
                selectedOption={{ label: String(height), value: String(height) }}
                options={DIMENSION_OPTIONS}
                onChange={handleHeightChange}
                ariaLabel="Grid height"
              />
            </FormField>
            <Button onClick={handleNewMapClick} iconName="add-plus">
              New Map
            </Button>
            <Button onClick={handleSaveClick} loading={isLoading} iconName="upload">
              Save
            </Button>
            <Button onClick={handleLoadClick} loading={isLoading} iconName="download">
              Load
            </Button>
            <Button
              onClick={handleDeleteClick}
              disabled={!currentMapId || isLoading}
              iconName="remove"
            >
              Delete
            </Button>
            <Button onClick={handleExportClick} iconName="copy">
              Copy to Clipboard
            </Button>
          </SpaceBetween>
        }
      >
        Map Builder
      </Header>

      {/* Save Modal - prompt for map name */}
      <Modal
        visible={showSaveModal}
        onDismiss={() => setShowSaveModal(false)}
        header="Save Map"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowSaveModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveConfirm}>
                Save
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField label="Map name" errorText={saveError}>
          <Input
            value={mapName}
            onChange={({ detail }) => {
              setMapName(detail.value);
              setSaveError('');
            }}
            placeholder="Enter a name for your map"
            ariaLabel="Map name"
          />
        </FormField>
      </Modal>

      {/* Load Modal - list of saved maps */}
      <Modal
        visible={showLoadModal}
        onDismiss={() => setShowLoadModal(false)}
        header="Load Map"
        footer={
          <Box float="right">
            <Button variant="link" onClick={() => setShowLoadModal(false)}>
              Cancel
            </Button>
          </Box>
        }
      >
        {maps.length === 0 ? (
          <Box textAlign="center" color="text-body-secondary" padding="l">
            No saved maps found.
          </Box>
        ) : (
          <SpaceBetween size="xs">
            {maps.map((map) => (
              <Button
                key={map.mapId}
                variant="link"
                onClick={() => handleLoadSelect(map.mapId)}
              >
                {map.name} ({map.width}×{map.height}) — {new Date(map.updatedAt).toLocaleDateString()}
              </Button>
            ))}
          </SpaceBetween>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        onDismiss={() => setShowDeleteModal(false)}
        header="Delete Map"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleDeleteConfirm}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box>
          Are you sure you want to delete{' '}
          <strong>{currentMapName || 'this map'}</strong>? This action cannot be undone.
        </Box>
      </Modal>

      {/* New Map Confirmation Modal */}
      <Modal
        visible={showNewMapModal}
        onDismiss={() => setShowNewMapModal(false)}
        header="New Map"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowNewMapModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleNewMapConfirm}>
                Discard & Create New
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box>
          You have unsaved changes. Creating a new map will discard your current work. Are you sure?
        </Box>
      </Modal>
    </>
  );
}
