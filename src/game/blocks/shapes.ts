import { Face } from '../world/constants';
import { B } from './ids';
import { getFacing, getVariant, isActive } from './meta';
import { getBlock } from './registry';

/** Axis-aligned box in block-local coordinates: [x0, y0, z0, x1, y1, z1]. */
export type Box = readonly [number, number, number, number, number, number];

const FULL: Box = [0, 0, 0, 1, 1, 1];
const P = 1 / 16;

/**
 * Rotate a box defined for a block facing north (-Z) to the given horizontal
 * facing. Rotation is clockwise when viewed from above.
 */
export function rotateBox(box: Box, facing: number): Box {
  const [x0, y0, z0, x1, y1, z1] = box;
  switch (facing) {
    case Face.East:
      return [1 - z1, y0, x0, 1 - z0, y1, x1];
    case Face.South:
      return [1 - x1, y0, 1 - z1, 1 - x0, y1, 1 - z0];
    case Face.West:
      return [z0, y0, 1 - x1, z1, y1, 1 - x0];
    default:
      return box;
  }
}

/** Box for a thin part attached to the face `attach` points away from (buttons, levers). */
export function attachedBox(attach: number, w: number, h: number, depth: number): Box {
  const a = (1 - w) / 2;
  const b = (1 + w) / 2;
  const c = (1 - h) / 2;
  const d = (1 + h) / 2;
  switch (attach) {
    case Face.Up:
      return [a, 0, c, b, depth, d];
    case Face.Down:
      return [a, 1 - depth, c, b, 1, d];
    case Face.East:
      return [0, c, a, depth, d, b];
    case Face.West:
      return [1 - depth, c, a, 1, d, b];
    case Face.South:
      return [a, c, 0, b, d, depth];
    default:
      return [a, c, 1 - depth, b, d, 1];
  }
}

export function doorBox(meta: number): Box {
  const facing = getFacing(meta);
  const panel: Box = isActive(meta) ? [0, 0, 0, 3 * P, 1, 1] : [0, 0, 0, 1, 1, 3 * P];
  return rotateBox(panel, facing);
}

export function trapdoorBox(meta: number): Box {
  if (!isActive(meta)) return [0, 0, 0, 1, 3 * P, 1];
  return rotateBox([0, 0, 1 - 3 * P, 1, 1, 1], getFacing(meta));
}

export function slabBox(meta: number): Box {
  return getVariant(meta) & 1 ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
}

export function stairBoxes(meta: number): Box[] {
  return [[0, 0, 0, 1, 0.5, 1], rotateBox([0, 0.5, 0, 1, 1, 0.5], getFacing(meta))];
}

/** Boxes the player collides with. Empty for non-solid blocks. */
export function getCollisionBoxes(id: number, meta: number): readonly Box[] {
  const def = getBlock(id);
  if (!def.solid) return NONE;
  switch (def.shape) {
    case 'cube':
    case 'pistonArm':
      return FULL_LIST;
    case 'slab':
      return [slabBox(meta)];
    case 'stairs':
      return stairBoxes(meta);
    case 'fence':
      return FENCE_COLLISION;
    case 'door':
      return [doorBox(meta)];
    case 'trapdoor':
      return [trapdoorBox(meta)];
    case 'gate':
      return GATE_LIST;
    case 'cactus':
      return CACTUS_LIST;
    default:
      return FULL_LIST;
  }
}

/** Boxes used for crosshair targeting and the selection outline. */
export function getSelectionBoxes(id: number, meta: number): readonly Box[] {
  const def = getBlock(id);
  if (!def.targetable) return NONE;
  switch (def.shape) {
    case 'cross':
      return CROSS_LIST;
    case 'wire':
      return WIRE_LIST;
    case 'plate':
      return [isActive(meta) ? [P, 0, P, 1 - P, P / 2, 1 - P] : [P, 0, P, 1 - P, P, 1 - P]];
    case 'button':
      return [attachedBox(getFacing(meta), 6 * P, 4 * P, isActive(meta) ? P : 2 * P)];
    case 'lever':
      return [attachedBox(getFacing(meta), 6 * P, 8 * P, 6 * P)];
    case 'fence':
      return FENCE_SELECTION;
    default:
      return getCollisionBoxes(id, meta).length ? getCollisionBoxes(id, meta) : FULL_LIST;
  }
}

const NONE: readonly Box[] = [];
const FULL_LIST: readonly Box[] = [FULL];
const GATE_LIST: readonly Box[] = [[0, 0, 0, 1, 2 * P, 1]];
const CACTUS_LIST: readonly Box[] = [[P, 0, P, 1 - P, 1, 1 - P]];
const CROSS_LIST: readonly Box[] = [[2 * P, 0, 2 * P, 14 * P, 13 * P, 14 * P]];
const WIRE_LIST: readonly Box[] = [[0, 0, 0, 1, P, 1]];
const FENCE_COLLISION: readonly Box[] = [[0.25, 0, 0.25, 0.75, 1.5, 0.75]];
const FENCE_SELECTION: readonly Box[] = [[0.375, 0, 0.375, 0.625, 1, 0.625]];

/** Blocks whose stored facing must stay attached to a supporting block. */
export function needsSupport(id: number): boolean {
  return (
    id === B.BUTTON ||
    id === B.LEVER ||
    id === B.PRESSURE_PLATE ||
    id === B.WIRE ||
    id === B.TALL_GRASS ||
    id === B.FLOWER ||
    id === B.DOOR ||
    getBlock(id).shape === 'gate'
  );
}
