import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';

// Mock applyMode from @cloudscape-design/global-styles
const mockApplyMode = vi.hoisted(() => vi.fn());

vi.mock('@cloudscape-design/global-styles', () => ({
  applyMode: mockApplyMode,
  Mode: {
    Light: 'light',
    Dark: 'dark',
  },
}));

// Mock localStorage
const localStorageMock = vi.hoisted(() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get _store() { return store; },
    set _store(s: Record<string, string>) { store = s; },
  };
});

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// We need to reset modules before each test to get a fresh ThemeProvider
// because the module caches initialMode on load
beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock._store = {};
  vi.resetModules();
});

async function importThemeProvider() {
  const mod = await import('../../frontend/src/components/ThemeProvider');
  return mod;
}

function createWrapper(ThemeProvider: (props: { children: ReactNode }) => ReactNode) {
  return ({ children }: { children: ReactNode }) =>
    createElement(ThemeProvider, null, children);
}

describe('ThemeProvider', () => {
  it('defaults to dark mode when no local storage value', async () => {
    const { ThemeProvider, useTheme } = await importThemeProvider();
    const wrapper = createWrapper(ThemeProvider);

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBe('dark');
  });

  it('reads and applies stored preference on mount', async () => {
    localStorageMock._store = { 'ai-league-theme-preference': 'dark' };

    const { ThemeProvider, useTheme } = await importThemeProvider();
    const wrapper = createWrapper(ThemeProvider);

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.mode).toBe('dark');
    // applyMode should have been called with 'dark' mode
    expect(mockApplyMode).toHaveBeenCalledWith('dark');
  });

  it('toggleTheme switches from light to dark and vice versa', async () => {
    const { ThemeProvider, useTheme } = await importThemeProvider();
    const wrapper = createWrapper(ThemeProvider);

    const { result } = renderHook(() => useTheme(), { wrapper });

    // Starts at dark (default)
    expect(result.current.mode).toBe('dark');

    // Toggle to light
    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.mode).toBe('light');

    // Toggle back to dark
    act(() => {
      result.current.toggleTheme();
    });
    expect(result.current.mode).toBe('dark');
  });

  it('persists preference to local storage on change', async () => {
    const { ThemeProvider, useTheme } = await importThemeProvider();
    const wrapper = createWrapper(ThemeProvider);

    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme('dark');
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ai-league-theme-preference',
      'dark'
    );

    act(() => {
      result.current.setTheme('light');
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ai-league-theme-preference',
      'light'
    );
  });

  it('calls applyMode with correct mode value', async () => {
    const { ThemeProvider, useTheme } = await importThemeProvider();
    const wrapper = createWrapper(ThemeProvider);

    const { result } = renderHook(() => useTheme(), { wrapper });

    mockApplyMode.mockClear();

    act(() => {
      result.current.setTheme('dark');
    });

    expect(mockApplyMode).toHaveBeenCalledWith('dark');

    mockApplyMode.mockClear();

    act(() => {
      result.current.setTheme('light');
    });

    expect(mockApplyMode).toHaveBeenCalledWith('light');
  });
});
