import {
  clonePhysicsState,
  createPhysicsState,
  stepPlayer,
  type GameModeName,
  type PlayerInput,
  type PlayerPhysicsState,
} from '../physics/player';
import type { BlockAccess } from '../world/blockAccess';
import { PHYSICS_DT } from '../world/constants';
import { PlayerFlags, type ServerMessageOf } from '../../network/protocol/messages';

const MAX_PENDING = 120;
/** Corrections smaller than this are applied silently; larger ones snap. */
const SNAP_DISTANCE = 4;

/**
 * Client-side prediction for the local player. Inputs are simulated
 * immediately with the shared physics, sent to the server, and replayed on
 * top of each authoritative state (server reconciliation). Small corrections
 * are smoothed out visually.
 */
export class LocalPlayer {
  state: PlayerPhysicsState = createPhysicsState(0, 0, 0);
  private previous: PlayerPhysicsState = createPhysicsState(0, 0, 0);
  private pending: PlayerInput[] = [];
  private seq = 0;
  yaw = 0;
  pitch = 0;
  mode: GameModeName = 'creative';
  wantsFly = false;
  /** Visual offset that decays after a reconciliation correction. */
  private readonly errorOffset = { x: 0, y: 0, z: 0 };
  corrections = 0;

  constructor(private readonly world: BlockAccess) {}

  reset(x: number, y: number, z: number, yaw: number, pitch: number, flying: boolean): void {
    this.state = createPhysicsState(x, y, z);
    this.state.flying = flying;
    this.wantsFly = flying;
    this.previous = clonePhysicsState(this.state);
    this.pending = [];
    this.yaw = yaw;
    this.pitch = pitch;
    this.errorOffset.x = this.errorOffset.y = this.errorOffset.z = 0;
  }

  /** Simulate one fixed step locally and return the input to send to the server. */
  step(movement: Omit<PlayerInput, 'seq' | 'yaw' | 'pitch' | 'fly'>): PlayerInput {
    if (this.mode === 'survival') this.wantsFly = false;
    if (this.mode === 'spectator') this.wantsFly = true;
    const input: PlayerInput = { ...movement, seq: ++this.seq, yaw: this.yaw, pitch: this.pitch, fly: this.wantsFly };
    this.previous = clonePhysicsState(this.state);
    stepPlayer(this.state, input, this.world, this.mode, PHYSICS_DT);
    // Landing turns off flying in Creative; keep the toggle in sync.
    if (this.wantsFly && !this.state.flying && this.mode === 'creative') this.wantsFly = false;
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return input;
  }

  /** Reconcile with an authoritative server state. */
  reconcile(msg: ServerMessageOf<'player:state'>): void {
    this.pending = this.pending.filter((input) => input.seq > msg.ackSeq);
    const server: PlayerPhysicsState = {
      x: msg.x,
      y: msg.y,
      z: msg.z,
      vx: msg.vx,
      vy: msg.vy,
      vz: msg.vz,
      onGround: (msg.flags & PlayerFlags.OnGround) !== 0,
      flying: (msg.flags & PlayerFlags.Flying) !== 0,
      inWater: (msg.flags & PlayerFlags.InWater) !== 0,
      crouching: (msg.flags & PlayerFlags.Crouching) !== 0,
      sprinting: (msg.flags & PlayerFlags.Sprinting) !== 0,
    };
    if (msg.teleport) {
      this.state = server;
      this.previous = clonePhysicsState(server);
      this.pending = [];
      this.errorOffset.x = this.errorOffset.y = this.errorOffset.z = 0;
      return;
    }
    // Replay unacknowledged inputs on top of the server state.
    const replay = clonePhysicsState(server);
    for (const input of this.pending) stepPlayer(replay, input, this.world, this.mode, PHYSICS_DT);
    const dx = replay.x - this.state.x;
    const dy = replay.y - this.state.y;
    const dz = replay.z - this.state.z;
    const error = Math.hypot(dx, dy, dz);
    if (error < 0.001) return;
    this.corrections++;
    if (error < SNAP_DISTANCE) {
      this.errorOffset.x -= dx;
      this.errorOffset.y -= dy;
      this.errorOffset.z -= dz;
    } else {
      this.errorOffset.x = this.errorOffset.y = this.errorOffset.z = 0;
      this.previous = clonePhysicsState(replay);
    }
    this.state = replay;
  }

  /** Interpolated position for rendering between fixed steps. */
  renderPosition(alpha: number, dt: number): { x: number; y: number; z: number } {
    const decay = Math.exp(-dt * 12);
    this.errorOffset.x *= decay;
    this.errorOffset.y *= decay;
    this.errorOffset.z *= decay;
    return {
      x: this.previous.x + (this.state.x - this.previous.x) * alpha + this.errorOffset.x,
      y: this.previous.y + (this.state.y - this.previous.y) * alpha + this.errorOffset.y,
      z: this.previous.z + (this.state.z - this.previous.z) * alpha + this.errorOffset.z,
    };
  }
}
