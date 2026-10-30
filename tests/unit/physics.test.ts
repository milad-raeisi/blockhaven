import { describe, expect, it } from 'vitest';
import { B } from '../../src/game/blocks/ids';
import { makeMeta } from '../../src/game/blocks/meta';
import { Chunk } from '../../src/game/chunks/chunk';
import {
  blockIntersectsPlayer,
  createPhysicsState,
  emptyInput,
  playerCollides,
  stepPlayer,
  type PlayerInput,
} from '../../src/game/physics/player';
import { ChunkStore } from '../../src/game/world/blockAccess';
import { Face, PHYSICS_DT } from '../../src/game/world/constants';
import { raycastBlocks } from '../../src/game/world/raycast';

/** A flat stone floor at y = 10 across a 3x3 chunk area. */
function flatWorld(): ChunkStore {
  const store = new ChunkStore();
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const chunk = new Chunk(cx, cz);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y <= 10; y++) chunk.setBlock(x, y, z, B.STONE);
      store.setChunk(chunk);
    }
  }
  return store;
}

function run(world: ChunkStore, state = createPhysicsState(0.5, 11, 0.5), input: Partial<PlayerInput> = {}, steps = 20, mode: 'creative' | 'survival' = 'survival') {
  for (let i = 0; i < steps; i++) stepPlayer(state, { ...emptyInput(i), ...input }, world, mode, PHYSICS_DT);
  return state;
}

describe('player physics', () => {
  it('falls with gravity and lands on the ground', () => {
    const state = run(flatWorld(), createPhysicsState(0.5, 20, 0.5), {}, 60);
    expect(state.y).toBeCloseTo(11, 5);
    expect(state.onGround).toBe(true);
    expect(state.vy).toBe(0);
  });

  it('walks forward (yaw 0 faces -Z) at walking speed', () => {
    const state = run(flatWorld(), undefined, { forward: 1 }, 40);
    expect(state.z).toBeLessThan(-6);
    expect(Math.abs(state.x - 0.5)).toBeLessThan(0.01);
  });

  it('cannot walk through solid blocks', () => {
    const world = flatWorld();
    for (let y = 11; y <= 13; y++) for (let x = -3; x <= 3; x++) world.setBlock(x, y, -3, B.STONE);
    const state = run(world, undefined, { forward: 1 }, 60);
    // The wall occupies z in [-3, -2]; the player's half width is 0.3.
    expect(state.z).toBeGreaterThanOrEqual(-2 + 0.3 - 1e-6);
    expect(playerCollides(world, state.x, state.y, state.z)).toBe(false);
  });

  it('jumps about one block high', () => {
    const world = flatWorld();
    const state = run(world, undefined, {}, 5);
    let maxY = state.y;
    stepPlayer(state, { ...emptyInput(1), jump: true }, world, 'survival', PHYSICS_DT);
    for (let i = 0; i < 20; i++) {
      stepPlayer(state, emptyInput(i + 2), world, 'survival', PHYSICS_DT);
      maxY = Math.max(maxY, state.y);
    }
    expect(maxY - 11).toBeGreaterThan(1.0);
    expect(maxY - 11).toBeLessThan(1.6);
  });

  it('steps up onto slabs automatically', () => {
    const world = flatWorld();
    for (let x = -2; x <= 2; x++) for (let z = -2; z >= -14; z--) world.setBlock(x, 11, z, B.STONE_SLAB, makeMeta(0, 0));
    const state = run(world, undefined, { forward: 1 }, 30);
    expect(state.z).toBeLessThan(-2);
    expect(state.y).toBeCloseTo(11.5, 3);
  });

  it('only flies in Creative mode', () => {
    const creative = run(flatWorld(), undefined, { fly: true, jump: true }, 20, 'creative');
    expect(creative.y).toBeGreaterThan(13);
    const survival = run(flatWorld(), undefined, { fly: true, jump: true }, 20, 'survival');
    expect(survival.flying).toBe(false);
    expect(survival.y).toBeLessThan(13);
  });

  it('detects block placement inside the player', () => {
    const state = createPhysicsState(0.5, 11, 0.5);
    expect(blockIntersectsPlayer({ ...state, crouching: false }, 0, 11, 0)).toBe(true);
    expect(blockIntersectsPlayer({ ...state, crouching: false }, 0, 12, 0)).toBe(true);
    expect(blockIntersectsPlayer({ ...state, crouching: false }, 0, 13, 0)).toBe(false);
    expect(blockIntersectsPlayer({ ...state, crouching: false }, 1, 11, 0)).toBe(false);
  });
});

describe('voxel raycasting', () => {
  it('hits the first solid block and reports the face', () => {
    const world = flatWorld();
    const hit = raycastBlocks(world, [0.5, 12.6, 0.5], [0, -1, 0], 6);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([0, 10, 0]);
    expect(hit!.face).toBe(Face.Up);
    expect(hit!.distance).toBeCloseTo(1.6, 5);
  });

  it('respects the maximum distance and partial block shapes', () => {
    const world = flatWorld();
    expect(raycastBlocks(world, [0.5, 30, 0.5], [0, -1, 0], 6)).toBeNull();
    world.setBlock(3, 11, 0, B.STONE_SLAB, 0);
    // Passing over a bottom slab at y = 11.7 misses it and hits nothing nearer.
    const miss = raycastBlocks(world, [0.5, 11.7, 0.5], [1, 0, 0], 6);
    expect(miss).toBeNull();
    const hit = raycastBlocks(world, [0.5, 11.3, 0.5], [1, 0, 0], 6);
    expect(hit?.id).toBe(B.STONE_SLAB);
    expect(hit?.face).toBe(Face.West);
  });
});
