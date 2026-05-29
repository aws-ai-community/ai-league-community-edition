import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { applyMode, Mode } from '@cloudscape-design/global-styles';

const STORAGE_KEY = 'ai-league-theme-preference';

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (e.g. private browsing in some browsers)
  }
  return 'dark';
}

function persistTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

function applyThemeMode(mode: ThemeMode): void {
  applyMode(mode === 'dark' ? Mode.Dark : Mode.Light);
}

// Apply theme immediately on module load to prevent flash of wrong theme
const initialMode = getStoredTheme();
applyThemeMode(initialMode);

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  useEffect(() => {
    // Re-apply on mount in case the module-level apply ran before DOM was ready
    applyThemeMode(mode);
  }, []);

  const setTheme = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    applyThemeMode(newMode);
    persistTheme(newMode);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(mode === 'light' ? 'dark' : 'light');
  }, [mode, setTheme]);

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
