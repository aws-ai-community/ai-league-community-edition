import { getConfig } from '../config';

export interface MapSummary {
  mapId: string;
  name: string;
  width: number;
  height: number;
  updatedAt: string;
}

export interface MapDocument {
  userId: string;
  mapId: string;
  name: string;
  width: number;
  height: number;
  grid: string[][];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMapRequest {
  name: string;
  width: number;
  height: number;
  grid: string[][];
}

export interface UpdateMapRequest {
  name?: string;
  width?: number;
  height?: number;
  grid?: string[][];
}

export class MapsApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'MapsApiError';
    this.statusCode = statusCode;
  }
}

function getApiBaseUrl(): string {
  const config = getConfig();
  return config?.API.REST.RestApi.endpoint ?? '';
}

export async function listMaps(accessToken: string): Promise<MapSummary[]> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/maps`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to fetch maps' }));
    throw new MapsApiError(
      body.error || `Failed to fetch maps: ${response.status}`,
      response.status
    );
  }

  const data = await response.json();
  return data.maps ?? [];
}

export async function getMap(accessToken: string, mapId: string): Promise<MapDocument> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/maps/${mapId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to fetch map' }));
    throw new MapsApiError(
      body.error || `Failed to fetch map: ${response.status}`,
      response.status
    );
  }

  return response.json();
}

export async function createMap(accessToken: string, data: CreateMapRequest): Promise<MapDocument> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/maps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to create map' }));
    throw new MapsApiError(
      body.error || `Failed to create map: ${response.status}`,
      response.status
    );
  }

  return response.json();
}

export async function updateMap(
  accessToken: string,
  mapId: string,
  data: UpdateMapRequest
): Promise<MapDocument> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/maps/${mapId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to update map' }));
    throw new MapsApiError(
      body.error || `Failed to update map: ${response.status}`,
      response.status
    );
  }

  return response.json();
}

export async function deleteMap(accessToken: string, mapId: string): Promise<void> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/maps/${mapId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to delete map' }));
    throw new MapsApiError(
      body.error || `Failed to delete map: ${response.status}`,
      response.status
    );
  }
}
