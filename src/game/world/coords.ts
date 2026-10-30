import { CHUNK_SHIFT, CHUNK_SIZE, WORLD_HEIGHT } from './constants';

export type ChunkKey = string;

export function chunkKey(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: ChunkKey): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/** World block coordinate to chunk coordinate. */
export function toChunkCoord(v: number): number {
  return Math.floor(v) >> CHUNK_SHIFT;
}

/** World block coordinate to the local coordinate inside its chunk (0..15). */
export function toLocalCoord(v: number): number {
  return Math.floor(v) & (CHUNK_SIZE - 1);
}

/** Index of a local block position inside a chunk's flat storage arrays. */
export function localIndex(lx: number, y: number, lz: number): number {
  return (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
}

export function indexToLocal(index: number): [number, number, number] {
  const lx = index & (CHUNK_SIZE - 1);
  const lz = (index >> CHUNK_SHIFT) & (CHUNK_SIZE - 1);
  const y = index >> (CHUNK_SHIFT * 2);
  return [lx, y, lz];
}

export function isValidY(y: number): boolean {
  return y >= 0 && y < WORLD_HEIGHT;
}

/** Integer block position key, used for maps of block entities. */
export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function chunkDistanceSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
