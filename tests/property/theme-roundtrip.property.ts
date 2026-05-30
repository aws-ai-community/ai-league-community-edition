import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

/**
 * Property 2: Theme Preference Round-Trip
 *
 * For any valid theme mode ("light" or "dark"), setting the theme via the Theme Manager
 * SHALL immediately make that mode active AND persist it to local storage such that
 * reading the stored preference returns the same mode that was set.
 *
 * **Validates: Requirements 3.2, 3.3**
 */

// Mock @cloudscape-design/global-styles before importing ThemeProvider
vi.mock('@cloudscape-design/global-styles', () => ({
  applyMode: vi.fn(),
  Mode: {
    Light: 'light',
    Dark: 'dark',
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

import { ThemeProvider, useTheme } from '../../frontend/src/components/ThemeProvider';

const STORAGE_KEY = 'ai-league-theme-preference';

describe('Feature: aws-ai-league-community-edition, Property 2: Theme preference round-trip', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('setting a theme mode persists it to localStorage and makes it the active mode', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random sequences of theme selections
        fc.array(fc.oneof(fc.constant('light' as const), fc.constant('dark' as const)), {
          minLength: 1,
          maxLength: 20,
        }),
        async (themeSequence) => {
          localStorageMock.clear();
          vi.clearAllMocks();

          const wrapper = ({ children }: { children: React.ReactNode }) =>
            React.createElement(ThemeProvider, null, children);

          const { result } = renderHook(() => useTheme(), { wrapper });

          for (const mode of themeSequence) {
            act(() => {
              result.current.setTheme(mode);
            });

            // Verify the context's mode value matches what was set
            expect(result.current.mode).toBe(mode);

            // Verify localStorage was updated with the same mode
            expect(localStorageMock.getItem(STORAGE_KEY)).toBe(mode);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
