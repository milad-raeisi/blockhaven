import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import type { GameMode } from '@prisma/client';
import { B } from '../../src/game/blocks/ids';
import { getFacing, getVariant, isActive, makeMeta, withActive } from '../../src/game/blocks/meta';
import { computePlacementMeta } from '../../src/game/blocks/placement';
import { getBlock, getBreakTime } from '../../src/game/blocks/registry';
import { needsSupport } from '../../src/game/blocks/shapes';
import { bytesToBase64, encodeDelta } from '../../src/game/chunks/delta';
import { addItem, CHEST_SIZE, createSlots, removeFromSlot, type Slot } from '../../src/game/inventory/inventory';
import { blockIntersectsPlayer, eyeHeight, playerCollides, stepPlayer, type GameModeName } from '../../src/game/physics/player';
import type { TerrainType } from '../../src/game/terrain/generator';
import { UNLOADED } from '../../src/game/world/blockAccess';
import {
  CHUNK_SIZE,
  DAY_LENGTH_TICKS,
  FACE_DIRS,
  PHYSICS_DT,
  PHYSICS_RATE,
  SERVER_INTERACTION_DISTANCE,
  WORLD_HEIGHT,
  WORLD_TICKS_PER_SECOND,
  type FaceId,
} from '../../src/game/world/constants';
import { blockKey, chunkKey, toChunkCoord } from '../../src/game/world/coords';
import {
  MAX_CHAT_LENGTH,
  type BlockChangeWire,
  type ClientMessage,
  type ClientMessageOf,
  type ServerMessage,
  type WeatherWire,
  type WorldInfo,
} from '../../src/network/protocol/messages';
import type { ServerConfig } from '../lib/config';
import type { Logger } from '../lib/logger';
import type { LoadedPlayerState, PlayerStateSave, WorldRepository, WorldWithSettings } from '../persistence/worldRepository';
import { InventoryService } from '../players/inventoryService';
import { MAX_INPUT_TOKENS, MAX_QUEUED_INPUTS, ServerPlayer } from '../players/ServerPlayer';
import { sanitizeChat } from '../security/sanitize';
import { BUTTON_PULSE_TICKS, CircuitSimulator, type CircuitWorld } from '../simulation/circuits';
import type { ClientConnection } from '../websocket/connection';
import { ServerWorld } from '../world/ServerWorld';
import { buildShowcase, SHOWCASE_BOUNDS } from '../world/showcase';
import { runCommand } from './commands';

/** Chunk radius around each player that is fully simulated on the server. */
const SIM_RADIUS = 2;
const CHAT_HISTORY = 30;
const PLATE_RELEASE_TICKS = 10;
const TIME_BROADCAST_TICKS = 100;
const CHUNK_DEFLATE_THRESHOLD = 512;

type Cause = 'player' | 'circuit';

interface ContainerState {
  x: number;
  y: number;
  z: number;
  slots: Slot[];
  dirty: boolean;
  removed: boolean;
}

const GAME_MODE_TO_DB: Record<GameModeName, GameMode> = { creative: 'CREATIVE', survival: 'SURVIVAL', spectator: 'SPECTATOR' };
const GAME_MODE_FROM_DB: Record<GameMode, GameModeName> = { CREATIVE: 'creative', SURVIVAL: 'survival', SPECTATOR: 'spectator' };

export interface RoomDeps {
  repo: WorldRepository;
  config: ServerConfig;
  log: Logger;
  onPlayersChanged: (room: WorldRoom) => void;
}

/**
 * One loaded world: authoritative voxel state, players, circuits and the
 * fixed-rate simulation loop. All world mutations go through this class.
 */
export class WorldRoom {
  readonly id: string;
  readonly world: ServerWorld;
  readonly circuits: CircuitSimulator;
  readonly players = new Map<string, ServerPlayer>();
  readonly inventories: InventoryService;
  info: WorldInfo;
  passwordHash: string | null;
  visibility: WorldWithSettings['visibility'];
  spawn = { x: 0.5, y: 80, z: 0.5 };
  tick = 0;
  worldTime: number;
  weather: WeatherWire;
  emptySince: number | null = Date.now();
  private nextWeatherChange = 0;
  private readonly pendingPlayerChanges: BlockChangeWire[] = [];
  private readonly pendingCircuitChanges: BlockChangeWire[] = [];
  private readonly containers = new Map<string, ContainerState>();
  private readonly activePlates = new Map<string, number>();
  private readonly chatHistory: Extract<ServerMessage, { type: 'chat:message' }>[] = [];
  private readonly simLoading = new Set<string>();
  /** In-flight saves of players who just left, awaited if they rejoin quickly. */
  private readonly pendingPlayerSaves = new Map<string, Promise<void>>();
  private tickTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> | null = null;
  private closed = false;
  private readonly log: Logger;
  private readonly circuitWorld: CircuitWorld;

  private constructor(
    record: WorldWithSettings,
    private readonly deps: RoomDeps,
  ) {
    this.id = record.id;
    this.log = deps.log.child(`room:${record.name}`);
    const settings = record.settings;
    this.info = {
      id: record.id,
      name: record.name,
      seed: record.seed,
      terrainType: (settings?.terrainType ?? 'default') as TerrainType,
      gameMode: GAME_MODE_FROM_DB[record.gameMode],
      maxPlayers: record.maxPlayers,
      ownerId: record.ownerId,
      dayNightCycle: settings?.dayNightCycle ?? true,
      weatherEnabled: settings?.weatherEnabled ?? true,
      buildPermission: (settings?.buildPermission ?? 'EVERYONE').toLowerCase() as WorldInfo['buildPermission'],
    };
    this.passwordHash = record.passwordHash;
    this.visibility = record.visibility;
    this.worldTime = record.worldTime;
    this.weather = (['clear', 'rain', 'snow'].includes(record.weather) ? record.weather : 'clear') as WeatherWire;
    this.world = new ServerWorld(record.id, record.seed, this.info.terrainType, deps.repo);
    this.circuitWorld = {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      getMeta: (x, y, z) => this.world.getMeta(x, y, z),
      setBlockFromCircuit: (x, y, z, id, meta) => this.applyBlock(x, y, z, id, meta, 'circuit'),
    };
    this.circuits = new CircuitSimulator(this.circuitWorld);
    this.circuits.onBurnout = (x, y, z) => this.log.warn('Circuit component disabled for toggling too fast', { x, y, z });
    this.world.onChunkGenerated = (chunk) => this.circuits.wakeChunk(chunk);
    this.inventories = new InventoryService({
      getOpenChestSlots: (p) => (p.openChest ? (this.containers.get(blockKey(p.openChest.x, p.openChest.y, p.openChest.z))?.slots ?? null) : null),
      markChestDirty: (p) => {
        if (!p.openChest) return;
        const c = this.containers.get(blockKey(p.openChest.x, p.openChest.y, p.openChest.z));
        if (c) c.dirty = true;
      },
    });
  }

  static async load(record: WorldWithSettings, deps: RoomDeps): Promise<WorldRoom> {
    const room = new WorldRoom(record, deps);
    await room.initSpawn(record);
    room.start();
    return room;
  }

  // --- Lifecycle ---------------------------------------------------------------

  private async initSpawn(record: WorldWithSettings): Promise<void> {
    const s = record.settings;
    if (s?.spawnX != null && s.spawnY != null && s.spawnZ != null) {
      this.spawn = { x: s.spawnX + 0.5, y: s.spawnY, z: s.spawnZ + 0.5 };
    } else {
      const col = this.world.generator.findSpawnColumn();
      this.spawn = { x: col.x + 0.5, y: col.height + 1, z: col.z + 0.5 };
    }
    const scx = toChunkCoord(this.spawn.x);
    const scz = toChunkCoord(this.spawn.z);
    await this.world.ensureChunks(this.chunkSquare(scx, scz, SIM_RADIUS));

    if (s?.includeShowcase && !s.showcaseBuilt) {
      await this.placeShowcase();
    }
    this.spawn.y = this.findStandingY(this.spawn.x, this.spawn.z, Math.floor(this.spawn.y));
    if (s && (s.spawnX == null || !s.showcaseBuilt)) {
      await this.deps.repo.updateSettings(this.id, {
        spawnX: Math.floor(this.spawn.x),
        spawnY: Math.floor(this.spawn.y),
        spawnZ: Math.floor(this.spawn.z),
        ...(s.includeShowcase ? { showcaseBuilt: true } : {}),
      });
    }
  }

  private async placeShowcase(): Promise<void> {
    const ox = Math.floor(this.spawn.x) + 3;
    const oz = Math.floor(this.spawn.z) + 14;
    const floorY = this.world.generator.getColumn(ox, oz).height;
    const coords: [number, number][] = [];
    for (let cx = toChunkCoord(ox + SHOWCASE_BOUNDS.minX); cx <= toChunkCoord(ox + SHOWCASE_BOUNDS.maxX); cx++) {
      for (let cz = toChunkCoord(oz + SHOWCASE_BOUNDS.minZ); cz <= toChunkCoord(oz + SHOWCASE_BOUNDS.maxZ); cz++) coords.push([cx, cz]);
    }
    await this.world.ensureChunks(coords);
    // Foundation below the platform so it never floats over water or caves.
    for (let x = SHOWCASE_BOUNDS.minX; x <= SHOWCASE_BOUNDS.maxX; x++) {
      for (let z = SHOWCASE_BOUNDS.minZ; z <= SHOWCASE_BOUNDS.maxZ; z++) {
        for (let y = floorY - 1; y > floorY - 10 && y > 0; y--) {
          const id = this.world.getBlock(ox + x, y, oz + z);
          if (getBlock(id).solid && id !== B.LEAVES) break;
          this.applyBlock(ox + x, y, oz + z, B.DIRT, 0, 'player');
        }
      }
    }
    for (const p of buildShowcase(ox, floorY, oz)) this.applyBlock(p.x, p.y, p.z, p.id, p.meta, 'player');
    this.pendingPlayerChanges.length = 0;
    this.log.info('Mechanism showcase built', { x: ox, y: floorY, z: oz });
  }

  /** Lowest position at or above `startY` where a player fits. */
  private findStandingY(x: number, z: number, startY: number): number {
    for (let y = Math.max(1, startY); y < WORLD_HEIGHT - 2; y++) {
      if (!playerCollides(this.world, x, y, z)) {
        // Drop down onto the ground if floating.
        let ground = y;
        while (ground > 1 && !playerCollides(this.world, x, ground - 1, z)) ground--;
        return ground;
      }
    }
    return WORLD_HEIGHT - 2;
  }

  private start(): void {
    const interval = Math.round(1000 / this.deps.config.TICK_RATE);
    this.tickTimer = setInterval(() => {
      try {
        this.tickOnce();
      } catch (error) {
        this.log.error('Tick failed', { error: error as Error });
      }
    }, interval);
    this.saveTimer = setInterval(() => void this.save(), this.deps.config.SAVE_INTERVAL_MS);
    this.scheduleWeather();
  }

  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    for (const player of [...this.players.values()]) {
      player.conn.send({ type: 'world:left', worldId: this.id, reason });
      this.detachPlayer(player);
    }
    await this.save();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // --- Players --------------------------------------------------------------------

  canPlayerBuild(isOwner: boolean, membershipCanBuild: boolean | null): boolean {
    if (isOwner) return true;
    switch (this.info.buildPermission) {
      case 'owner':
        return false;
      case 'members':
        return membershipCanBuild === true;
      default:
        return membershipCanBuild !== false;
    }
  }

  async addPlayer(conn: ClientConnection, renderDistance: number): Promise<ServerPlayer> {
    const account = conn.account;
    const isOwner = account.id === this.info.ownerId;
    await this.pendingPlayerSaves.get(account.id);
    const membership = await this.deps.repo.ensureMembership(this.id, account.id, isOwner ? 'OWNER' : 'VISITOR', this.info.buildPermission === 'everyone');
    const saved: LoadedPlayerState | null = await this.deps.repo.loadPlayerState(account.id, this.id);
    const mode: GameModeName = saved ? GAME_MODE_FROM_DB[saved.gameMode] : this.info.gameMode;
    const player = new ServerPlayer(account.id, account.displayName, account.appearance, conn, isOwner, mode, this.canPlayerBuild(isOwner, membership.canBuild), renderDistance);

    if (saved) {
      Object.assign(player.physics, { x: saved.x, y: saved.y, z: saved.z });
      player.yaw = saved.yaw;
      player.pitch = saved.pitch;
      player.physics.flying = saved.flying && mode !== 'survival';
      player.wantsFly = player.physics.flying;
      player.selectedSlot = saved.selectedSlot;
      player.inventory = saved.inventory;
      player.stats = saved.stats;
    } else {
      Object.assign(player.physics, { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
      player.yaw = Math.PI; // face the showcase (south)
      player.inventory = InventoryService.defaultInventory(mode === 'creative');
      player.stateDirty = true;
    }

    const cx = toChunkCoord(player.physics.x);
    const cz = toChunkCoord(player.physics.z);
    await this.world.ensureChunks(this.chunkSquare(cx, cz, SIM_RADIUS));
    if (this.closed) throw new Error('World was unloaded');
    if (mode !== 'spectator' && playerCollides(this.world, player.physics.x, player.physics.y, player.physics.z)) {
      player.physics.y = this.findStandingY(player.physics.x, player.physics.z, Math.floor(player.physics.y));
    }

    this.players.set(player.id, player);
    this.emptySince = null;
    conn.send({
      type: 'world:metadata',
      world: this.info,
      self: {
        x: player.physics.x,
        y: player.physics.y,
        z: player.physics.z,
        yaw: player.yaw,
        pitch: player.pitch,
        flying: player.physics.flying,
        gameMode: player.gameMode as WorldInfo['gameMode'],
        canBuild: player.canBuild,
        isOwner,
      },
      players: [...this.players.values()].map((p) => p.info()),
      time: this.worldTime,
      weather: this.weather,
      inventory: this.inventories.state(player),
      tick: this.tick,
    });
    for (const msg of this.chatHistory.slice(-15)) conn.send(msg);
    this.broadcast({ type: 'player:join', worldId: this.id, player: player.info() }, player.id);
    this.systemChat(`${player.name} joined the world`);
    this.log.info('Player joined', { player: player.name, players: this.players.size });
    this.deps.onPlayersChanged(this);
    return player;
  }

  /** Remove a player from the room (disconnect, leave or kick) and persist their state. */
  removePlayer(playerId: string, reason: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.detachPlayer(player);
    this.broadcast({ type: 'player:leave', worldId: this.id, playerId });
    this.systemChat(`${player.name} left the world${reason === 'timeout' ? ' (connection lost)' : ''}`);
    this.log.info('Player left', { player: player.name, reason, players: this.players.size });
    const pending = this.savePlayers([player]).finally(() => {
      if (this.pendingPlayerSaves.get(playerId) === pending) this.pendingPlayerSaves.delete(playerId);
    });
    this.pendingPlayerSaves.set(playerId, pending);
    this.deps.onPlayersChanged(this);
  }

  private detachPlayer(player: ServerPlayer): void {
    this.inventories.close(player);
    this.players.delete(player.id);
    if (player.conn.player === player) {
      player.conn.player = null;
      player.conn.room = null;
    }
    if (this.players.size === 0) this.emptySince = Date.now();
  }

  // --- Messaging ------------------------------------------------------------------

  send(player: ServerPlayer, message: ServerMessage): void {
    player.conn.send(message);
  }

  broadcast(message: ServerMessage, exceptId?: string): void {
    for (const p of this.players.values()) if (p.id !== exceptId) p.conn.send(message);
  }

  systemChat(text: string, to?: ServerPlayer): void {
    const msg: Extract<ServerMessage, { type: 'chat:message' }> = {
      type: 'chat:message',
      worldId: this.id,
      id: randomUUID(),
      kind: 'system',
      text,
      ts: Date.now(),
    };
    if (to) {
      to.conn.send(msg);
      return;
    }
    this.pushHistory(msg);
    this.broadcast(msg);
  }

  private pushHistory(msg: Extract<ServerMessage, { type: 'chat:message' }>): void {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > CHAT_HISTORY) this.chatHistory.shift();
  }

  sendInventory(player: ServerPlayer): void {
    player.conn.send({ type: 'inventory:update', worldId: this.id, inventory: this.inventories.state(player) });
  }

  handleMessage(player: ServerPlayer, msg: ClientMessage): void {
    switch (msg.type) {
      case 'player:input':
        for (const input of msg.inputs) {
          if (input.seq <= player.lastInputSeq) continue;
          player.inputQueue.push(input);
        }
        if (player.inputQueue.length > MAX_QUEUED_INPUTS) player.inputQueue.splice(0, player.inputQueue.length - MAX_QUEUED_INPUTS);
        break;
      case 'world:chunk-request':
        void this.handleChunkRequest(player, msg);
        break;
      case 'world:chunk-release':
        for (const [cx, cz] of msg.chunks) player.subscribed.delete(chunkKey(cx, cz));
        break;
      case 'world:render-distance':
        player.renderDistance = Math.min(msg.renderDistance, this.deps.config.MAX_RENDER_DISTANCE);
        break;
      case 'block:mine-start':
        player.mining = { x: msg.x, y: msg.y, z: msg.z, startedAt: Date.now() };
        player.swingUntilTick = this.tick + 6;
        break;
      case 'block:break':
        this.handleBreak(player, msg);
        break;
      case 'block:place':
        this.handlePlace(player, msg);
        break;
      case 'block:interact':
        void this.handleInteract(player, msg);
        break;
      case 'inventory:select':
        player.selectedSlot = msg.slot;
        player.stateDirty = true;
        break;
      case 'inventory:move': {
        const result = this.inventories.move(player, msg);
        if (!result.ok) this.send(player, { type: 'server:notification', level: 'warning', text: result.reason ?? 'Cannot move items' });
        this.sendInventory(player);
        if (result.ok && (msg.from.container === 'chest' || msg.to.container === 'chest')) this.syncChestViewers(player);
        break;
      }
      case 'inventory:creative-set': {
        const result = this.inventories.creativeSet(player, msg);
        if (!result.ok) this.send(player, { type: 'server:notification', level: 'warning', text: result.reason ?? 'Not allowed' });
        this.sendInventory(player);
        break;
      }
      case 'crafting:take': {
        const result = this.inventories.craft(player, msg.all ?? false);
        if (!result.ok) this.send(player, { type: 'server:notification', level: 'warning', text: result.reason ?? 'Cannot craft' });
        this.sendInventory(player);
        break;
      }
      case 'inventory:close':
        this.inventories.close(player);
        this.sendInventory(player);
        break;
      case 'chat:send':
        this.handleChat(player, msg.text);
        break;
      case 'world:save':
        if (!player.isOwner) {
          this.systemChat('Only the world owner can save manually.', player);
          break;
        }
        void this.save().then(() => this.systemChat('World saved.', player));
        break;
      case 'world:set-permission':
        void this.setBuildPermission(player, msg.playerId, msg.canBuild);
        break;
      default:
        break;
    }
  }

  private handleChat(player: ServerPlayer, raw: string): void {
    const text = sanitizeChat(raw, MAX_CHAT_LENGTH);
    if (!text) return;
    if (text.startsWith('/')) {
      const reply = runCommand(this, player, text);
      if (reply) this.systemChat(reply, player);
      return;
    }
    const msg: Extract<ServerMessage, { type: 'chat:message' }> = {
      type: 'chat:message',
      worldId: this.id,
      id: randomUUID(),
      kind: 'player',
      fromId: player.id,
      fromName: player.name,
      text,
      ts: Date.now(),
    };
    this.pushHistory(msg);
    this.broadcast(msg);
  }

  private async setBuildPermission(owner: ServerPlayer, targetId: string, canBuild: boolean): Promise<void> {
    if (!owner.isOwner) {
      this.systemChat('Only the world owner can change permissions.', owner);
      return;
    }
    if (targetId === owner.id) return;
    await this.deps.repo.setCanBuild(this.id, targetId, canBuild);
    const target = this.players.get(targetId);
    if (target) {
      target.canBuild = canBuild;
      this.broadcast({ type: 'player:update', worldId: this.id, player: target.info() });
      this.systemChat(canBuild ? 'You can now build in this world.' : 'Your building permission was removed.', target);
    }
  }

  // --- Chunks -----------------------------------------------------------------------

  private chunkSquare(cx: number, cz: number, radius: number): [number, number][] {
    const coords: [number, number][] = [];
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) coords.push([cx + dx, cz + dz]);
    return coords;
  }

  private async handleChunkRequest(player: ServerPlayer, msg: ClientMessageOf<'world:chunk-request'>): Promise<void> {
    const pcx = toChunkCoord(player.physics.x);
    const pcz = toChunkCoord(player.physics.z);
    const limit = player.renderDistance + 2;
    const wanted = msg.chunks.filter(([cx, cz]) => Math.abs(cx - pcx) <= limit && Math.abs(cz - pcz) <= limit);
    if (wanted.length === 0) return;
    try {
      await this.world.loadRecords(wanted.map(([cx, cz]) => [cx, cz] as const));
    } catch (error) {
      this.log.error('Failed to load chunks', { error: error as Error });
      return;
    }
    if (!this.players.has(player.id)) return;
    for (const [cx, cz, known] of wanted) {
      const info = this.world.getRecordInfo(cx, cz);
      if (!info) continue;
      player.subscribed.add(chunkKey(cx, cz));
      if (known === info.revision) {
        this.send(player, { type: 'world:chunk-data', worldId: this.id, cx, cz, revision: info.revision, encoding: 'unchanged', data: '' });
        continue;
      }
      const raw = encodeDelta(info.delta);
      const deflate = raw.length > CHUNK_DEFLATE_THRESHOLD;
      this.send(player, {
        type: 'world:chunk-data',
        worldId: this.id,
        cx,
        cz,
        revision: info.revision,
        encoding: deflate ? 'deflate' : 'raw',
        data: bytesToBase64(deflate ? new Uint8Array(deflateRawSync(raw)) : raw),
      });
    }
  }

  /** Keep fully generated chunks around players; release everything else. */
  private maintainChunks(): void {
    const keepGenerated = new Set<string>();
    const keepRecords = new Set<string>();
    const toLoad: [number, number][] = [];
    for (const p of this.players.values()) {
      const cx = toChunkCoord(p.physics.x);
      const cz = toChunkCoord(p.physics.z);
      for (const [x, z] of this.chunkSquare(cx, cz, SIM_RADIUS)) {
        const key = chunkKey(x, z);
        keepGenerated.add(key);
        if (!this.world.isChunkGenerated(x, z) && !this.simLoading.has(key)) toLoad.push([x, z]);
      }
      for (const key of p.subscribed) keepRecords.add(key);
    }
    // Keep loaded mechanisms near players running even slightly outside the sim radius.
    for (const p of this.players.values()) {
      const cx = toChunkCoord(p.physics.x);
      const cz = toChunkCoord(p.physics.z);
      for (const [x, z] of this.chunkSquare(cx, cz, SIM_RADIUS + 2)) {
        if (this.world.isChunkGenerated(x, z)) keepGenerated.add(chunkKey(x, z));
      }
    }
    if (toLoad.length) {
      for (const [x, z] of toLoad) this.simLoading.add(chunkKey(x, z));
      this.world
        .ensureChunks(toLoad)
        .catch((error) => this.log.error('Failed to load simulation chunks', { error: error as Error }))
        .finally(() => toLoad.forEach(([x, z]) => this.simLoading.delete(chunkKey(x, z))));
    }
    if (this.players.size > 0) this.world.unloadUnused(keepGenerated, keepRecords);
  }

  // --- World mutation -------------------------------------------------------------

  /** Single entry point for every block change; queues the network update and wakes circuits. */
  applyBlock(x: number, y: number, z: number, id: number, meta: number, cause: Cause): boolean {
    if (!this.world.setBlock(x, y, z, id, meta)) return false;
    (cause === 'circuit' ? this.pendingCircuitChanges : this.pendingPlayerChanges).push([x, y, z, id, meta]);
    this.circuits.notifyChange(x, y, z);
    return true;
  }

  private withinReach(player: ServerPlayer, x: number, y: number, z: number): boolean {
    const p = player.physics;
    const ex = p.x;
    const ey = p.y + eyeHeight(p);
    const ez = p.z;
    const dx = x + 0.5 - ex;
    const dy = y + 0.5 - ey;
    const dz = z + 0.5 - ez;
    return Math.hypot(dx, dy, dz) <= SERVER_INTERACTION_DISTANCE + 0.87;
  }

  private reject(player: ServerPlayer, seq: number, reason: string, positions: [number, number, number][]): void {
    const corrections: BlockChangeWire[] = positions
      .filter(([, y]) => y >= 0 && y < WORLD_HEIGHT)
      .map(([x, y, z]) => {
        const id = this.world.getBlock(x, y, z);
        return [x, y, z, id === UNLOADED ? 0 : id, this.world.getMeta(x, y, z)];
      });
    this.send(player, { type: 'block:action-result', worldId: this.id, seq, ok: false, reason, corrections });
  }

  private accept(player: ServerPlayer, seq: number): void {
    this.send(player, { type: 'block:action-result', worldId: this.id, seq, ok: true });
  }

  private canModify(player: ServerPlayer): string | null {
    if (player.gameMode === 'spectator') return 'Spectators cannot change the world';
    if (!player.canBuild) return 'You do not have permission to build in this world';
    return null;
  }

  private handleBreak(player: ServerPlayer, msg: ClientMessageOf<'block:break'>): void {
    const { x, y, z, seq } = msg;
    const denied = this.canModify(player);
    if (denied) return this.reject(player, seq, denied, [[x, y, z]]);
    const id = this.world.getBlock(x, y, z);
    if (id === UNLOADED) return this.reject(player, seq, 'That area is still loading', []);
    if (id === B.AIR) return this.reject(player, seq, 'Nothing to break', [[x, y, z]]);
    const def = getBlock(id);
    if (!def.breakable) return this.reject(player, seq, 'This block cannot be broken', [[x, y, z]]);
    if (!this.withinReach(player, x, y, z)) return this.reject(player, seq, 'That block is too far away', [[x, y, z]]);
    if (player.gameMode === 'survival') {
      const required = getBreakTime(id) * 1000;
      const m = player.mining;
      const elapsed = m && m.x === x && m.y === y && m.z === z ? Date.now() - m.startedAt : 0;
      // Allow some slack for network jitter.
      if (required > 50 && elapsed < required * 0.7 - 150) return this.reject(player, seq, 'Breaking too fast', [[x, y, z]]);
    }
    player.mining = null;
    const meta = this.world.getMeta(x, y, z);
    const removed: [number, number, number][] = [[x, y, z]];

    if (id === B.DOOR) {
      const otherY = getVariant(meta) & 1 ? y - 1 : y + 1;
      if (this.world.getBlock(x, otherY, z) === B.DOOR) {
        this.applyBlock(x, otherY, z, B.AIR, 0, 'player');
        removed.push([x, otherY, z]);
      }
    } else if (id === B.PISTON || id === B.STICKY_PISTON) {
      this.circuits.removeArm(x, y, z, meta);
    } else if (id === B.CHEST) {
      void this.destroyContainer(player, x, y, z);
    }
    this.applyBlock(x, y, z, B.AIR, 0, 'player');
    if (player.gameMode === 'survival') {
      this.inventories.giveDrop(player, id);
      this.sendInventory(player);
    }
    player.bumpStat('blocksBroken');
    player.swingUntilTick = this.tick + 6;
    for (const [rx, ry, rz] of removed) this.checkSupportAround(rx, ry, rz);
    this.accept(player, seq);
  }

  private handlePlace(player: ServerPlayer, msg: ClientMessageOf<'block:place'>): void {
    const { seq, x, y, z } = msg;
    const face = msg.face as FaceId;
    const denied = this.canModify(player);
    const [fx, fy, fz] = FACE_DIRS[face];
    const target = this.world.getBlock(x, y, z);
    const replaceTarget = target !== UNLOADED && target !== B.AIR && getBlock(target).replaceable;
    const px = replaceTarget ? x : x + fx;
    const py = replaceTarget ? y : y + fy;
    const pz = replaceTarget ? z : z + fz;
    const touched: [number, number, number][] = [[px, py, pz], [px, py + 1, pz]];
    if (denied) return this.reject(player, seq, denied, touched);
    const slot = player.inventory[player.selectedSlot];
    if (!slot || slot.id >= 256) return this.reject(player, seq, 'Select a block to place', touched);
    const id = slot.id;
    const def = getBlock(id);
    if (!def.obtainable) return this.reject(player, seq, 'That block cannot be placed', touched);
    if (target === UNLOADED || this.world.getBlock(px, py, pz) === UNLOADED) return this.reject(player, seq, 'That area is still loading', touched);
    if (target === B.AIR) return this.reject(player, seq, 'Nothing to place against', touched);
    if (!this.withinReach(player, px, py, pz)) return this.reject(player, seq, 'That spot is too far away', touched);
    if (py < 1 || py >= WORLD_HEIGHT) return this.reject(player, seq, 'Out of build height', touched);
    if (!getBlock(this.world.getBlock(px, py, pz)).replaceable) return this.reject(player, seq, 'That space is occupied', touched);

    const meta = computePlacementMeta(id, { face, yaw: msg.yaw, pitch: msg.pitch, hitY: msg.hitY });
    // Support rules for attached and floor-mounted blocks.
    if (def.orientation === 'attach') {
      const support = this.world.getBlock(px - FACE_DIRS[face][0], py - FACE_DIRS[face][1], pz - FACE_DIRS[face][2]);
      if (!getBlock(support).solid) return this.reject(player, seq, 'This needs a solid block to attach to', touched);
    } else if (needsSupport(id) && !getBlock(this.world.getBlock(px, py - 1, pz)).solid) {
      return this.reject(player, seq, 'This needs solid ground below it', touched);
    }
    if (id === B.DOOR && !getBlock(this.world.getBlock(px, py + 1, pz)).replaceable) {
      return this.reject(player, seq, 'Doors need two blocks of space', touched);
    }
    if (def.solid) {
      for (const other of this.players.values()) {
        if (other.gameMode === 'spectator') continue;
        if (blockIntersectsPlayer(other.physics, px, py, pz) || (id === B.DOOR && blockIntersectsPlayer(other.physics, px, py + 1, pz))) {
          return this.reject(player, seq, 'A player is in the way', touched);
        }
      }
    }

    this.applyBlock(px, py, pz, id, meta, 'player');
    if (id === B.DOOR) this.applyBlock(px, py + 1, pz, B.DOOR, makeMeta(getFacing(meta), 1), 'player');
    if (player.gameMode === 'survival') {
      removeFromSlot(player.inventory, player.selectedSlot, 1);
      this.sendInventory(player);
    }
    player.bumpStat('blocksPlaced');
    player.swingUntilTick = this.tick + 6;
    this.accept(player, seq);
  }

  private async handleInteract(player: ServerPlayer, msg: ClientMessageOf<'block:interact'>): Promise<void> {
    const { seq, x, y, z } = msg;
    if (player.gameMode === 'spectator') return this.reject(player, seq, 'Spectators cannot interact', []);
    const id = this.world.getBlock(x, y, z);
    if (id === UNLOADED || !getBlock(id).interactive) return this.reject(player, seq, 'Nothing to use here', [[x, y, z]]);
    if (!this.withinReach(player, x, y, z)) return this.reject(player, seq, 'That block is too far away', [[x, y, z]]);
    const meta = this.world.getMeta(x, y, z);
    player.swingUntilTick = this.tick + 6;
    switch (id) {
      case B.LEVER:
      case B.SWITCH:
        this.applyBlock(x, y, z, id, withActive(meta, !isActive(meta)), 'player');
        break;
      case B.BUTTON:
        if (!isActive(meta)) {
          this.applyBlock(x, y, z, id, withActive(meta, true), 'player');
          this.circuits.schedule(x, y, z, BUTTON_PULSE_TICKS, 'release');
        }
        break;
      case B.DOOR: {
        const lowerY = getVariant(meta) & 1 ? y - 1 : y;
        const open = !isActive(this.world.getMeta(x, lowerY, z));
        for (const yy of [lowerY, lowerY + 1]) {
          if (this.world.getBlock(x, yy, z) === B.DOOR) this.applyBlock(x, yy, z, B.DOOR, withActive(this.world.getMeta(x, yy, z), open), 'player');
        }
        break;
      }
      case B.TRAPDOOR:
        this.applyBlock(x, y, z, id, withActive(meta, !isActive(meta)), 'player');
        break;
      case B.REPEATER:
      case B.TIMER:
      case B.PISTON:
      case B.STICKY_PISTON: {
        const denied = this.canModify(player);
        if (denied) return this.reject(player, seq, denied, [[x, y, z]]);
        const next = CircuitSimulator.cycleVariant(id, meta);
        if (next === null) return this.reject(player, seq, 'Retract the piston before changing its stroke', [[x, y, z]]);
        this.applyBlock(x, y, z, id, next, 'player');
        const v = getVariant(next) + 1;
        const label = id === B.REPEATER ? `Delay: ${v * 2} ticks` : id === B.TIMER ? `Interval: ${(v * 10) / 20}s` : `Stroke: ${v} block${v > 1 ? 's' : ''}`;
        this.send(player, { type: 'server:notification', level: 'info', text: label });
        break;
      }
      case B.CRAFTING_TABLE:
        player.craftGridSize = 3;
        this.send(player, { type: 'inventory:open', worldId: this.id, kind: 'crafting' });
        this.sendInventory(player);
        break;
      case B.CHEST: {
        const denied = this.canModify(player);
        if (denied) return this.reject(player, seq, denied, [[x, y, z]]);
        await this.loadContainer(x, y, z);
        if (!this.players.has(player.id) || this.world.getBlock(x, y, z) !== B.CHEST) return;
        player.openChest = { x, y, z };
        this.send(player, { type: 'inventory:open', worldId: this.id, kind: 'chest' });
        this.sendInventory(player);
        break;
      }
      default:
        return this.reject(player, seq, 'Nothing to use here', [[x, y, z]]);
    }
    this.accept(player, seq);
  }

  /** Remove blocks that lost their support after a neighbouring change. */
  private checkSupportAround(x: number, y: number, z: number): void {
    const queue: [number, number, number][] = [[x, y, z]];
    let guard = 0;
    while (queue.length && guard++ < 256) {
      const [cx, cy, cz] = queue.shift()!;
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = FACE_DIRS[f];
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        const id = this.world.getBlock(nx, ny, nz);
        if (id === UNLOADED || id === B.AIR || !this.isUnsupported(nx, ny, nz, id)) continue;
        this.applyBlock(nx, ny, nz, B.AIR, 0, 'player');
        queue.push([nx, ny, nz]);
      }
    }
  }

  private isUnsupported(x: number, y: number, z: number, id: number): boolean {
    const def = getBlock(id);
    const meta = this.world.getMeta(x, y, z);
    if (id === B.DOOR) {
      const upper = (getVariant(meta) & 1) === 1;
      if (upper) return this.world.getBlock(x, y - 1, z) !== B.DOOR;
      return this.world.getBlock(x, y + 1, z) !== B.DOOR || !getBlock(this.world.getBlock(x, y - 1, z)).solid;
    }
    if (def.orientation === 'attach') {
      const [dx, dy, dz] = FACE_DIRS[getFacing(meta)];
      return !getBlock(this.world.getBlock(x - dx, y - dy, z - dz)).solid;
    }
    if (needsSupport(id)) return !getBlock(this.world.getBlock(x, y - 1, z)).solid;
    return false;
  }

  // --- Containers ------------------------------------------------------------------

  private async loadContainer(x: number, y: number, z: number): Promise<ContainerState> {
    const key = blockKey(x, y, z);
    const existing = this.containers.get(key);
    if (existing && !existing.removed) return existing;
    const slots = (await this.deps.repo.loadContainer(this.id, x, y, z)) ?? createSlots(CHEST_SIZE);
    const again = this.containers.get(key);
    if (again && !again.removed) return again;
    const state: ContainerState = { x, y, z, slots, dirty: false, removed: false };
    this.containers.set(key, state);
    return state;
  }

  private async destroyContainer(player: ServerPlayer, x: number, y: number, z: number): Promise<void> {
    const state = await this.loadContainer(x, y, z);
    if (player.gameMode === 'survival') {
      for (const s of state.slots) if (s) addItem(player.inventory, s.id, s.count);
      this.sendInventory(player);
    }
    state.slots = createSlots(CHEST_SIZE);
    state.removed = true;
    state.dirty = true;
    for (const p of this.players.values()) {
      if (p.openChest && p.openChest.x === x && p.openChest.y === y && p.openChest.z === z) {
        p.openChest = null;
        this.sendInventory(p);
      }
    }
  }

  private syncChestViewers(source: ServerPlayer): void {
    const c = source.openChest;
    if (!c) return;
    for (const p of this.players.values()) {
      if (p !== source && p.openChest && p.openChest.x === c.x && p.openChest.y === c.y && p.openChest.z === c.z) this.sendInventory(p);
    }
  }

  // --- Simulation tick ---------------------------------------------------------------

  private tickOnce(): void {
    if (this.closed) return;
    this.tick++;
    const tokensPerTick = PHYSICS_RATE / this.deps.config.TICK_RATE;

    for (const player of this.players.values()) this.simulatePlayer(player, tokensPerTick);
    this.updatePressurePlates();
    this.circuits.step();
    this.advanceTime();
    this.flushUpdates();
    if (this.tick % 20 === 0) this.maintainChunks();
  }

  private simulatePlayer(player: ServerPlayer, tokensPerTick: number): void {
    player.inputTokens = Math.min(MAX_INPUT_TOKENS, player.inputTokens + tokensPerTick);
    const p = player.physics;
    while (player.inputTokens >= 1 && player.inputQueue.length > 0) {
      const cx = toChunkCoord(p.x);
      const cz = toChunkCoord(p.z);
      if (player.gameMode !== 'spectator' && !this.areaReady(cx, cz)) break;
      const input = player.inputQueue.shift()!;
      player.inputTokens -= 1;
      player.wantsFly = input.fly;
      player.yaw = input.yaw;
      player.pitch = input.pitch;
      stepPlayer(p, input, this.world, player.gameMode, PHYSICS_DT);
      player.lastInputSeq = input.seq;
      player.stateDirty = true;
    }
    if (p.y < -32) this.teleport(player, this.spawn.x, this.spawn.y, this.spawn.z);
  }

  private areaReady(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.isChunkGenerated(cx + dx, cz + dz)) return false;
    return true;
  }

  teleport(player: ServerPlayer, x: number, y: number, z: number): void {
    Object.assign(player.physics, { x, y, z, vx: 0, vy: 0, vz: 0 });
    player.inputQueue.length = 0;
    player.pendingTeleport = true;
    player.stateDirty = true;
  }

  private updatePressurePlates(): void {
    for (const player of this.players.values()) {
      if (player.gameMode === 'spectator') continue;
      const p = player.physics;
      const bx = Math.floor(p.x);
      const by = Math.floor(p.y + 0.01);
      const bz = Math.floor(p.z);
      if (this.world.getBlock(bx, by, bz) !== B.PRESSURE_PLATE) continue;
      const key = blockKey(bx, by, bz);
      this.activePlates.set(key, this.tick);
      const meta = this.world.getMeta(bx, by, bz);
      if (!isActive(meta)) this.applyBlock(bx, by, bz, B.PRESSURE_PLATE, withActive(meta, true), 'circuit');
    }
    for (const [key, lastTick] of this.activePlates) {
      if (this.tick - lastTick < PLATE_RELEASE_TICKS) continue;
      this.activePlates.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      if (this.world.getBlock(x, y, z) === B.PRESSURE_PLATE) {
        this.applyBlock(x, y, z, B.PRESSURE_PLATE, withActive(this.world.getMeta(x, y, z), false), 'circuit');
      }
    }
  }

  private scheduleWeather(): void {
    const minutes = 3 + Math.random() * 6;
    this.nextWeatherChange = this.tick + Math.round(minutes * 60 * this.deps.config.TICK_RATE);
  }

  private advanceTime(): void {
    let changed = false;
    if (this.info.dayNightCycle) this.worldTime += WORLD_TICKS_PER_SECOND / this.deps.config.TICK_RATE;
    if (this.info.weatherEnabled && this.tick >= this.nextWeatherChange) {
      const r = Math.random();
      const next: WeatherWire = r < 0.6 ? 'clear' : r < 0.85 ? 'rain' : 'snow';
      if (next !== this.weather) {
        this.weather = next;
        changed = true;
      }
      this.scheduleWeather();
    } else if (!this.info.weatherEnabled && this.weather !== 'clear') {
      this.weather = 'clear';
      changed = true;
    }
    if (changed || this.tick % TIME_BROADCAST_TICKS === 0) this.broadcastTime();
  }

  broadcastTime(): void {
    this.broadcast({ type: 'world:time-update', worldId: this.id, time: Math.floor(this.worldTime), weather: this.weather, dayNightCycle: this.info.dayNightCycle });
  }

  setTime(time: number): void {
    const day = Math.floor(this.worldTime / DAY_LENGTH_TICKS);
    this.worldTime = day * DAY_LENGTH_TICKS + (((time % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS);
    this.broadcastTime();
  }

  setWeather(weather: WeatherWire): void {
    this.weather = weather;
    this.scheduleWeather();
    this.broadcastTime();
  }

  setGameMode(player: ServerPlayer, mode: GameModeName): void {
    player.gameMode = mode;
    if (mode === 'survival') {
      player.physics.flying = false;
      player.wantsFly = false;
    }
    player.stateDirty = true;
    this.inventories.close(player);
    this.broadcast({ type: 'player:update', worldId: this.id, player: player.info() });
    this.sendInventory(player);
  }

  /** Send per-tick state: own state, nearby players, and block changes for subscribed chunks. */
  private flushUpdates(): void {
    const playerChanges = this.pendingPlayerChanges.splice(0);
    const circuitChanges = this.pendingCircuitChanges.splice(0);
    const all = [...this.players.values()];
    for (const player of all) {
      const p = player.physics;
      this.send(player, {
        type: 'player:state',
        worldId: this.id,
        tick: this.tick,
        ackSeq: player.lastInputSeq,
        x: round(p.x),
        y: round(p.y),
        z: round(p.z),
        vx: round(p.vx),
        vy: round(p.vy),
        vz: round(p.vz),
        flags: player.flags,
        ...(player.pendingTeleport ? { teleport: true } : {}),
      });
      player.pendingTeleport = false;

      const range = (player.renderDistance + 1) * CHUNK_SIZE;
      const visible = [];
      for (const other of all) {
        if (other === player || other.gameMode === 'spectator') continue;
        const dx = other.physics.x - p.x;
        const dz = other.physics.z - p.z;
        if (dx * dx + dz * dz > range * range) continue;
        const flags = other.flags | (other.swingUntilTick > this.tick ? 32 : 0);
        visible.push([other.id, round(other.physics.x), round(other.physics.y), round(other.physics.z), round(other.yaw), round(other.pitch), flags, other.heldItem] as [
          string,
          number,
          number,
          number,
          number,
          number,
          number,
          number,
        ]);
      }
      this.send(player, { type: 'player:snapshot', worldId: this.id, tick: this.tick, serverTime: Date.now(), players: visible });

      const mine = filterSubscribed(playerChanges, player.subscribed);
      if (mine.length) this.send(player, { type: 'block:update', worldId: this.id, changes: mine });
      const circuit = filterSubscribed(circuitChanges, player.subscribed);
      if (circuit.length) this.send(player, { type: 'circuit:state-update', worldId: this.id, changes: circuit });
    }
  }

  // --- Persistence ---------------------------------------------------------------------

  private playerSave(p: ServerPlayer): PlayerStateSave {
    return {
      playerId: p.id,
      x: p.physics.x,
      y: p.physics.y,
      z: p.physics.z,
      yaw: p.yaw,
      pitch: p.pitch,
      gameMode: GAME_MODE_TO_DB[p.gameMode],
      flying: p.physics.flying,
      selectedSlot: p.selectedSlot,
      stats: p.stats,
      inventory: p.inventory,
    };
  }

  private async savePlayers(players: ServerPlayer[]): Promise<void> {
    try {
      await this.deps.repo.saveSnapshot(this.id, { chunks: [], worldState: null, players: players.map((p) => this.playerSave(p)), containers: [] });
    } catch (error) {
      this.log.error('Failed to save player state', { error: error as Error });
    }
  }

  /** Flush dirty chunks, world clock, players and containers in one transaction. */
  async save(): Promise<void> {
    if (this.saving) {
      await this.saving;
      // A save that started before our changes may have missed them; run once more.
    }
    this.saving = this.doSave().finally(() => {
      this.saving = null;
    });
    await this.saving;
  }

  private async doSave(): Promise<void> {
    const chunks = this.world.takeDirty();
    const players = [...this.players.values()].filter((p) => p.stateDirty);
    players.forEach((p) => (p.stateDirty = false));
    const containers = [...this.containers.values()].filter((c) => c.dirty);
    containers.forEach((c) => (c.dirty = false));
    try {
      await this.deps.repo.saveSnapshot(this.id, {
        chunks,
        worldState: { worldTime: Math.floor(this.worldTime), weather: this.weather },
        players: players.map((p) => this.playerSave(p)),
        containers: containers.map((c) => ({ x: c.x, y: c.y, z: c.z, slots: c.removed ? null : c.slots })),
      });
      for (const c of containers) if (c.removed) this.containers.delete(blockKey(c.x, c.y, c.z));
      if (chunks.length) this.log.debug('World saved', { chunks: chunks.length, players: players.length });
    } catch (error) {
      this.world.restoreDirty(chunks);
      players.forEach((p) => (p.stateDirty = true));
      containers.forEach((c) => (c.dirty = true));
      this.log.error('World save failed; will retry', { error: error as Error });
    }
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function filterSubscribed(changes: BlockChangeWire[], subscribed: Set<string>): BlockChangeWire[] {
  if (changes.length === 0) return changes;
  return changes.filter(([x, , z]) => subscribed.has(chunkKey(toChunkCoord(x), toChunkCoord(z))));
}
