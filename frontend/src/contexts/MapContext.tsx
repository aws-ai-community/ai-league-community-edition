import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import { TileKey } from '../components/map-builder/tileData';
import { createGrid, placeTile as placeTileUtil, resetCell as resetCellUtil, resizeGrid } from '../components/map-builder/gridUtils';
import { validateMap, type ValidationResult } from '../components/map-builder/validation';
import { exportGrid } from '../components/map-builder/exportUtils';
import {
  listMaps,
  getMap,
  createMap,
  updateMap,
  deleteMap as deleteMapApi,
  type MapSummary,
} from '../services/mapsApi';

const DEFAULT_WIDTH = 5;
const DEFAULT_HEIGHT = 5;

export interface MapContextValue {
  // Grid state
  grid: TileKey[][];
  width: number;
  height: number;
  setDimensions: (width: number, height: number) => void;
  placeTile: (row: number, col: number, tileKey: TileKey) => void;
  resetCell: (row: number, col: number) => void;

  // Palette state
  selectedTile: TileKey | null;
  selectTile: (tileKey: TileKey) => void;

  // Persistence
  maps: MapSummary[];
  isLoading: boolean;
  isDirty: boolean;
  saveMap: (name: string) => Promise<void>;
  loadMap: (mapId: string) => Promise<void>;
  deleteMap: (mapId: string) => Promise<void>;
  newMap: () => void;
  currentMapId: string | null;
  currentMapName: string | null;

  // Validation
  validate: () => ValidationResult;

  // Export
  exportToClipboard: () => Promise<void>;

  // Notifications
  error: string | null;
  success: string | null;
  clearNotifications: () => void;
}

const MapContext = createContext<MapContextValue | undefined>(undefined);

interface MapProviderProps {
  children: ReactNode;
}

export function MapProvider({ children }: MapProviderProps) {
  const { isAuthenticated, getAccessToken } = useAuth();

  // Grid state
  const [grid, setGrid] = useState<TileKey[][]>(() => createGrid(DEFAULT_WIDTH, DEFAULT_HEIGHT));
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  // Palette state
  const [selectedTile, setSelectedTile] = useState<TileKey | null>(null);

  // Persistence state
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [currentMapName, setCurrentMapName] = useState<string | null>(null);

  // Notification state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load user's maps list on mount when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      setMaps([]);
      return;
    }

    let cancelled = false;

    async function loadMaps() {
      try {
        setIsLoading(true);
        const token = await getAccessToken();
        const mapsList = await listMaps(token);
        if (!cancelled) {
          setMaps(mapsList);
        }
      } catch {
        // Maps may not exist yet, silently ignore
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadMaps();
    return () => { cancelled = true; };
  }, [isAuthenticated, getAccessToken]);

  // Grid manipulation
  const setDimensions = useCallback((newWidth: number, newHeight: number) => {
    setWidth(newWidth);
    setHeight(newHeight);
    setGrid((prev) => resizeGrid(prev, newWidth, newHeight));
    setIsDirty(true);
  }, []);

  const placeTile = useCallback((row: number, col: number, tileKey: TileKey) => {
    setGrid((prev) => placeTileUtil(prev, row, col, tileKey));
    setIsDirty(true);
  }, []);

  const resetCell = useCallback((row: number, col: number) => {
    setGrid((prev) => resetCellUtil(prev, row, col));
    setIsDirty(true);
  }, []);

  // Palette
  const selectTile = useCallback((tileKey: TileKey) => {
    setSelectedTile(tileKey);
  }, []);

  // Notifications
  const clearNotifications = useCallback(() => {
    setError(null);
    setSuccess(null);
  }, []);

  // Validation
  const validate = useCallback((): ValidationResult => {
    return validateMap(grid);
  }, [grid]);

  // Save map: validate → call createMap or updateMap
  const saveMap = useCallback(async (name: string) => {
    setError(null);
    setSuccess(null);

    // Validate before saving
    const result = validateMap(grid);
    if (!result.valid) {
      setError(result.errors.join('. '));
      return;
    }

    try {
      setIsLoading(true);
      const token = await getAccessToken();

      if (currentMapId) {
        // Update existing map
        await updateMap(token, currentMapId, { name, width, height, grid });
        setCurrentMapName(name);
        setIsDirty(false);
        setSuccess('Map saved successfully');
      } else {
        // Create new map
        const created = await createMap(token, { name, width, height, grid });
        setCurrentMapId(created.mapId);
        setCurrentMapName(name);
        setIsDirty(false);
        setSuccess('Map created successfully');
      }

      // Refresh maps list
      const mapsList = await listMaps(token);
      setMaps(mapsList);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save map';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [grid, width, height, currentMapId, getAccessToken]);

  // Load map: call getMap → restore grid/dimensions
  const loadMap = useCallback(async (mapId: string) => {
    setError(null);
    setSuccess(null);

    try {
      setIsLoading(true);
      const token = await getAccessToken();
      const mapDoc = await getMap(token, mapId);

      setWidth(mapDoc.width);
      setHeight(mapDoc.height);
      setGrid(mapDoc.grid as TileKey[][]);
      setCurrentMapId(mapDoc.mapId);
      setCurrentMapName(mapDoc.name);
      setIsDirty(false);
      setSuccess(`Loaded map "${mapDoc.name}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load map';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  // Delete map: call deleteMap → remove from local list
  const deleteMapHandler = useCallback(async (mapId: string) => {
    setError(null);
    setSuccess(null);

    try {
      setIsLoading(true);
      const token = await getAccessToken();
      await deleteMapApi(token, mapId);

      setMaps((prev) => prev.filter((m) => m.mapId !== mapId));

      // If we deleted the currently loaded map, reset state
      if (mapId === currentMapId) {
        setCurrentMapId(null);
        setCurrentMapName(null);
        setGrid(createGrid(width, height));
      }

      setSuccess('Map deleted successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete map';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, currentMapId, width, height]);

  // New map: reset grid and clear current map reference
  const newMap = useCallback(() => {
    setGrid(createGrid(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    setWidth(DEFAULT_WIDTH);
    setHeight(DEFAULT_HEIGHT);
    setCurrentMapId(null);
    setCurrentMapName(null);
    setIsDirty(false);
    setSelectedTile(null);
    setError(null);
    setSuccess(null);
  }, []);

  // Export to clipboard
  const exportToClipboard = useCallback(async () => {
    setError(null);
    setSuccess(null);

    try {
      const json = exportGrid(grid);
      await navigator.clipboard.writeText(json);
      setSuccess('Map copied to clipboard');
    } catch {
      setError('Failed to copy to clipboard. Please try again.');
    }
  }, [grid]);

  const value: MapContextValue = {
    grid,
    width,
    height,
    setDimensions,
    placeTile,
    resetCell,
    selectedTile,
    selectTile,
    maps,
    isLoading,
    isDirty,
    saveMap,
    loadMap,
    deleteMap: deleteMapHandler,
    newMap,
    currentMapId,
    currentMapName,
    validate,
    exportToClipboard,
    error,
    success,
    clearNotifications,
  };

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMap(): MapContextValue {
  const context = useContext(MapContext);
  if (context === undefined) {
    throw new Error('useMap must be used within a MapProvider');
  }
  return context;
}
