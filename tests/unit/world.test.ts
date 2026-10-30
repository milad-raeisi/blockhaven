import { describe, expect, it } from 'vitest';
import { B } from '../../src/game/blocks/ids';
import { getBlock } from '../../src/game/blocks/registry';
import { Chunk } from '../../src/game/chunks/chunk';
import { applyDelta, base64ToBytes, bytesToBase64, decodeDelta, encodeDelta, packBlock } from '../../src/game/chunks/delta';
import { TerrainGenerator } from '../../src/game/terrain/generator';
import { hashString, normalizeSeed } from '../../src/game/terrain/random';
import { ChunkStore, UNLOADED } from '../../src/game/world/blockAccess';
import { CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from '../../src/game/world/constants';
import { chunkKey, indexToLocal, localIndex, parseChunkKey, toChunkCoord, toLocalCoord } from '../../src/game/world/coords';

describe('coordinates', () => {
  it('converts world coordinates to chunk and local coordinates, including negatives', () => {
    expect(toChunkCoord(0)).toBe(0);
    expect(toChunkCoord(15.9)).toBe(0);
    expect(toChunkCoord(16)).toBe(1);
    expect(toChunkCoord(-1)).toBe(-1);
    expect(toChunkCoord(-16)).toBe(-1);
    expect(toChunkCoord(-17)).toBe(-2);
    expect(toLocalCoord(-1)).toBe(15);
    expect(toLocalCoord(-16)).toBe(0);
    expect(toLocalCoord(33)).toBe(1);
  });

  it('round-trips chunk keys and local indices', () => {
    expect(parseChunkKey(chunkKey(-3, 12))).toEqual([-3, 12]);
    for (const [x, y, z] of [[0, 0, 0], [15, 127, 15], [3, 64, 9]] as const) {
      const index = localIndex(x, y, z);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(CHUNK_VOLUME);
      expect(indexToLocal(index)).toEqual([x, y, z]);
    }
  });
});

describe('chunk storage', () => {
  it('stores blocks and metadata and reports unloaded areas', () => {
    const store = new ChunkStore();
    store.setChunk(new Chunk(-1, 0));
    expect(store.setBlock(-5, 10, 3, B.STONE, 7)).toBe(true);
    expect(store.getBlock(-5, 10, 3)).toBe(B.STONE);
    expect(store.getMeta(-5, 10, 3)).toBe(7);
    expect(store.getBlock(5, 10, 3)).toBe(UNLOADED);
    expect(store.getBlock(-5, WORLD_HEIGHT + 3, 3)).toBe(B.AIR);
  });

  it('encodes and decodes sparse chunk deltas', () => {
    const delta = new Map([
      [localIndex(1, 2, 3), packBlock(B.BRICKS, 0)],
      [localIndex(15, 127, 15), packBlock(B.LEVER, 0b10010)],
    ]);
    const decoded = decodeDelta(encodeDelta(delta));
    expect([...decoded.entries()].sort()).toEqual([...delta.entries()].sort());
    const chunk = new Chunk(0, 0);
    applyDelta(chunk, decoded);
    expect(chunk.getBlock(1, 2, 3)).toBe(B.BRICKS);
    expect(chunk.getMeta(15, 127, 15)).toBe(0b10010);
  });

  it('base64-encodes binary payloads losslessly', () => {
    for (const length of [0, 1, 2, 3, 4, 100, 257]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37) & 255);
      expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
    }
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe(Buffer.from('hi').toString('base64'));
  });
});

describe('terrain generation', () => {
  it('is deterministic for the same seed', () => {
    const a = new TerrainGenerator('determinism').generateChunk(4, -7);
    const b = new TerrainGenerator('determinism').generateChunk(4, -7);
    expect(Buffer.compare(Buffer.from(a.blocks), Buffer.from(b.blocks))).toBe(0);
  });

  it('produces different worlds for different seeds', () => {
    const a = new TerrainGenerator('seed-a').generateChunk(0, 0);
    const b = new TerrainGenerator('seed-b').generateChunk(0, 0);
    expect(Buffer.compare(Buffer.from(a.blocks), Buffer.from(b.blocks))).not.toBe(0);
  });

  it('normalizes numeric and text seeds', () => {
    expect(normalizeSeed('12345')).toBe(12345);
    expect(normalizeSeed('hello')).toBe(hashString('hello'));
  });

  it('builds sensible layers: bedrock floor, stone underground, solid surface or water', () => {
    const gen = new TerrainGenerator('layers');
    const chunk = gen.generateChunk(2, 3);
    for (let lz = 0; lz < CHUNK_SIZE; lz += 5) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 5) {
        expect(chunk.getBlock(lx, 0, lz)).toBe(B.BEDROCK);
        const { height } = gen.getColumn(chunk.originX + lx, chunk.originZ + lz);
        const surface = chunk.getBlock(lx, height, lz);
        if (height >= SEA_LEVEL) expect([B.AIR, B.WATER]).not.toContain(surface === B.AIR ? -1 : surface);
        else expect(chunk.getBlock(lx, SEA_LEVEL, lz)).toBe(B.WATER);
      }
    }
    let stone = 0;
    for (let y = 1; y < 20; y++) if (chunk.getBlock(8, y, 8) !== B.AIR) stone++;
    expect(stone).toBeGreaterThan(5);
  });

  it('places trees consistently across chunk borders', () => {
    // A tree's leaves may span two chunks; generating each chunk separately must agree.
    const gen = new TerrainGenerator('trees');
    let logs = 0;
    for (let cx = 0; cx < 4; cx++) {
      const c = gen.generateChunk(cx, 0);
      for (let i = 0; i < c.blocks.length; i++) if (c.blocks[i] === B.LOG) logs++;
    }
    expect(logs).toBeGreaterThan(0);
    const again = new TerrainGenerator('trees').generateChunk(1, 0);
    expect(Buffer.compare(Buffer.from(again.blocks), Buffer.from(gen.generateChunk(1, 0).blocks))).toBe(0);
  });

  it('generates ore deposits underground', () => {
    const gen = new TerrainGenerator('ores');
    const ores = new Set<number>();
    for (let cx = 0; cx < 3; cx++) {
      const c = gen.generateChunk(cx, cx);
      for (const id of c.blocks) if (getBlock(id).name.endsWith('_ore')) ores.add(id);
    }
    expect(ores.has(B.COAL_ORE)).toBe(true);
    expect(ores.has(B.IRON_ORE)).toBe(true);
  });

  it('finds a dry spawn column', () => {
    const gen = new TerrainGenerator('spawn');
    const spawn = gen.findSpawnColumn();
    expect(spawn.height).toBeGreaterThanOrEqual(SEA_LEVEL + 1);
  });

  it('flat worlds are flat', () => {
    const gen = new TerrainGenerator('x', 'flat');
    expect(gen.getColumn(100, -300).height).toBe(gen.getColumn(-5, 7).height);
  });
});
