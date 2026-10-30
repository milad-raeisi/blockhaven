import { B } from '../blocks/ids';
import { getFacing, getVariant, getWirePower, isActive } from '../blocks/meta';
import { getBlock, getFaceTile, OCCLUDES, type BlockDefinition } from '../blocks/registry';
import { attachedBox, doorBox, slabBox, stairBoxes, trapdoorBox, type Box } from '../blocks/shapes';
import { tileIndex, type TileName } from '../blocks/tiles';
import { computeLight, REGION, regionIndex, type LightField } from '../lighting/light';
import { CHUNK_SIZE, Face, FACE_DIRS, WORLD_HEIGHT } from '../world/constants';

/**
 * Chunk mesh generation (runs inside a Web Worker).
 *
 * Full cubes are merged with greedy meshing per face direction; faces only
 * merge when texture, ambient occlusion and light match, so lighting stays
 * correct. Other shapes (slabs, stairs, doors, wires...) are emitted as small
 * boxes. Geometry is split into opaque, alpha-tested and translucent layers.
 *
 * Vertex format: position (f32x3), normal (i8x3), uv (f32x2, in tiles so the
 * shader can repeat textures across merged quads), data (u8x4: tile, sky
 * light, block light, ambient occlusion).
 */

export type LayerName = 'opaque' | 'cutout' | 'translucent';

export interface LayerGeometry {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  data: Uint8Array;
  indices: Uint32Array;
}

export type MeshOutput = Record<LayerName, LayerGeometry | null>;

class LayerBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  data: number[] = [];
  indices: number[] = [];
  vertexCount = 0;

  /** Add a quad. Corners must be counter-clockwise when seen from the front. */
  quad(
    corners: readonly (readonly [number, number, number])[],
    normal: readonly [number, number, number],
    uvs: readonly (readonly [number, number])[],
    tile: number,
    sky: number,
    block: number,
    ao: readonly number[],
  ): void {
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      this.positions.push(c[0], c[1], c[2]);
      this.normals.push(normal[0] * 127, normal[1] * 127, normal[2] * 127);
      this.uvs.push(uvs[i][0], uvs[i][1]);
      this.data.push(tile, sky, block, ao[i]);
    }
    // Flip the diagonal when needed so ambient occlusion interpolates smoothly.
    if (ao[0] + ao[2] < ao[1] + ao[3]) this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.vertexCount += 4;
  }

  build(): LayerGeometry | null {
    if (this.vertexCount === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      normals: new Int8Array(this.normals),
      uvs: new Float32Array(this.uvs),
      data: new Uint8Array(this.data),
      indices: new Uint32Array(this.indices),
    };
  }
}

interface MeshContext {
  blocks: Uint8Array;
  meta: Uint8Array;
  light: LightField;
  layers: Record<LayerName, LayerBuilder>;
}

const OFFSET = CHUNK_SIZE; // centre chunk starts at region x/z = 16
const FULL_AO = [3, 3, 3, 3] as const;
const P = 1 / 16;

function layerOf(def: BlockDefinition): LayerName | null {
  return def.renderLayer === 'none' ? null : def.renderLayer;
}

// --- Greedy meshing of full cubes ---------------------------------------------

/** Axis configuration per face: normal axis, u axis, v axis (0 = x, 1 = y, 2 = z). */
const FACE_AXES: Record<number, { a: number; u: number; v: number }> = {
  [Face.East]: { a: 0, u: 2, v: 1 },
  [Face.West]: { a: 0, u: 2, v: 1 },
  [Face.Up]: { a: 1, u: 0, v: 2 },
  [Face.Down]: { a: 1, u: 0, v: 2 },
  [Face.South]: { a: 2, u: 0, v: 1 },
  [Face.North]: { a: 2, u: 0, v: 1 },
};
const DIMS = [CHUNK_SIZE, WORLD_HEIGHT, CHUNK_SIZE];

function isGreedyCube(def: BlockDefinition): boolean {
  return def.shape === 'cube' && (def.renderLayer === 'opaque' || def.renderLayer === 'cutout');
}

function aoValue(side1: number, side2: number, corner: number): number {
  return side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
}

function meshCubes(ctx: MeshContext): void {
  const { blocks, meta, light } = ctx;
  const pos = [0, 0, 0];
  for (let face = 0; face < 6; face++) {
    const { a, u, v } = FACE_AXES[face];
    const n = FACE_DIRS[face];
    const dimU = DIMS[u];
    const dimV = DIMS[v];
    const mask = new Int32Array(dimU * dimV);
    const aoMask = new Uint8Array(dimU * dimV * 4);
    // Unit vectors of the u and v axes.
    const du = [0, 0, 0];
    du[u] = 1;
    const dv = [0, 0, 0];
    dv[v] = 1;
    const cross = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    const sameHanded = cross[0] === n[0] && cross[1] === n[1] && cross[2] === n[2];

    for (let k = 0; k < DIMS[a]; k++) {
      let any = false;
      for (let j = 0; j < dimV; j++) {
        for (let i = 0; i < dimU; i++) {
          pos[a] = k;
          pos[u] = i;
          pos[v] = j;
          const rx = pos[0] + OFFSET;
          const ry = pos[1];
          const rz = pos[2] + OFFSET;
          const idx = regionIndex(rx, ry, rz);
          const id = blocks[idx];
          const m = i + j * dimU;
          mask[m] = 0;
          if (id === 0) continue;
          const def = getBlock(id);
          if (!isGreedyCube(def)) continue;
          const nx = rx + n[0];
          const ny = ry + n[1];
          const nz = rz + n[2];
          let nid = 0;
          let nIdx = -1;
          if (ny >= 0 && ny < WORLD_HEIGHT) {
            nIdx = regionIndex(nx, ny, nz);
            nid = blocks[nIdx];
          } else if (ny < 0) {
            continue; // never visible from below the world
          }
          if (OCCLUDES[nid] || (nid === id && def.transparent)) continue;
          const tile = tileIndex(getFaceTile(id, meta[idx], face));
          const sky = nIdx >= 0 ? light.sky[nIdx] : 15;
          const blk = nIdx >= 0 ? light.block[nIdx] : 0;
          // Ambient occlusion at the four corners of this face.
          let aoBits = 0;
          for (let c = 0; c < 4; c++) {
            const su = c === 1 || c === 2 ? 1 : -1;
            const sv = c === 2 || c === 3 ? 1 : -1;
            const o1 = occludesAt(blocks, nx + du[0] * su, ny + du[1] * su, nz + du[2] * su);
            const o2 = occludesAt(blocks, nx + dv[0] * sv, ny + dv[1] * sv, nz + dv[2] * sv);
            const oc = occludesAt(blocks, nx + du[0] * su + dv[0] * sv, ny + du[1] * su + dv[1] * sv, nz + du[2] * su + dv[2] * sv);
            const value = aoValue(o1, o2, oc);
            aoMask[m * 4 + c] = value;
            aoBits |= value << (c * 2);
          }
          const layerBit = def.renderLayer === 'cutout' ? 1 : 0;
          // tile (7 bits) | ao (8 bits) | sky (4) | block (4) | layer (1); +1 so 0 means "empty".
          mask[m] = 1 + (tile | (aoBits << 7) | (sky << 15) | (blk << 19) | (layerBit << 23));
          any = true;
        }
      }
      if (!any) continue;

      // Greedy merge of identical mask cells into rectangles.
      for (let j = 0; j < dimV; j++) {
        for (let i = 0; i < dimU; ) {
          const key = mask[i + j * dimU];
          if (key === 0) {
            i++;
            continue;
          }
          let w = 1;
          while (i + w < dimU && mask[i + w + j * dimU] === key) w++;
          let h = 1;
          outer: while (j + h < dimV) {
            for (let x = 0; x < w; x++) if (mask[i + x + (j + h) * dimU] !== key) break outer;
            h++;
          }
          const m = i + j * dimU;
          const ao = [aoMask[m * 4], aoMask[m * 4 + 1], aoMask[m * 4 + 2], aoMask[m * 4 + 3]];
          emitGreedyQuad(ctx, face, a, u, v, k, i, j, w, h, key - 1, ao, sameHanded);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[i + x + (j + y) * dimU] = 0;
          i += w;
        }
      }
    }
  }
}

function occludesAt(blocks: Uint8Array, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT || x < 0 || z < 0 || x >= REGION || z >= REGION) return 0;
  return OCCLUDES[blocks[regionIndex(x, y, z)]];
}

function emitGreedyQuad(
  ctx: MeshContext,
  face: number,
  a: number,
  u: number,
  v: number,
  k: number,
  i: number,
  j: number,
  w: number,
  h: number,
  key: number,
  ao: number[],
  sameHanded: boolean,
): void {
  const tile = key & 0x7f;
  const sky = (key >> 15) & 0xf;
  const blk = (key >> 19) & 0xf;
  const layer: LayerName = (key >> 23) & 1 ? 'cutout' : 'opaque';
  const n = FACE_DIRS[face];
  const plane = k + (n[a] > 0 ? 1 : 0);
  const corner = (cu: number, cv: number): [number, number, number] => {
    const p: [number, number, number] = [0, 0, 0];
    p[a] = plane;
    p[u] = i + cu;
    p[v] = j + cv;
    return p;
  };
  // Corner order in (u, v): (0,0), (w,0), (w,h), (0,h)
  const c = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
  // Texture coordinates: v runs downward in the image, so side faces map world-up to image-up.
  const vertical = v === 1;
  const uvs: [number, number][] = vertical
    ? [
        [0, h],
        [w, h],
        [w, 0],
        [0, 0],
      ]
    : [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ];
  if (sameHanded) ctx.layers[layer].quad(c, n, uvs, tile, sky, blk, ao);
  else ctx.layers[layer].quad([c[0], c[3], c[2], c[1]], n, [uvs[0], uvs[3], uvs[2], uvs[1]], tile, sky, blk, [ao[0], ao[3], ao[2], ao[1]]);
}

// --- Box shapes -------------------------------------------------------------------

/** UVs for a face of a box, as sub-rectangles of the tile. */
function boxFace(
  layer: LayerBuilder,
  x: number,
  y: number,
  z: number,
  box: Box,
  face: number,
  tile: number,
  sky: number,
  blk: number,
  topRotation = -1,
): void {
  const [x0, y0, z0, x1, y1, z1] = box;
  const X0 = x + x0;
  const X1 = x + x1;
  const Y0 = y + y0;
  const Y1 = y + y1;
  const Z0 = z + z0;
  const Z1 = z + z1;
  const n = FACE_DIRS[face];
  let corners: [number, number, number][];
  let uvs: [number, number][];
  switch (face) {
    case Face.East:
      corners = [[X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1]];
      uvs = [[1 - z1, 1 - y0], [1 - z0, 1 - y0], [1 - z0, 1 - y1], [1 - z1, 1 - y1]];
      break;
    case Face.West:
      corners = [[X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0]];
      uvs = [[z0, 1 - y0], [z1, 1 - y0], [z1, 1 - y1], [z0, 1 - y1]];
      break;
    case Face.South:
      corners = [[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1]];
      uvs = [[x0, 1 - y0], [x1, 1 - y0], [x1, 1 - y1], [x0, 1 - y1]];
      break;
    case Face.North:
      corners = [[X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0]];
      uvs = [[1 - x1, 1 - y0], [1 - x0, 1 - y0], [1 - x0, 1 - y1], [1 - x1, 1 - y1]];
      break;
    case Face.Up:
      corners = [[X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0]];
      uvs = [topUv(x0, z1, topRotation), topUv(x1, z1, topRotation), topUv(x1, z0, topRotation), topUv(x0, z0, topRotation)];
      break;
    default:
      corners = [[X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1]];
      uvs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      break;
  }
  // Keep UVs strictly inside the tile so `fract` in the shader does not wrap.
  const clamped = uvs.map(([uu, vv]) => [clampUv(uu), clampUv(vv)] as [number, number]);
  layer.quad(corners, n, clamped, tile, sky, blk, FULL_AO);
}

function clampUv(v: number): number {
  return Math.min(0.999, Math.max(0.001, v));
}

/** Top-face UVs rotated so directional textures point toward the block's facing. */
function topUv(x: number, z: number, facing: number): [number, number] {
  switch (facing) {
    case Face.East:
      return [z, 1 - x];
    case Face.South:
      return [1 - x, 1 - z];
    case Face.West:
      return [1 - z, x];
    default:
      return [x, z];
  }
}

/** Map a box defined for an "up"-facing part to any of the six directions. */
function orientBox(box: Box, facing: number): Box {
  const [x0, y0, z0, x1, y1, z1] = box;
  const map = (x: number, y: number, z: number): [number, number, number] => {
    switch (facing) {
      case Face.Down:
        return [x, 1 - y, z];
      case Face.South:
        return [x, z, y];
      case Face.North:
        return [x, z, 1 - y];
      case Face.East:
        return [y, x, z];
      case Face.West:
        return [1 - y, x, z];
      default:
        return [x, y, z];
    }
  };
  const a = map(x0, y0, z0);
  const b = map(x1, y1, z1);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
}

function onBoundary(box: Box, face: number): boolean {
  switch (face) {
    case Face.East:
      return box[3] >= 1;
    case Face.West:
      return box[0] <= 0;
    case Face.Up:
      return box[4] >= 1;
    case Face.Down:
      return box[1] <= 0;
    case Face.South:
      return box[5] >= 1;
    default:
      return box[2] <= 0;
  }
}

type NeighbourFn = (face: number) => number;

function emitBoxes(
  ctx: MeshContext,
  layerName: LayerName,
  x: number,
  y: number,
  z: number,
  boxes: readonly Box[],
  tileFor: (face: number) => TileName,
  neighbour: NeighbourFn,
  sky: number,
  blk: number,
  topRotation = -1,
): void {
  const layer = ctx.layers[layerName];
  for (const box of boxes) {
    for (let face = 0; face < 6; face++) {
      if (onBoundary(box, face) && OCCLUDES[neighbour(face)]) continue;
      boxFace(layer, x, y, z, box, face, tileIndex(tileFor(face)), sky, blk, face === Face.Up ? topRotation : -1);
    }
  }
}

function fenceConnects(id: number): boolean {
  return id === B.FENCE || OCCLUDES[id] === 1;
}

function wireConnects(id: number): boolean {
  return id !== 0 && getBlock(id).circuit !== 'none';
}

function meshSpecial(ctx: MeshContext, lx: number, y: number, lz: number, id: number, metaValue: number, def: BlockDefinition): void {
  const layerName = layerOf(def);
  if (!layerName) return;
  const rx = lx + OFFSET;
  const rz = lz + OFFSET;
  const idx = regionIndex(rx, y, rz);
  const blocks = ctx.blocks;
  const neighbour: NeighbourFn = (face) => {
    const [dx, dy, dz] = FACE_DIRS[face];
    const ny = y + dy;
    if (ny < 0 || ny >= WORLD_HEIGHT) return 0;
    return blocks[regionIndex(rx + dx, ny, rz + dz)];
  };
  const sky = ctx.light.sky[idx];
  const blk = Math.max(ctx.light.block[idx], 0);
  const tileFor = (face: number) => getFaceTile(id, metaValue, face);
  const facing = getFacing(metaValue);

  switch (def.shape) {
    case 'slab':
      emitBoxes(ctx, layerName, lx, y, lz, [slabBox(metaValue)], tileFor, neighbour, sky, blk);
      return;
    case 'stairs':
      emitBoxes(ctx, layerName, lx, y, lz, stairBoxes(metaValue), tileFor, neighbour, sky, blk);
      return;
    case 'cactus':
      emitBoxes(ctx, layerName, lx, y, lz, [[P, 0, P, 1 - P, 1, 1 - P]], tileFor, neighbour, sky, blk);
      return;
    case 'door':
      emitBoxes(ctx, layerName, lx, y, lz, [doorBox(metaValue)], () => 'door', neighbour, sky, blk);
      return;
    case 'trapdoor':
      emitBoxes(ctx, layerName, lx, y, lz, [trapdoorBox(metaValue)], tileFor, neighbour, sky, blk);
      return;
    case 'fence': {
      const boxes: Box[] = [[6 * P, 0, 6 * P, 10 * P, 1, 10 * P]];
      const arms: [number, Box, Box][] = [
        [Face.North, [7 * P, 6 * P, 0, 9 * P, 9 * P, 6 * P], [7 * P, 12 * P, 0, 9 * P, 15 * P, 6 * P]],
        [Face.South, [7 * P, 6 * P, 10 * P, 9 * P, 9 * P, 1], [7 * P, 12 * P, 10 * P, 9 * P, 15 * P, 1]],
        [Face.West, [0, 6 * P, 7 * P, 6 * P, 9 * P, 9 * P], [0, 12 * P, 7 * P, 6 * P, 15 * P, 9 * P]],
        [Face.East, [10 * P, 6 * P, 7 * P, 1, 9 * P, 9 * P], [10 * P, 12 * P, 7 * P, 1, 15 * P, 9 * P]],
      ];
      for (const [face, low, high] of arms) if (fenceConnects(neighbour(face))) boxes.push(low, high);
      emitBoxes(ctx, layerName, lx, y, lz, boxes, tileFor, neighbour, sky, blk);
      return;
    }
    case 'wire': {
      const h = P;
      const boxes: Box[] = [[6 * P, 0, 6 * P, 10 * P, h, 10 * P]];
      const sides: [number, Box][] = [
        [Face.North, [7 * P, 0, 0, 9 * P, h, 6 * P]],
        [Face.South, [7 * P, 0, 10 * P, 9 * P, h, 1]],
        [Face.West, [0, 0, 7 * P, 6 * P, h, 9 * P]],
        [Face.East, [10 * P, 0, 7 * P, 1, h, 9 * P]],
      ];
      let connected = 0;
      for (const [face, box] of sides) {
        const [dx, , dz] = FACE_DIRS[face];
        const above = y + 1 < WORLD_HEIGHT ? blocks[regionIndex(rx + dx, y + 1, rz + dz)] : 0;
        const below = y > 0 ? blocks[regionIndex(rx + dx, y - 1, rz + dz)] : 0;
        if (wireConnects(neighbour(face)) || above === B.WIRE || below === B.WIRE) {
          boxes.push(box);
          connected++;
        }
      }
      if (connected === 0) boxes.push(sides[0][1], sides[1][1], sides[2][1], sides[3][1]);
      const tile: TileName = getWirePower(metaValue) > 0 ? 'wire_on' : 'wire_off';
      emitBoxes(ctx, layerName, lx, y, lz, boxes, () => tile, neighbour, sky, blk);
      return;
    }
    case 'plate': {
      const box: Box = isActive(metaValue) ? [P, 0, P, 1 - P, P / 2, 1 - P] : [P, 0, P, 1 - P, P, 1 - P];
      emitBoxes(ctx, layerName, lx, y, lz, [box], tileFor, neighbour, sky, blk);
      return;
    }
    case 'button':
      emitBoxes(ctx, layerName, lx, y, lz, [attachedBox(facing, 6 * P, 4 * P, isActive(metaValue) ? P : 2 * P)], tileFor, neighbour, sky, blk);
      return;
    case 'lever': {
      const base = attachedBox(facing, 6 * P, 8 * P, 3 * P);
      const on = isActive(metaValue);
      // Handle defined for a floor lever, then oriented to the attachment face.
      const handle: Box = on ? [7 * P, 3 * P, 9 * P, 9 * P, 11 * P, 11 * P] : [7 * P, 3 * P, 5 * P, 9 * P, 11 * P, 7 * P];
      emitBoxes(ctx, layerName, lx, y, lz, [base], () => 'lever_base', neighbour, sky, blk);
      emitBoxes(ctx, layerName, lx, y, lz, [orientBox(handle, facing)], () => 'lever_handle', neighbour, sky, blk);
      return;
    }
    case 'gate':
      emitBoxes(ctx, layerName, lx, y, lz, [[0, 0, 0, 1, 2 * P, 1]], tileFor, neighbour, sky, blk, facing);
      return;
    case 'pistonArm': {
      const head = (getVariant(metaValue) & 1) === 1;
      const boxes: Box[] = head
        ? [orientBox([6 * P, 0, 6 * P, 10 * P, 12 * P, 10 * P], facing), orientBox([0, 12 * P, 0, 1, 1, 1], facing)]
        : [orientBox([6 * P, 0, 6 * P, 10 * P, 1, 10 * P], facing)];
      emitBoxes(ctx, layerName, lx, y, lz, boxes, (face) => (head && face === facing ? 'piston_front' : 'piston_arm'), neighbour, sky, blk);
      return;
    }
    case 'cross': {
      const layer = ctx.layers[layerName];
      const tile = tileIndex(tileFor(Face.North));
      const a = 0.15;
      const b = 0.85;
      const top = 0.9;
      const quads: [number, number, number, number][] = [
        [a, a, b, b],
        [a, b, b, a],
      ];
      for (const [x0, z0, x1, z1] of quads) {
        layer.quad(
          [
            [lx + x0, y, lz + z0],
            [lx + x1, y, lz + z1],
            [lx + x1, y + top, lz + z1],
            [lx + x0, y + top, lz + z0],
          ],
          [0, 1, 0],
          [
            [0.001, 0.999],
            [0.999, 0.999],
            [0.999, 0.1],
            [0.001, 0.1],
          ],
          tile,
          sky,
          blk,
          FULL_AO,
        );
      }
      return;
    }
    default:
      return;
  }
}

function meshLiquid(ctx: MeshContext, lx: number, y: number, lz: number, id: number): void {
  const rx = lx + OFFSET;
  const rz = lz + OFFSET;
  const blocks = ctx.blocks;
  const above = y + 1 < WORLD_HEIGHT ? blocks[regionIndex(rx, y + 1, rz)] : 0;
  const topHeight = above === id ? 1 : 14 / 16;
  const box: Box = [0, 0, 0, 1, topHeight, 1];
  const layer = ctx.layers.translucent;
  const tile = tileIndex('water');
  for (let face = 0; face < 6; face++) {
    const [dx, dy, dz] = FACE_DIRS[face];
    const ny = y + dy;
    if (ny < 0) continue;
    const nIdx = ny < WORLD_HEIGHT ? regionIndex(rx + dx, ny, rz + dz) : -1;
    const nid = nIdx >= 0 ? blocks[nIdx] : 0;
    if (nid === id) continue;
    if (OCCLUDES[nid] && !(face === Face.Up && topHeight < 1)) continue;
    const sky = nIdx >= 0 ? ctx.light.sky[nIdx] : 15;
    const blk = nIdx >= 0 ? ctx.light.block[nIdx] : 0;
    boxFace(layer, lx, y, lz, box, face, tile, Math.max(sky, ctx.light.sky[regionIndex(rx, y, rz)]), blk);
  }
}

/** Assemble the 48x128x48 region from a 3x3 neighbourhood of chunk arrays (index = (dz+1)*3 + (dx+1)). */
export function assembleRegion(chunkBlocks: Uint8Array[], chunkMeta: Uint8Array[]): { blocks: Uint8Array; meta: Uint8Array } {
  const blocks = new Uint8Array(REGION * REGION * WORLD_HEIGHT);
  const meta = new Uint8Array(REGION * REGION * WORLD_HEIGHT);
  for (let cz = 0; cz < 3; cz++) {
    for (let cx = 0; cx < 3; cx++) {
      const src = chunkBlocks[cz * 3 + cx];
      const srcMeta = chunkMeta[cz * 3 + cx];
      if (!src) continue;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          const from = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
          const to = regionIndex(cx * CHUNK_SIZE, y, cz * CHUNK_SIZE + z);
          blocks.set(src.subarray(from, from + CHUNK_SIZE), to);
          meta.set(srcMeta.subarray(from, from + CHUNK_SIZE), to);
        }
      }
    }
  }
  return { blocks, meta };
}

/** Build the mesh for the centre chunk of a region. */
export function meshRegion(blocks: Uint8Array, meta: Uint8Array): MeshOutput {
  const ctx: MeshContext = {
    blocks,
    meta,
    light: computeLight(blocks, meta),
    layers: { opaque: new LayerBuilder(), cutout: new LayerBuilder(), translucent: new LayerBuilder() },
  };
  meshCubes(ctx);
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = regionIndex(lx + OFFSET, y, lz + OFFSET);
        const id = blocks[idx];
        if (id === 0) continue;
        const def = getBlock(id);
        if (def.shape === 'cube' && def.renderLayer !== 'translucent') continue;
        if (def.shape === 'liquid') meshLiquid(ctx, lx, y, lz, id);
        else meshSpecial(ctx, lx, y, lz, id, meta[idx], def);
      }
    }
  }
  return { opaque: ctx.layers.opaque.build(), cutout: ctx.layers.cutout.build(), translucent: ctx.layers.translucent.build() };
}

/** Geometry for a single block rendered as an item (held in hand), fully lit. */
export function meshItem(id: number): MeshOutput {
  const blocks = new Uint8Array(REGION * REGION * WORLD_HEIGHT);
  const meta = new Uint8Array(REGION * REGION * WORLD_HEIGHT);
  const def = getBlock(id);
  const ctx: MeshContext = {
    blocks,
    meta,
    light: { sky: new Uint8Array(blocks.length).fill(15), block: new Uint8Array(blocks.length) },
    layers: { opaque: new LayerBuilder(), cutout: new LayerBuilder(), translucent: new LayerBuilder() },
  };
  const layerName = layerOf(def) ?? 'opaque';
  if (def.shape === 'cube' || def.shape === 'liquid') {
    emitBoxes(ctx, layerName, 0, 0, 0, [[0, 0, 0, 1, 1, 1]], (face) => getFaceTile(id, 0, face), () => 0, 15, 0);
  } else {
    blocks[regionIndex(OFFSET, 1, OFFSET)] = id;
    meshSpecial(ctx, 0, 1, 0, id, 0, def);
    // Shift the special shape back down to y = 0.
    for (const layer of Object.values(ctx.layers)) for (let i = 1; i < layer.positions.length; i += 3) layer.positions[i] -= 1;
  }
  return { opaque: ctx.layers.opaque.build(), cutout: ctx.layers.cutout.build(), translucent: ctx.layers.translucent.build() };
}
