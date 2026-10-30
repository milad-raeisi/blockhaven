import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../world/constants';
import { localIndex } from '../world/coords';

/** One 16 x 128 x 16 column of voxels. Block ids and metadata are stored separately. */
export class Chunk {
  readonly blocks: Uint8Array;
  readonly meta: Uint8Array;

  constructor(
    readonly cx: number,
    readonly cz: number,
    blocks?: Uint8Array,
    meta?: Uint8Array,
  ) {
    this.blocks = blocks ?? new Uint8Array(CHUNK_VOLUME);
    this.meta = meta ?? new Uint8Array(CHUNK_VOLUME);
  }

  get originX(): number {
    return this.cx * CHUNK_SIZE;
  }

  get originZ(): number {
    return this.cz * CHUNK_SIZE;
  }

  getBlock(lx: number, y: number, lz: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[localIndex(lx, y, lz)];
  }

  getMeta(lx: number, y: number, lz: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.meta[localIndex(lx, y, lz)];
  }

  setBlock(lx: number, y: number, lz: number, id: number, meta = 0): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const i = localIndex(lx, y, lz);
    this.blocks[i] = id;
    this.meta[i] = meta;
  }

  /** Highest non-air block in a column, or -1. */
  getTopY(lx: number, lz: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (this.blocks[localIndex(lx, y, lz)] !== 0) return y;
    }
    return -1;
  }
}
