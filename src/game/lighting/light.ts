import { getLightEmission, LIGHT_FILTER, TRANSPARENT } from '../blocks/registry';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../world/constants';

/**
 * Light propagation over a 3x3 chunk neighbourhood (48 x 128 x 48 voxels).
 * Sky light falls straight down from the top of the world and then spreads
 * sideways; block light spreads from emitters (glowstone, lamps). Both lose
 * one level per block. Only the centre chunk's light is used for meshing,
 * but neighbours are included so light crosses chunk borders seamlessly.
 */

export const REGION = CHUNK_SIZE * 3;
const AREA = REGION * REGION;
export const REGION_VOLUME = AREA * WORLD_HEIGHT;

export function regionIndex(x: number, y: number, z: number): number {
  return (y * REGION + z) * REGION + x;
}

export interface LightField {
  sky: Uint8Array;
  block: Uint8Array;
}

/**
 * @param blocks block ids for the region, indexed with regionIndex
 * @param meta   metadata for the region
 */
export function computeLight(blocks: Uint8Array, meta: Uint8Array): LightField {
  const sky = new Uint8Array(REGION_VOLUME);
  const block = new Uint8Array(REGION_VOLUME);
  const queue = new Int32Array(REGION_VOLUME);

  // 1. Direct sky light, column by column.
  for (let z = 0; z < REGION; z++) {
    for (let x = 0; x < REGION; x++) {
      let level = 15;
      for (let y = WORLD_HEIGHT - 1; y >= 0 && level > 0; y--) {
        const i = (y * REGION + z) * REGION + x;
        const id = blocks[i];
        if (!TRANSPARENT[id]) {
          level = 0;
          break;
        }
        level -= LIGHT_FILTER[id];
        if (level <= 0) break;
        sky[i] = level;
      }
    }
  }

  // 2. Seed sideways spreading from lit cells next to darker transparent cells.
  let head = 0;
  let tail = 0;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < REGION; z++) {
      for (let x = 0; x < REGION; x++) {
        const i = (y * REGION + z) * REGION + x;
        const l = sky[i];
        if (l <= 1) continue;
        if (
          (x > 0 && sky[i - 1] < l - 1 && TRANSPARENT[blocks[i - 1]]) ||
          (x < REGION - 1 && sky[i + 1] < l - 1 && TRANSPARENT[blocks[i + 1]]) ||
          (z > 0 && sky[i - REGION] < l - 1 && TRANSPARENT[blocks[i - REGION]]) ||
          (z < REGION - 1 && sky[i + REGION] < l - 1 && TRANSPARENT[blocks[i + REGION]]) ||
          (y > 0 && sky[i - AREA] < l - 1 && TRANSPARENT[blocks[i - AREA]])
        ) {
          queue[tail++] = i;
        }
      }
    }
  }
  propagate(sky, blocks, queue, head, tail);

  // 3. Block light from emitters.
  tail = 0;
  for (let i = 0; i < REGION_VOLUME; i++) {
    const id = blocks[i];
    if (id === 0) continue;
    const e = getLightEmission(id, meta[i]);
    if (e > 0) {
      block[i] = e;
      queue[tail++] = i;
    }
  }
  propagate(block, blocks, queue, 0, tail);
  return { sky, block };
}

function propagate(light: Uint8Array, blocks: Uint8Array, queue: Int32Array, head: number, tail: number): void {
  const size = queue.length;
  let count = tail - head;
  const visit = (n: number, next: number) => {
    const id = blocks[n];
    if (!TRANSPARENT[id]) return;
    const value = next - LIGHT_FILTER[id];
    if (value > light[n] && count < size) {
      light[n] = value;
      queue[(head + count) % size] = n;
      count++;
    }
  };
  while (count > 0) {
    const i = queue[head];
    head = (head + 1) % size;
    count--;
    const l = light[i];
    if (l <= 1) continue;
    const x = i % REGION;
    const z = ((i / REGION) | 0) % REGION;
    const y = (i / AREA) | 0;
    const next = l - 1;
    if (x > 0) visit(i - 1, next);
    if (x < REGION - 1) visit(i + 1, next);
    if (z > 0) visit(i - REGION, next);
    if (z < REGION - 1) visit(i + REGION, next);
    if (y > 0) visit(i - AREA, next);
    if (y < WORLD_HEIGHT - 1) visit(i + AREA, next);
  }
}
