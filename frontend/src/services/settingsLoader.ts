export interface AppSyncSettings {
  graphql: {
    endpoint: string;
  };
  graphqlApiKey: string;
}

let cachedSettings: AppSyncSettings | null = null;

function isValidSettings(data: unknown): data is AppSyncSettings {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.graphql !== 'object' || obj.graphql === null) return false;
  const graphql = obj.graphql as Record<string, unknown>;
  if (typeof graphql.endpoint !== 'string' || graphql.endpoint.length === 0) return false;
  if (typeof obj.graphqlApiKey !== 'string' || obj.graphqlApiKey.length === 0) return false;
  return true;
}

export async function loadSettings(): Promise<AppSyncSettings> {
  if (cachedSettings) {
    return cachedSettings;
  }

  let response: Response;
  try {
    response = await fetch('/settings.json');
  } catch {
    throw new Error('Configuration missing: settings.json not found');
  }

  if (!response.ok) {
    throw new Error('Configuration missing: settings.json not found');
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Configuration invalid: settings.json is malformed');
  }

  if (!isValidSettings(data)) {
    throw new Error('Configuration invalid: settings.json is malformed');
  }

  cachedSettings = data;
  return cachedSettings;
}

/**
 * Reset the cached settings. Useful for testing.
 */
export function resetSettingsCache(): void {
  cachedSettings = null;
}
