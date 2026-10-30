import { B } from '../blocks/ids';
import { getCollisionBoxes, type Box } from '../blocks/shapes';
import { UNLOADED, type BlockAccess } from '../world/blockAccess';
import { WORLD_HEIGHT } from '../world/constants';

export type GameModeName = 'creative' | 'survival' | 'spectator';

export interface PlayerInput {
  /** Monotonic input sequence number used for reconciliation. */
  seq: number;
  /** -1 (back) .. 1 (forward) */
  forward: number;
  /** -1 (left) .. 1 (right) */
  strafe: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** Player wants to fly (only honoured in Creative / Spectator). */
  fly: boolean;
  yaw: number;
  pitch: number;
}

export interface PlayerPhysicsState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
  crouching: boolean;
  sprinting: boolean;
}

export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.5;
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_CROUCH_EYE_HEIGHT = 1.32;

const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.8;
const CROUCH_SPEED = 1.4;
const FLY_SPEED = 10.5;
const FLY_SPRINT_SPEED = 21;
const SWIM_SPEED = 2.4;
const GRAVITY = 28;
const WATER_GRAVITY = 6;
const JUMP_VELOCITY = 8.6;
const SWIM_UP_VELOCITY = 3.6;
const TERMINAL_VELOCITY = 60;
const STEP_HEIGHT = 0.6;
const EPSILON = 1e-4;

export function createPhysicsState(x: number, y: number, z: number): PlayerPhysicsState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, flying: false, inWater: false, crouching: false, sprinting: false };
}

export function clonePhysicsState(s: PlayerPhysicsState): PlayerPhysicsState {
  return { ...s };
}

export function emptyInput(seq = 0): PlayerInput {
  return { seq, forward: 0, strafe: 0, jump: false, sprint: false, crouch: false, fly: false, yaw: 0, pitch: 0 };
}

const FULL_BOX: Box = [0, 0, 0, 1, 1, 1];

function blockBoxes(world: BlockAccess, x: number, y: number, z: number): readonly Box[] {
  if (y >= WORLD_HEIGHT) return [];
  const id = world.getBlock(x, y, z);
  if (id === UNLOADED) return [FULL_BOX];
  if (id === B.AIR) return [];
  return getCollisionBoxes(id, world.getMeta(x, y, z));
}

interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function playerAABB(x: number, y: number, z: number, height: number): AABB {
  return {
    minX: x - PLAYER_HALF_WIDTH,
    minY: y,
    minZ: z - PLAYER_HALF_WIDTH,
    maxX: x + PLAYER_HALF_WIDTH,
    maxY: y + height,
    maxZ: z + PLAYER_HALF_WIDTH,
  };
}

/** True if the AABB overlaps any solid block geometry. */
export function aabbCollides(world: BlockAccess, box: AABB): boolean {
  const x0 = Math.floor(box.minX);
  const x1 = Math.floor(box.maxX - EPSILON);
  const y0 = Math.floor(box.minY);
  const y1 = Math.floor(box.maxY - EPSILON);
  const z0 = Math.floor(box.minZ);
  const z1 = Math.floor(box.maxZ - EPSILON);
  for (let by = y0 - 1; by <= y1; by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        for (const b of blockBoxes(world, bx, by, bz)) {
          if (
            box.maxX > bx + b[0] + EPSILON &&
            box.minX < bx + b[3] - EPSILON &&
            box.maxY > by + b[1] + EPSILON &&
            box.minY < by + b[4] - EPSILON &&
            box.maxZ > bz + b[2] + EPSILON &&
            box.minZ < bz + b[5] - EPSILON
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/** Whether a player standing at (x, y, z) would intersect solid blocks. */
export function playerCollides(world: BlockAccess, x: number, y: number, z: number, height = PLAYER_HEIGHT): boolean {
  return aabbCollides(world, playerAABB(x, y, z, height));
}

/**
 * Move an AABB along one axis, stopping at the first solid block surface.
 * Returns the distance actually travelled.
 */
function sweepAxis(world: BlockAccess, box: AABB, axis: 0 | 1 | 2, delta: number): number {
  if (delta === 0) return 0;
  const minA = axis === 0 ? box.minX : axis === 1 ? box.minY : box.minZ;
  const maxA = axis === 0 ? box.maxX : axis === 1 ? box.maxY : box.maxZ;
  const from = delta > 0 ? maxA : minA;
  const to = from + delta;
  const lo = Math.floor(Math.min(from, to)) - (axis === 1 ? 1 : 0);
  const hi = Math.floor(Math.max(from, to));

  // Range of the other two axes the box covers.
  const ax0 = Math.floor(box.minX);
  const ax1 = Math.floor(box.maxX - EPSILON);
  const ay0 = Math.floor(box.minY) - 1;
  const ay1 = Math.floor(box.maxY - EPSILON);
  const az0 = Math.floor(box.minZ);
  const az1 = Math.floor(box.maxZ - EPSILON);

  let allowed = delta;
  const xr = axis === 0 ? [lo, hi] : [ax0, ax1];
  const yr = axis === 1 ? [lo, hi] : [ay0, ay1];
  const zr = axis === 2 ? [lo, hi] : [az0, az1];
  for (let by = yr[0]; by <= yr[1]; by++) {
    for (let bz = zr[0]; bz <= zr[1]; bz++) {
      for (let bx = xr[0]; bx <= xr[1]; bx++) {
        for (const b of blockBoxes(world, bx, by, bz)) {
          const bMinX = bx + b[0];
          const bMaxX = bx + b[3];
          const bMinY = by + b[1];
          const bMaxY = by + b[4];
          const bMinZ = bz + b[2];
          const bMaxZ = bz + b[5];
          // Must overlap on the two other axes.
          if (axis !== 0 && (box.maxX <= bMinX + EPSILON || box.minX >= bMaxX - EPSILON)) continue;
          if (axis !== 1 && (box.maxY <= bMinY + EPSILON || box.minY >= bMaxY - EPSILON)) continue;
          if (axis !== 2 && (box.maxZ <= bMinZ + EPSILON || box.minZ >= bMaxZ - EPSILON)) continue;
          const bMin = axis === 0 ? bMinX : axis === 1 ? bMinY : bMinZ;
          const bMax = axis === 0 ? bMaxX : axis === 1 ? bMaxY : bMaxZ;
          if (delta > 0) {
            if (bMin >= maxA - EPSILON) allowed = Math.min(allowed, bMin - maxA);
          } else if (bMax <= minA + EPSILON) {
            allowed = Math.max(allowed, bMax - minA);
          }
        }
      }
    }
  }
  if (delta > 0 && allowed < 0) allowed = 0;
  if (delta < 0 && allowed > 0) allowed = 0;
  return allowed;
}

function offsetBox(box: AABB, axis: 0 | 1 | 2, d: number): void {
  if (axis === 0) {
    box.minX += d;
    box.maxX += d;
  } else if (axis === 1) {
    box.minY += d;
    box.maxY += d;
  } else {
    box.minZ += d;
    box.maxZ += d;
  }
}

function isWater(world: BlockAccess, x: number, y: number, z: number): boolean {
  return world.getBlock(x, y, z) === B.WATER;
}

function hasGroundBelow(world: BlockAccess, x: number, y: number, z: number, height: number): boolean {
  return aabbCollides(world, { ...playerAABB(x, y - 0.1, z, height), maxY: y });
}

/**
 * Advance one fixed physics step. Shared by client prediction and the
 * authoritative server simulation so both produce the same result.
 */
export function stepPlayer(
  state: PlayerPhysicsState,
  input: PlayerInput,
  world: BlockAccess,
  mode: GameModeName,
  dt: number,
): void {
  const noclip = mode === 'spectator';
  const canFly = mode === 'creative' || mode === 'spectator';
  state.flying = noclip || (canFly && input.fly);
  state.inWater = !state.flying && isWater(world, state.x, state.y + 0.4, state.z);
  state.crouching = !state.flying && input.crouch;
  state.sprinting = input.sprint && input.forward > 0 && !state.crouching;

  const height = state.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;

  // Desired horizontal velocity from input, relative to yaw (yaw 0 looks toward -Z).
  let fwd = Math.max(-1, Math.min(1, input.forward));
  let str = Math.max(-1, Math.min(1, input.strafe));
  const len = Math.hypot(fwd, str);
  if (len > 1) {
    fwd /= len;
    str /= len;
  }
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const dirX = -sin * fwd + cos * str;
  const dirZ = -cos * fwd - sin * str;

  let speed: number;
  if (state.flying) speed = state.sprinting || input.sprint ? FLY_SPRINT_SPEED : FLY_SPEED;
  else if (state.inWater) speed = SWIM_SPEED;
  else if (state.crouching) speed = CROUCH_SPEED;
  else if (state.sprinting) speed = SPRINT_SPEED;
  else speed = WALK_SPEED;

  const control = state.flying ? 0.5 : state.onGround || state.inWater ? 1 : 0.25;
  const blend = Math.min(1, control * 20 * dt);
  state.vx += (dirX * speed - state.vx) * blend;
  state.vz += (dirZ * speed - state.vz) * blend;

  if (state.flying) {
    const vertical = (input.jump ? 1 : 0) - (input.crouch ? 1 : 0);
    state.vy += (vertical * speed * 0.8 - state.vy) * Math.min(1, 10 * dt);
  } else if (state.inWater) {
    state.vy -= WATER_GRAVITY * dt;
    if (input.jump) state.vy = Math.max(state.vy, SWIM_UP_VELOCITY);
    state.vy = Math.max(state.vy, -4);
  } else {
    if (input.jump && state.onGround) state.vy = JUMP_VELOCITY;
    state.vy -= GRAVITY * dt;
    if (state.vy < -TERMINAL_VELOCITY) state.vy = -TERMINAL_VELOCITY;
  }

  const dx = state.vx * dt;
  const dy = state.vy * dt;
  const dz = state.vz * dt;

  if (noclip) {
    state.x += dx;
    state.y = Math.max(-10, Math.min(WORLD_HEIGHT + 64, state.y + dy));
    state.z += dz;
    state.onGround = false;
    return;
  }

  const box = playerAABB(state.x, state.y, state.z, height);
  const wasOnGround = state.onGround;

  // Vertical first.
  const movedY = sweepAxis(world, box, 1, dy);
  offsetBox(box, 1, movedY);
  const hitFloor = dy < 0 && movedY > dy + EPSILON;
  const hitCeiling = dy > 0 && movedY < dy - EPSILON;
  if (hitFloor || hitCeiling) state.vy = 0;
  state.onGround = hitFloor;

  const edgeGuard = state.crouching && wasOnGround;
  for (const axis of [0, 2] as const) {
    const delta = axis === 0 ? dx : dz;
    if (delta === 0) continue;
    let moved = sweepAxis(world, box, axis, delta);
    if (Math.abs(moved - delta) > EPSILON && (state.onGround || wasOnGround) && !state.inWater) {
      // Try stepping up onto a low obstacle (slabs, stairs).
      const up = sweepAxis(world, box, 1, STEP_HEIGHT);
      if (up > 0) {
        const stepBox = { ...box };
        offsetBox(stepBox, 1, up);
        const steppedMove = sweepAxis(world, stepBox, axis, delta);
        if (Math.abs(steppedMove) > Math.abs(moved) + EPSILON) {
          offsetBox(stepBox, axis, steppedMove);
          const down = sweepAxis(world, stepBox, 1, -up);
          offsetBox(stepBox, 1, down);
          Object.assign(box, stepBox);
          moved = steppedMove;
          continue;
        }
      }
    }
    offsetBox(box, axis, moved);
    if (edgeGuard) {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      if (!hasGroundBelow(world, cx, box.minY, cz, height)) {
        offsetBox(box, axis, -moved);
        moved = 0;
      }
    }
    if (Math.abs(moved - delta) > EPSILON) {
      if (axis === 0) state.vx = 0;
      else state.vz = 0;
    }
  }

  state.x = (box.minX + box.maxX) / 2;
  state.y = box.minY;
  state.z = (box.minZ + box.maxZ) / 2;
  if (state.flying && state.onGround && mode === 'creative') state.flying = false;
}

/** Eye height for the current posture. */
export function eyeHeight(state: Pick<PlayerPhysicsState, 'crouching'>): number {
  return state.crouching ? PLAYER_CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
}

/** Whether a block placed at (bx, by, bz) would intersect the player's body. */
export function blockIntersectsPlayer(state: Pick<PlayerPhysicsState, 'x' | 'y' | 'z' | 'crouching'>, bx: number, by: number, bz: number): boolean {
  const height = state.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  return (
    state.x + PLAYER_HALF_WIDTH > bx &&
    state.x - PLAYER_HALF_WIDTH < bx + 1 &&
    state.y + height > by &&
    state.y < by + 1 &&
    state.z + PLAYER_HALF_WIDTH > bz &&
    state.z - PLAYER_HALF_WIDTH < bz + 1
  );
}
