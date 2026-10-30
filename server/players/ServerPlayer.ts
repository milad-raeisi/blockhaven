import { createSlots, CRAFT_GRID_SIZE, INVENTORY_SIZE, type Slot } from '../../src/game/inventory/inventory';
import { createPhysicsState, type GameModeName, type PlayerInput, type PlayerPhysicsState } from '../../src/game/physics/player';
import { PlayerFlags, type Appearance, type GameModeWire, type PlayerInfo } from '../../src/network/protocol/messages';
import type { ClientConnection } from '../websocket/connection';

export const MAX_QUEUED_INPUTS = 40;
/** Inputs the server may process per physics tick when catching up after jitter. */
export const MAX_INPUT_TOKENS = 6;

/** In-room state of one connected player. */
export class ServerPlayer {
  gameMode: GameModeName;
  canBuild: boolean;
  physics: PlayerPhysicsState;
  yaw = 0;
  pitch = 0;
  wantsFly = false;
  readonly inputQueue: PlayerInput[] = [];
  inputTokens = MAX_INPUT_TOKENS;
  lastInputSeq = 0;
  /** Set when the server moved the player; tells the client to snap instead of reconcile. */
  pendingTeleport = false;

  inventory: Slot[] = createSlots(INVENTORY_SIZE);
  craft: Slot[] = createSlots(CRAFT_GRID_SIZE);
  craftGridSize: 2 | 3 = 2;
  selectedSlot = 0;
  openChest: { x: number; y: number; z: number } | null = null;

  /** Chunks this client currently holds (interest management). */
  readonly subscribed = new Set<string>();
  renderDistance: number;

  mining: { x: number; y: number; z: number; startedAt: number } | null = null;
  swingUntilTick = 0;
  stats: Record<string, number> = {};
  stateDirty = false;
  joinedAt = Date.now();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly appearance: Appearance,
    readonly conn: ClientConnection,
    readonly isOwner: boolean,
    gameMode: GameModeName,
    canBuild: boolean,
    renderDistance: number,
  ) {
    this.gameMode = gameMode;
    this.canBuild = canBuild;
    this.renderDistance = renderDistance;
    this.physics = createPhysicsState(0, 0, 0);
  }

  get heldItem(): number {
    return this.inventory[this.selectedSlot]?.id ?? 0;
  }

  get flags(): number {
    const p = this.physics;
    return (
      (p.onGround ? PlayerFlags.OnGround : 0) |
      (p.flying ? PlayerFlags.Flying : 0) |
      (p.crouching ? PlayerFlags.Crouching : 0) |
      (p.sprinting ? PlayerFlags.Sprinting : 0) |
      (p.inWater ? PlayerFlags.InWater : 0)
    );
  }

  info(): PlayerInfo {
    return {
      id: this.id,
      name: this.name,
      appearance: this.appearance,
      gameMode: this.gameMode as GameModeWire,
      canBuild: this.canBuild,
      isOwner: this.isOwner,
    };
  }

  bumpStat(name: string, amount = 1): void {
    this.stats[name] = (this.stats[name] ?? 0) + amount;
    this.stateDirty = true;
  }
}
