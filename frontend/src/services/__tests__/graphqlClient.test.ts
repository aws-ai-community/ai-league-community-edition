import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the settingsLoader module
vi.mock('../settingsLoader', () => ({
  loadSettings: vi.fn(),
}));

import { loadSettings } from '../settingsLoader';
import {
  getMap,
  getGameSession,
  invokeAgentCoreRuntime,
  submitToLeaderboard,
} from '../graphqlClient';

const mockLoadSettings = vi.mocked(loadSettings);

const TEST_SETTINGS = {
  graphql: { endpoint: 'https://test-appsync.amazonaws.com/graphql' },
  graphqlApiKey: 'da2-test-api-key-12345',
};

describe('GraphQL Client', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    mockLoadSettings.mockResolvedValue(TEST_SETTINGS);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  describe('Request formatting', () => {
    it('sends POST request with JSON body to the configured endpoint', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: { GetMap: { mapData: '{}' } },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await getMap('map-123');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        TEST_SETTINGS.graphql.endpoint,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('includes query and variables in the JSON body', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: { GetMap: { mapData: '{}' } },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await getMap('map-456');

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const requestInit = fetchCall[1] as RequestInit;
      const body = JSON.parse(requestInit.body as string);

      expect(body).toHaveProperty('query');
      expect(body).toHaveProperty('variables');
      expect(body.variables).toEqual({ mapId: 'map-456' });
    });

    it('sends correct variables for invokeAgentCoreRuntime', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: {
            InvokeAgentCoreRuntime: {
              sessionId: 'session-1',
              status: 'in_progress',
              message: null,
            },
          },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await invokeAgentCoreRuntime({
        mapId: 'map-1',
        navigationPath: '[[0,0],[0,1]]',
        customModelCount: 2,
      });

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const requestInit = fetchCall[1] as RequestInit;
      const body = JSON.parse(requestInit.body as string);

      expect(body.variables).toEqual({
        mapId: 'map-1',
        navigationPath: '[[0,0],[0,1]]',
        customModelCount: 2,
      });
    });
  });

  describe('x-api-key header inclusion', () => {
    it('includes x-api-key header with the API key from settings', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: { GetMap: { mapData: '{}' } },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await getMap('map-123');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'da2-test-api-key-12345',
          }),
        }),
      );
    });

    it('uses the API key from loaded settings, not a hardcoded value', async () => {
      const customSettings = {
        graphql: { endpoint: 'https://custom.appsync.com/graphql' },
        graphqlApiKey: 'da2-custom-key-99999',
      };
      mockLoadSettings.mockResolvedValue(customSettings);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: { SubmitToLeaderboard: { success: true, statusCode: 200, message: null } },
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await submitToLeaderboard('lb-1', 'session-1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://custom.appsync.com/graphql',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'da2-custom-key-99999',
          }),
        }),
      );
    });
  });

  describe('GraphQL error extraction', () => {
    it('throws the first error message when GraphQL errors are returned', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          errors: [
            { message: 'Map not found' },
            { message: 'Secondary error' },
          ],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(getMap('nonexistent')).rejects.toThrow('Map not found');
    });

    it('throws the first error message even when data is also present', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: { GetMap: null },
          errors: [{ message: 'Unauthorized access' }],
        }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(getMap('map-1')).rejects.toThrow('Unauthorized access');
    });
  });

  describe('Network error handling', () => {
    it('throws descriptive error with failure reason on network failure', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Failed to fetch'));

      await expect(getGameSession('session-1')).rejects.toThrow(
        'GraphQL request failed: Failed to fetch',
      );
    });

    it('includes the underlying error message in the thrown error', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

      await expect(getMap('map-1')).rejects.toThrow('net::ERR_CONNECTION_REFUSED');
    });

    it('handles non-Error rejection values gracefully', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue('network timeout');

      await expect(getMap('map-1')).rejects.toThrow('GraphQL request failed: network timeout');
    });
  });

  describe('Settings loading failure', () => {
    it('throws configuration missing error when settings.json cannot be loaded', async () => {
      mockLoadSettings.mockRejectedValue(
        new Error('Configuration missing: settings.json not found'),
      );

      await expect(getMap('map-1')).rejects.toThrow(
        'Configuration missing: settings.json not found',
      );
    });

    it('propagates the settings loader error without wrapping', async () => {
      mockLoadSettings.mockRejectedValue(
        new Error('Configuration invalid: settings.json is malformed'),
      );

      await expect(getGameSession('session-1')).rejects.toThrow(
        'Configuration invalid: settings.json is malformed',
      );
    });
  });
});
