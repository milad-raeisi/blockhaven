import type { Appearance, WorldSummary } from '@/network/protocol/messages';

export interface PlayerProfile {
  id: string;
  displayName: string;
  appearance: Appearance;
}

export interface ServerInfo {
  name: string;
  version: string;
  lanUrls: string[];
  playersOnline: number;
  worldsLoaded: number;
}

export interface CreateWorldInput {
  name: string;
  seed: string;
  gameMode: 'creative' | 'survival' | 'spectator';
  visibility: 'public' | 'unlisted' | 'private';
  maxPlayers: number;
  password: string;
  terrainType: 'default' | 'flat' | 'mountains';
  dayNightCycle: boolean;
  weatherEnabled: boolean;
  buildPermission: 'everyone' | 'members' | 'owner';
  includeShowcase: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Cannot reach the game server. Is it still running?', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  getSession: () => request<{ player: PlayerProfile | null }>('/api/session'),
  createSession: (displayName: string, appearance?: Partial<Appearance>) =>
    request<{ player: PlayerProfile }>('/api/session', { method: 'POST', body: JSON.stringify({ displayName, appearance }) }),
  logout: () => request<{ ok: boolean }>('/api/session', { method: 'DELETE' }),
  updateProfile: (patch: { displayName?: string; appearance?: Partial<Appearance> }) =>
    request<{ player: PlayerProfile }>('/api/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
  listWorlds: () => request<{ worlds: WorldSummary[] }>('/api/worlds'),
  getWorld: (id: string) => request<{ world: WorldSummary }>(`/api/worlds/${encodeURIComponent(id)}`),
  createWorld: (input: CreateWorldInput) => request<{ world: WorldSummary }>('/api/worlds', { method: 'POST', body: JSON.stringify(input) }),
  deleteWorld: (id: string) => request<{ ok: boolean }>(`/api/worlds/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  serverInfo: () => request<ServerInfo>('/api/server-info'),
};

/** World passwords are handed from the lobby to the game page without putting them in the URL. */
export function storeWorldPassword(worldId: string, password: string): void {
  sessionStorage.setItem(`blockhaven-pw:${worldId}`, password);
}

export function takeWorldPassword(worldId: string): string | undefined {
  return sessionStorage.getItem(`blockhaven-pw:${worldId}`) ?? undefined;
}
