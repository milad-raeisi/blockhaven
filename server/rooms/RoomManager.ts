import type { ClientMessageOf, WorldSummary } from '../../src/network/protocol/messages';
import type { ServerConfig } from '../lib/config';
import type { Logger } from '../lib/logger';
import type { WorldRepository, WorldWithSettings } from '../persistence/worldRepository';
import { verifyPassword } from '../security/passwords';
import type { ClientConnection } from '../websocket/connection';
import { WorldRoom } from './WorldRoom';

export interface RoomManagerDeps {
  repo: WorldRepository;
  config: ServerConfig;
  log: Logger;
}

export type JoinError = { code: 'world_not_found' | 'world_full' | 'wrong_password' | 'server_error'; message: string };

/** Loads worlds on demand, tracks the lobby, and unloads idle worlds. */
export class RoomManager {
  private readonly rooms = new Map<string, WorldRoom>();
  private readonly loading = new Map<string, Promise<WorldRoom>>();
  private readonly lobby = new Set<ClientConnection>();
  private lobbyTimer: NodeJS.Timeout | null = null;
  private readonly maintenance: NodeJS.Timeout;
  private readonly log: Logger;

  constructor(private readonly deps: RoomManagerDeps) {
    this.log = deps.log.child('rooms');
    this.maintenance = setInterval(() => void this.unloadIdleRooms(), 5000);
  }

  get loadedRooms(): WorldRoom[] {
    return [...this.rooms.values()];
  }

  playerCount(worldId: string): number {
    return this.rooms.get(worldId)?.players.size ?? 0;
  }

  get totalPlayers(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.players.size;
    return n;
  }

  private async getOrLoad(record: WorldWithSettings): Promise<WorldRoom> {
    const existing = this.rooms.get(record.id);
    if (existing && !existing.isClosed) return existing;
    let pending = this.loading.get(record.id);
    if (!pending) {
      pending = WorldRoom.load(record, {
        repo: this.deps.repo,
        config: this.deps.config,
        log: this.deps.log,
        onPlayersChanged: () => this.notifyLobby(),
      });
      this.loading.set(record.id, pending);
      pending
        .then((room) => {
          this.rooms.set(room.id, room);
          this.log.info('World loaded', { world: record.name });
        })
        .catch(() => undefined)
        .finally(() => this.loading.delete(record.id));
    }
    return pending;
  }

  async join(conn: ClientConnection, msg: ClientMessageOf<'world:join'>): Promise<{ ok: true; room: WorldRoom } | { ok: false; error: JoinError }> {
    const record = await this.deps.repo.getWorld(msg.worldId);
    const isOwner = record?.ownerId === conn.account.id;
    if (!record || (record.visibility === 'PRIVATE' && !isOwner)) {
      return { ok: false, error: { code: 'world_not_found', message: 'That world does not exist or is private.' } };
    }
    if (record.passwordHash && !isOwner) {
      if (!msg.password || !(await verifyPassword(msg.password, record.passwordHash))) {
        return { ok: false, error: { code: 'wrong_password', message: 'Incorrect world password.' } };
      }
    }
    let room: WorldRoom;
    try {
      room = await this.getOrLoad(record);
    } catch (error) {
      this.log.error('Failed to load world', { world: record.id, error: error as Error });
      return { ok: false, error: { code: 'server_error', message: 'The world could not be loaded.' } };
    }
    // The same account joining again (another tab or a reconnect) replaces the old session.
    const previous = room.players.get(conn.account.id);
    if (previous && previous.conn !== conn) {
      previous.conn.send({ type: 'world:left', worldId: room.id, reason: 'You joined this world from another window.' });
      room.removePlayer(previous.id, 'replaced');
    }
    if (room.players.size >= room.info.maxPlayers) {
      return { ok: false, error: { code: 'world_full', message: `This world is full (${room.info.maxPlayers} players).` } };
    }
    const player = await room.addPlayer(conn, Math.min(msg.renderDistance, this.deps.config.MAX_RENDER_DISTANCE));
    conn.room = room;
    conn.player = player;
    return { ok: true, room };
  }

  leave(conn: ClientConnection, reason: string): void {
    if (conn.room && conn.player) conn.room.removePlayer(conn.player.id, reason);
    conn.room = null;
    conn.player = null;
  }

  // --- Lobby ---------------------------------------------------------------------

  subscribeLobby(conn: ClientConnection): void {
    this.lobby.add(conn);
    conn.lobbySubscribed = true;
    void this.sendLobby(conn);
  }

  unsubscribeLobby(conn: ClientConnection): void {
    this.lobby.delete(conn);
    conn.lobbySubscribed = false;
  }

  /** Debounced push of the world list to every lobby subscriber. */
  notifyLobby(): void {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      for (const conn of this.lobby) void this.sendLobby(conn);
    }, 250);
  }

  private async sendLobby(conn: ClientConnection): Promise<void> {
    try {
      const worlds = await this.listWorlds(conn.account.id);
      conn.send({ type: 'lobby:worlds', worlds });
    } catch (error) {
      this.log.error('Failed to list worlds', { error: error as Error });
    }
  }

  async listWorlds(playerId: string): Promise<WorldSummary[]> {
    const records = await this.deps.repo.listWorldsForPlayer(playerId);
    return records.map((w) => this.summarize(w, playerId));
  }

  summarize(w: WorldWithSettings, playerId: string): WorldSummary {
    return {
      id: w.id,
      name: w.name,
      gameMode: w.gameMode.toLowerCase() as WorldSummary['gameMode'],
      visibility: w.visibility.toLowerCase() as WorldSummary['visibility'],
      hasPassword: !!w.passwordHash,
      playerCount: this.playerCount(w.id),
      maxPlayers: w.maxPlayers,
      ownerName: w.owner.displayName,
      isOwner: w.ownerId === playerId,
      terrainType: w.settings?.terrainType ?? 'default',
      lastPlayedAt: w.lastPlayedAt?.toISOString() ?? null,
    };
  }

  // --- Lifecycle ------------------------------------------------------------------

  async unloadWorld(worldId: string, reason: string): Promise<void> {
    const room = this.rooms.get(worldId);
    if (!room) return;
    this.rooms.delete(worldId);
    await room.close(reason);
    this.notifyLobby();
  }

  private async unloadIdleRooms(): Promise<void> {
    const idleMs = this.deps.config.ROOM_IDLE_UNLOAD_SECONDS * 1000;
    for (const room of this.rooms.values()) {
      if (room.players.size === 0 && room.emptySince !== null && Date.now() - room.emptySince >= idleMs) {
        this.log.info('Unloading idle world', { world: room.info.name });
        await this.unloadWorld(room.id, 'World unloaded');
      }
    }
  }

  async saveAll(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((room) => room.save()));
  }

  async shutdown(reason: string): Promise<void> {
    clearInterval(this.maintenance);
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    await Promise.allSettled([...this.loading.values()]);
    await Promise.all([...this.rooms.values()].map((room) => room.close(reason)));
    this.rooms.clear();
  }
}
