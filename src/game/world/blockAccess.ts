import { Chunk } from '../chunks/chunk';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';
import { chunkKey, localIndex, toChunkCoord } from './coords';

/** Returned by getBlock for positions inside chunks that are not loaded yet. */
export const UNLOADED = 255;

/** Read-only voxel access shared by physics, raycasting and simulation. */
export interface BlockAccess {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

/** A simple map of loaded chunks implementing BlockAccess. */
export class ChunkStore implements BlockAccess {
  readonly chunks = new Map<string, Chunk>();

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
  }

  deleteChunk(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return UNLOADED;
    if (y >= WORLD_HEIGHT) return 0;
    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    if (!chunk) return UNLOADED;
    return chunk.blocks[localIndex(Math.floor(x) & (CHUNK_SIZE - 1), Math.floor(y), Math.floor(z) & (CHUNK_SIZE - 1))];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    if (!chunk) return 0;
    return chunk.meta[localIndex(Math.floor(x) & (CHUNK_SIZE - 1), Math.floor(y), Math.floor(z) & (CHUNK_SIZE - 1))];
  }

  /** Write a block into a loaded chunk. Returns false if the chunk is missing. */
  setBlock(x: number, y: number, z: number, id: number, meta = 0): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const chunk = this.chunks.get(chunkKey(toChunkCoord(x), toChunkCoord(z)));
    if (!chunk) return false;
    chunk.setBlock(Math.floor(x) & (CHUNK_SIZE - 1), Math.floor(y), Math.floor(z) & (CHUNK_SIZE - 1), id, meta);
    return true;
  }
}
