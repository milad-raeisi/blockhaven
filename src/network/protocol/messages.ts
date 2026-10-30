import { z } from 'zod';
import { MAX_RENDER_DISTANCE, MIN_RENDER_DISTANCE, WORLD_HEIGHT } from '../../game/world/constants';

/**
 * Blockhaven WebSocket protocol.
 *
 * Every message is a JSON object with a `type` discriminator. Client messages
 * are validated with Zod on the server; server messages are typed unions that
 * the client trusts. Bump PROTOCOL_VERSION on incompatible changes.
 */
export const PROTOCOL_VERSION = 1;

/** Maximum accepted size of a single client message in bytes. */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;

export const MAX_CHAT_LENGTH = 200;
export const COORD_LIMIT = 1_000_000;

const coord = z.number().int().min(-COORD_LIMIT).max(COORD_LIMIT);
const coordY = z.number().int().min(0).max(WORLD_HEIGHT - 1);
const worldId = z.string().min(1).max(40);
const face = z.number().int().min(0).max(5);
const angle = z.number().finite().min(-1000).max(1000);
const seq = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const playerInputSchema = z.object({
  seq,
  forward: z.number().min(-1).max(1),
  strafe: z.number().min(-1).max(1),
  jump: z.boolean(),
  sprint: z.boolean(),
  crouch: z.boolean(),
  fly: z.boolean(),
  yaw: angle,
  pitch: z.number().min(-Math.PI / 2 - 0.01).max(Math.PI / 2 + 0.01),
});

const containerRef = z.object({
  container: z.enum(['inventory', 'craft', 'chest']),
  slot: z.number().int().min(0).max(35),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connection:hello'), protocol: z.number().int(), client: z.string().max(64) }),
  z.object({ type: z.literal('connection:ping'), t: z.number().finite() }),
  z.object({ type: z.literal('lobby:subscribe') }),
  z.object({ type: z.literal('lobby:unsubscribe') }),
  z.object({
    type: z.literal('world:join'),
    worldId,
    password: z.string().max(64).optional(),
    renderDistance: z.number().int().min(MIN_RENDER_DISTANCE).max(MAX_RENDER_DISTANCE),
  }),
  z.object({ type: z.literal('world:leave') }),
  z.object({
    type: z.literal('world:chunk-request'),
    worldId,
    /** [cx, cz, knownRevision] — knownRevision is -1 when the client has no data. */
    chunks: z.array(z.tuple([coord, coord, z.number().int().min(-1)])).min(1).max(128),
  }),
  z.object({
    type: z.literal('world:chunk-release'),
    worldId,
    chunks: z.array(z.tuple([coord, coord])).min(1).max(512),
  }),
  z.object({ type: z.literal('world:render-distance'), worldId, renderDistance: z.number().int().min(MIN_RENDER_DISTANCE).max(MAX_RENDER_DISTANCE) }),
  z.object({ type: z.literal('player:input'), worldId, inputs: z.array(playerInputSchema).min(1).max(20) }),
  z.object({ type: z.literal('block:mine-start'), worldId, x: coord, y: coordY, z: coord }),
  z.object({ type: z.literal('block:break'), worldId, seq, x: coord, y: coordY, z: coord }),
  z.object({
    type: z.literal('block:place'),
    worldId,
    seq,
    /** The targeted (clicked) block. */
    x: coord,
    y: coordY,
    z: coord,
    face,
    yaw: angle,
    pitch: angle,
    hitY: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal('block:interact'), worldId, seq, x: coord, y: coordY, z: coord, face, sneak: z.boolean() }),
  z.object({ type: z.literal('inventory:select'), worldId, slot: z.number().int().min(0).max(8) }),
  z.object({ type: z.literal('inventory:move'), worldId, from: containerRef, to: containerRef, count: z.number().int().min(1).max(64).optional() }),
  z.object({
    type: z.literal('inventory:creative-set'),
    worldId,
    slot: z.number().int().min(0).max(35),
    item: z.number().int().min(0).max(1023).nullable(),
    count: z.number().int().min(1).max(64),
  }),
  z.object({ type: z.literal('inventory:close'), worldId }),
  z.object({ type: z.literal('crafting:take'), worldId, all: z.boolean().optional() }),
  z.object({ type: z.literal('chat:send'), worldId, text: z.string().min(1).max(MAX_CHAT_LENGTH) }),
  z.object({ type: z.literal('world:save'), worldId }),
  z.object({ type: z.literal('world:set-permission'), worldId, playerId: z.string().min(1).max(40), canBuild: z.boolean() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage['type'];
export type ClientMessageOf<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>;
export type WireInput = z.infer<typeof playerInputSchema>;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type GameModeWire = 'creative' | 'survival' | 'spectator';
export type WeatherWire = 'clear' | 'rain' | 'snow';
export type ConnectionErrorCode =
  | 'protocol_mismatch'
  | 'unauthorized'
  | 'invalid_message'
  | 'rate_limited'
  | 'world_not_found'
  | 'world_full'
  | 'wrong_password'
  | 'not_in_world'
  | 'kicked'
  | 'server_error';

export interface Appearance {
  skin: string;
  shirt: string;
  pants: string;
}

export interface WorldSummary {
  id: string;
  name: string;
  gameMode: GameModeWire;
  visibility: 'public' | 'unlisted' | 'private';
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  ownerName: string;
  isOwner: boolean;
  terrainType: string;
  lastPlayedAt: string | null;
}

export interface WorldInfo {
  id: string;
  name: string;
  seed: string;
  terrainType: 'default' | 'flat' | 'mountains';
  gameMode: GameModeWire;
  maxPlayers: number;
  ownerId: string;
  dayNightCycle: boolean;
  weatherEnabled: boolean;
  buildPermission: 'everyone' | 'members' | 'owner';
}

export interface PlayerInfo {
  id: string;
  name: string;
  appearance: Appearance;
  gameMode: GameModeWire;
  canBuild: boolean;
  isOwner: boolean;
}

/** Flags packed into remote player snapshots. */
export const PlayerFlags = {
  OnGround: 1,
  Flying: 2,
  Crouching: 4,
  Sprinting: 8,
  InWater: 16,
  Swinging: 32,
} as const;

/** [id, x, y, z, yaw, pitch, flags, heldItem] */
export type RemotePlayerState = [string, number, number, number, number, number, number, number];

/** [x, y, z, blockId, meta] */
export type BlockChangeWire = [number, number, number, number, number];

export interface SlotWire {
  id: number;
  count: number;
}

export interface InventoryState {
  slots: (SlotWire | null)[];
  craft: (SlotWire | null)[];
  craftResult: SlotWire | null;
  gridSize: 2 | 3;
  selectedSlot: number;
  chest: { x: number; y: number; z: number; slots: (SlotWire | null)[] } | null;
}

export interface SelfState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  gameMode: GameModeWire;
  canBuild: boolean;
  isOwner: boolean;
}

export type ServerMessage =
  | {
      type: 'connection:welcome';
      protocol: number;
      playerId: string;
      displayName: string;
      appearance: Appearance;
      serverTime: number;
      tickRate: number;
      maxRenderDistance: number;
    }
  | { type: 'connection:error'; code: ConnectionErrorCode; message: string; fatal?: boolean }
  | { type: 'connection:pong'; t: number; serverTime: number }
  | { type: 'lobby:worlds'; worlds: WorldSummary[] }
  | {
      type: 'world:metadata';
      world: WorldInfo;
      self: SelfState;
      players: PlayerInfo[];
      time: number;
      weather: WeatherWire;
      inventory: InventoryState;
      tick: number;
    }
  | { type: 'world:left'; worldId: string; reason?: string }
  | {
      type: 'world:chunk-data';
      worldId: string;
      cx: number;
      cz: number;
      revision: number;
      /** raw / deflate: base64 delta payload; unchanged: client copy is current. */
      encoding: 'raw' | 'deflate' | 'unchanged';
      data: string;
    }
  | { type: 'world:time-update'; worldId: string; time: number; weather: WeatherWire; dayNightCycle: boolean }
  | { type: 'player:join'; worldId: string; player: PlayerInfo }
  | { type: 'player:update'; worldId: string; player: PlayerInfo }
  | { type: 'player:leave'; worldId: string; playerId: string }
  | { type: 'player:snapshot'; worldId: string; tick: number; serverTime: number; players: RemotePlayerState[] }
  | {
      type: 'player:state';
      worldId: string;
      tick: number;
      ackSeq: number;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      flags: number;
      /** Set when the server forcibly moved the player (teleport / invalid movement). */
      teleport?: boolean;
    }
  | { type: 'block:update'; worldId: string; changes: BlockChangeWire[] }
  | { type: 'circuit:state-update'; worldId: string; changes: BlockChangeWire[] }
  | { type: 'block:action-result'; worldId: string; seq: number; ok: boolean; reason?: string; corrections?: BlockChangeWire[] }
  | { type: 'inventory:update'; worldId: string; inventory: InventoryState }
  | { type: 'inventory:open'; worldId: string; kind: 'crafting' | 'chest' }
  | {
      type: 'chat:message';
      worldId: string;
      id: string;
      kind: 'player' | 'system';
      fromId?: string;
      fromName?: string;
      text: string;
      ts: number;
    }
  | { type: 'server:notification'; level: 'info' | 'warning' | 'error'; text: string }
  | { type: 'server:shutdown'; reason: string };

export type ServerMessageType = ServerMessage['type'];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;
