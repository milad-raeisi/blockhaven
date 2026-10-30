import { B } from '../blocks/ids';
import { getFacing, getVariant, makeMeta } from '../blocks/meta';
import { computePlacementMeta } from '../blocks/placement';
import { getBlock, getBreakTime } from '../blocks/registry';
import { needsSupport } from '../blocks/shapes';
import { blockIntersectsPlayer, type PlayerPhysicsState } from '../physics/player';
import type { ChunkStore } from '../world/blockAccess';
import { UNLOADED } from '../world/blockAccess';
import { FACE_DIRS, INTERACTION_DISTANCE, type FaceId } from '../world/constants';
import { raycastBlocks, type RaycastHit } from '../world/raycast';
import type { ClientMessage, ServerMessageOf } from '../../network/protocol/messages';

type Change = [number, number, number, number, number];

export interface InteractionHost {
  world: ChunkStore;
  worldId: string;
  send(message: ClientMessage): void;
  applyLocal(changes: Change[]): void;
  heldItem(): number;
  gameMode(): 'creative' | 'survival' | 'spectator';
  canBuild(): boolean;
  player(): PlayerPhysicsState & { yaw: number; pitch: number };
  crouching(): boolean;
  onSwing(): void;
  onSound(name: 'place' | 'break' | 'click' | 'door' | 'error'): void;
  notify(text: string): void;
  pickBlock(id: number): void;
}

const CREATIVE_BREAK_INTERVAL = 0.22;
const PLACE_INTERVAL = 0.22;

/**
 * Crosshair targeting, mining progress and optimistic block edits. Edits are
 * applied locally right away and rolled back if the server rejects them.
 */
export class Interaction {
  target: RaycastHit | null = null;
  progress = 0;
  private primaryHeld = false;
  private secondaryHeld = false;
  private cooldown = 0;
  private miningKey = '';
  private seq = 0;

  constructor(private readonly host: InteractionHost) {}

  update(dt: number, eye: [number, number, number], direction: [number, number, number]): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const mode = this.host.gameMode();
    this.target = mode === 'spectator' ? null : raycastBlocks(this.host.world, eye, direction, INTERACTION_DISTANCE);

    if (this.primaryHeld && this.target) {
      if (mode === 'creative') {
        if (this.cooldown <= 0) {
          this.breakTarget(this.target);
          this.cooldown = CREATIVE_BREAK_INTERVAL;
        }
      } else if (mode === 'survival') {
        const key = `${this.target.x},${this.target.y},${this.target.z}`;
        if (key !== this.miningKey) {
          this.miningKey = key;
          this.progress = 0;
          this.host.send({ type: 'block:mine-start', worldId: this.host.worldId, x: this.target.x, y: this.target.y, z: this.target.z });
        }
        const time = getBreakTime(this.target.id);
        this.progress += time > 0 ? dt / time : 1;
        if (this.progress >= 1) {
          this.breakTarget(this.target);
          this.progress = 0;
          this.miningKey = '';
        }
      }
    } else {
      this.progress = 0;
      this.miningKey = '';
    }

    if (this.secondaryHeld && this.cooldown <= 0) {
      this.use();
      this.cooldown = PLACE_INTERVAL;
    }
  }

  primary(down: boolean): void {
    this.primaryHeld = down;
    if (down) {
      this.host.onSwing();
      this.cooldown = 0;
    }
  }

  secondary(down: boolean): void {
    this.secondaryHeld = down;
    if (down) this.cooldown = 0;
  }

  /** Middle click: pick the targeted block into the hotbar (Creative). */
  pick(): void {
    if (!this.target || this.host.gameMode() !== 'creative') return;
    const def = getBlock(this.target.id);
    if (def.obtainable) this.host.pickBlock(this.target.id);
    else if (this.target.id === B.SNOWY_GRASS) this.host.pickBlock(B.GRASS);
  }

  private breakTarget(hit: RaycastHit): void {
    if (!this.host.canBuild()) {
      this.host.notify('You do not have permission to build in this world.');
      this.primaryHeld = false;
      return;
    }
    const def = getBlock(hit.id);
    if (!def.breakable) return;
    const seq = ++this.seq;
    const changes: Change[] = [[hit.x, hit.y, hit.z, B.AIR, 0]];
    if (hit.id === B.DOOR) {
      const otherY = getVariant(hit.meta) & 1 ? hit.y - 1 : hit.y + 1;
      if (this.host.world.getBlock(hit.x, otherY, hit.z) === B.DOOR) changes.push([hit.x, otherY, hit.z, B.AIR, 0]);
    }
    this.host.applyLocal(changes);
    this.host.send({ type: 'block:break', worldId: this.host.worldId, seq, x: hit.x, y: hit.y, z: hit.z });
    this.host.onSwing();
    this.host.onSound('break');
  }

  /** Right click: interact with the targeted block or place the held block. */
  private use(): void {
    const hit = this.target;
    if (!hit) return;
    const def = getBlock(hit.id);
    if (def.interactive && !this.host.crouching()) {
      this.host.send({ type: 'block:interact', worldId: this.host.worldId, seq: ++this.seq, x: hit.x, y: hit.y, z: hit.z, face: hit.face, sneak: false });
      this.host.onSwing();
      this.host.onSound(hit.id === B.DOOR || hit.id === B.TRAPDOOR ? 'door' : 'click');
      return;
    }
    this.place(hit);
  }

  private place(hit: RaycastHit): void {
    const id = this.host.heldItem();
    if (id <= 0 || id >= 256) return;
    if (!this.host.canBuild()) {
      this.host.notify('You do not have permission to build in this world.');
      return;
    }
    const world = this.host.world;
    const def = getBlock(id);
    const face = hit.face as FaceId;
    const replaceTarget = getBlock(hit.id).replaceable;
    const [dx, dy, dz] = FACE_DIRS[face];
    const x = replaceTarget ? hit.x : hit.x + dx;
    const y = replaceTarget ? hit.y : hit.y + dy;
    const z = replaceTarget ? hit.z : hit.z + dz;
    const existing = world.getBlock(x, y, z);
    if (existing === UNLOADED || !getBlock(existing).replaceable || y < 1) return;
    const player = this.host.player();
    if (def.solid && blockIntersectsPlayer(player, x, y, z)) return;
    if (def.orientation === 'attach' && !getBlock(world.getBlock(x - dx, y - dy, z - dz)).solid) return;
    if (def.orientation !== 'attach' && needsSupport(id) && !getBlock(world.getBlock(x, y - 1, z)).solid) return;
    if (id === B.DOOR && (!getBlock(world.getBlock(x, y + 1, z)).replaceable || (def.solid && blockIntersectsPlayer(player, x, y + 1, z)))) return;

    const hitY = Math.min(1, Math.max(0, hit.point[1] - hit.y));
    const meta = computePlacementMeta(id, { face, yaw: player.yaw, pitch: player.pitch, hitY });
    const changes: Change[] = [[x, y, z, id, meta]];
    if (id === B.DOOR) changes.push([x, y + 1, z, B.DOOR, makeMeta(getFacing(meta), 1)]);
    this.host.applyLocal(changes);
    this.host.send({ type: 'block:place', worldId: this.host.worldId, seq: ++this.seq, x: hit.x, y: hit.y, z: hit.z, face, yaw: player.yaw, pitch: player.pitch, hitY });
    this.host.onSwing();
    this.host.onSound('place');
  }

  /** Roll back predicted edits the server rejected. */
  onActionResult(msg: ServerMessageOf<'block:action-result'>): void {
    if (msg.ok) return;
    if (msg.corrections?.length) this.host.applyLocal(msg.corrections);
    if (msg.reason) {
      this.host.notify(msg.reason);
      this.host.onSound('error');
    }
  }

  releaseAll(): void {
    this.primaryHeld = false;
    this.secondaryHeld = false;
    this.progress = 0;
    this.miningKey = '';
  }
}
