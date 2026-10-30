import { B } from '../blocks/ids';
import { getSelectionBoxes, type Box } from '../blocks/shapes';
import { UNLOADED, type BlockAccess } from './blockAccess';
import { Face, type FaceId } from './constants';

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  id: number;
  meta: number;
  face: FaceId;
  distance: number;
  /** Exact world-space hit point. */
  point: [number, number, number];
}

/** Ray/box slab test. Returns entry distance and face, or null. */
function intersectBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  bx: number,
  by: number,
  bz: number,
  box: Box,
): { t: number; face: FaceId } | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  let face: FaceId = Face.Up;
  const mins = [bx + box[0], by + box[1], bz + box[2]];
  const maxs = [bx + box[3], by + box[4], bz + box[5]];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const negFaces: FaceId[] = [Face.West, Face.Down, Face.North];
  const posFaces: FaceId[] = [Face.East, Face.Up, Face.South];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < mins[a] || o[a] > maxs[a]) return null;
      continue;
    }
    let t1 = (mins[a] - o[a]) / d[a];
    let t2 = (maxs[a] - o[a]) / d[a];
    let enterFace = negFaces[a];
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      enterFace = posFaces[a];
    }
    if (t1 > tMin) {
      tMin = t1;
      face = enterFace;
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return { t: Math.max(0, tMin), face };
}

/**
 * Voxel traversal (Amanatides & Woo) that tests each block's selection boxes,
 * so slabs, buttons and wires can be targeted precisely.
 */
export function raycastBlocks(
  world: BlockAccess,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  maxDistance: number,
): RaycastHit | null {
  const [ox, oy, oz] = origin;
  const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const dx = direction[0] / len;
  const dy = direction[1] / len;
  const dz = direction[2] / len;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;

  let t = 0;
  while (t <= maxDistance) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && id !== UNLOADED) {
      const meta = world.getMeta(x, y, z);
      let best: { t: number; face: FaceId } | null = null;
      for (const box of getSelectionBoxes(id, meta)) {
        const hit = intersectBox(ox, oy, oz, dx, dy, dz, x, y, z, box);
        if (hit && (!best || hit.t < best.t)) best = hit;
      }
      if (best && best.t <= maxDistance) {
        return {
          x,
          y,
          z,
          id,
          meta,
          face: best.face,
          distance: best.t,
          point: [ox + dx * best.t, oy + dy * best.t, oz + dz * best.t],
        };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}
