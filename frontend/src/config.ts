/**
 * Runtime configuration loaded from /aws-exports.json deployed by CDK.
 * This allows the frontend to discover backend resource IDs without
 * needing them baked in at build time.
 */

export interface AppConfig {
  region: string;
  Auth: {
    Cognito: {
      userPoolClientId: string;
      userPoolId: string;
    };
  };
  API: {
    REST: {
      RestApi: {
        endpoint: string;
      };
    };
  };
}

let cachedConfig: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig;
  const response = await fetch('/aws-exports.json');
  if (!response.ok) throw new Error('Failed to load configuration');
  cachedConfig = await response.json();
  return cachedConfig!;
}

export function getConfig(): AppConfig | null {
  return cachedConfig;
}
