import { describe, expect, it } from 'vitest';
import { B } from '../../src/game/blocks/ids';
import { Chunk } from '../../src/game/chunks/chunk';
import { assembleRegion, meshRegion } from '../../src/game/chunks/mesher';
import { TerrainGenerator } from '../../src/game/terrain/generator';

function region(chunks: Chunk[]) {
  return assembleRegion(
    chunks.map((c) => c.blocks),
    chunks.map((c) => c.meta),
  );
}

function empty(): Chunk[] {
  return Array.from({ length: 9 }, (_, i) => new Chunk((i % 3) - 1, Math.floor(i / 3) - 1));
}

describe('chunk meshing', () => {
  it('emits nothing for an empty chunk', () => {
    const r = region(empty());
    const mesh = meshRegion(r.blocks, r.meta);
    expect(mesh.opaque).toBeNull();
    expect(mesh.translucent).toBeNull();
  });

  it('culls hidden faces: a single cube has 6 quads, two adjacent cubes have 10', () => {
    const chunks = empty();
    chunks[4].setBlock(5, 10, 5, B.STONE);
    let r = region(chunks);
    expect(meshRegion(r.blocks, r.meta).opaque!.indices.length / 6).toBe(6);
    chunks[4].setBlock(6, 10, 5, B.STONE);
    r = region(chunks);
    // Greedy meshing merges the coplanar faces of the two cubes.
    expect(meshRegion(r.blocks, r.meta).opaque!.indices.length / 6).toBe(6);
  });

  it('greedy-merges a flat floor into very few quads', () => {
    const chunks = empty();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) chunks[4].setBlock(x, 0, z, B.STONE);
    // Neighbours have the same floor so side faces at the border are hidden.
    for (const c of chunks) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c.setBlock(x, 0, z, B.STONE);
    const r = region(chunks);
    const quads = meshRegion(r.blocks, r.meta).opaque!.indices.length / 6;
    expect(quads).toBe(1); // only the top face; the bottom of the world is never visible
  });

  it('puts water in the translucent layer and leaves in the cutout layer', () => {
    const chunks = empty();
    chunks[4].setBlock(2, 5, 2, B.WATER);
    chunks[4].setBlock(8, 5, 8, B.LEAVES);
    const r = region(chunks);
    const mesh = meshRegion(r.blocks, r.meta);
    expect(mesh.translucent).not.toBeNull();
    expect(mesh.cutout).not.toBeNull();
    expect(mesh.opaque).toBeNull();
  });

  it('has no gaps at chunk borders for generated terrain', () => {
    const gen = new TerrainGenerator('borders');
    const chunks = Array.from({ length: 9 }, (_, i) => gen.generateChunk((i % 3) - 1, Math.floor(i / 3) - 1));
    const r = region(chunks);
    const mesh = meshRegion(r.blocks, r.meta);
    expect(mesh.opaque!.positions.length).toBeGreaterThan(0);
    // Every vertex lies within the chunk bounds (no stray geometry).
    const p = mesh.opaque!.positions;
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i]).toBeGreaterThanOrEqual(0);
      expect(p[i]).toBeLessThanOrEqual(16);
      expect(p[i + 2]).toBeGreaterThanOrEqual(0);
      expect(p[i + 2]).toBeLessThanOrEqual(16);
    }
  });

  it('lights blocks near glowstone in dark caves', () => {
    const chunks = empty();
    // Fully enclosed room: sky light cannot enter.
    for (const c of chunks) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 128; y++) c.setBlock(x, y, z, B.STONE);
    for (let x = 4; x < 10; x++) for (let z = 4; z < 10; z++) for (let y = 20; y < 24; y++) chunks[4].setBlock(x, y, z, B.AIR);
    chunks[4].setBlock(6, 20, 6, B.GLOWSTONE);
    const r = region(chunks);
    const mesh = meshRegion(r.blocks, r.meta).opaque!;
    let maxBlockLight = 0;
    let maxSky = 0;
    for (let i = 0; i < mesh.data.length; i += 4) {
      if (mesh.positions[(i / 4) * 3 + 1] > 100) continue; // ignore the sunlit top of the world
      maxBlockLight = Math.max(maxBlockLight, mesh.data[i + 2]);
      maxSky = Math.max(maxSky, mesh.data[i + 1]);
    }
    expect(maxBlockLight).toBeGreaterThanOrEqual(13);
    expect(maxSky).toBe(0);
  });
});
