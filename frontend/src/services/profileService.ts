export interface Profile {
  userId: string;
  displayName: string | null;
  avatar: string | null;
}

export class ProfileUpdateError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ProfileUpdateError';
    this.statusCode = statusCode;
  }
}

import { getConfig } from '../config';

function getApiBaseUrl(): string {
  const config = getConfig();
  return config?.API.REST.RestApi.endpoint ?? '';
}

export async function getProfile(accessToken: string): Promise<Profile> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/profile`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to fetch profile' }));
    throw new ProfileUpdateError(
      body.error || `Failed to fetch profile: ${response.status}`,
      response.status
    );
  }

  return response.json();
}

export async function updateProfile(
  accessToken: string,
  data: { displayName?: string; avatar?: string }
): Promise<Profile> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/profile`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Update failed' }));
    throw new ProfileUpdateError(
      body.error || `Failed to update profile: ${response.status}`,
      response.status
    );
  }

  return response.json();
}
