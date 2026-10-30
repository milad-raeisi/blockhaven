import { getBlock } from '../blocks/registry';
import { ATLAS_TILES_PER_ROW, tileIndex, TILE_PIXELS, type TileName } from '../blocks/tiles';
import { getItemIconTiles, isBlockItem } from '../items/items';
import { getAtlasCanvas } from './textures';

const ICON_SIZE = 64;
const cache = new Map<number, string>();

function tileSource(name: TileName): [number, number] {
  const i = tileIndex(name);
  return [(i % ATLAS_TILES_PER_ROW) * TILE_PIXELS, Math.floor(i / ATLAS_TILES_PER_ROW) * TILE_PIXELS];
}

/** Draw one face of an isometric cube using an affine transform. */
function drawFace(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  tile: TileName,
  m: [number, number, number, number, number, number],
  brightness: number,
  heightFraction = 1,
): void {
  const [sx, sy] = tileSource(tile);
  ctx.save();
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  const srcH = TILE_PIXELS * heightFraction;
  ctx.drawImage(atlas, sx, sy + (TILE_PIXELS - srcH), TILE_PIXELS, srcH, 0, 1 - heightFraction, 1, heightFraction);
  if (brightness < 1) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${1 - brightness})`;
    ctx.fillRect(0, 1 - heightFraction, 1, heightFraction);
  }
  ctx.restore();
}

/** Data URL of an inventory icon for an item or block (cached). */
export function getItemIcon(id: number): string {
  const cached = cache.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const atlas = getAtlasCanvas();
  const tiles = getItemIconTiles(id);
  const shape = isBlockItem(id) ? getBlock(id).shape : 'none';

  const flat = !isBlockItem(id) || ['cross', 'wire', 'button', 'lever', 'plate', 'door'].includes(shape);
  if (flat) {
    const tile = tiles.flat ?? (shape === 'lever' ? 'lever_handle' : shape === 'wire' ? 'wire_on' : tiles.side);
    const [sx, sy] = tileSource(tile);
    const pad = shape === 'button' || shape === 'plate' ? 16 : 6;
    ctx.drawImage(atlas, sx, sy, TILE_PIXELS, TILE_PIXELS, pad, pad, ICON_SIZE - pad * 2, ICON_SIZE - pad * 2);
  } else {
    const s = ICON_SIZE;
    const h = shape === 'slab' || shape === 'trapdoor' ? 0.5 : shape === 'gate' ? 0.25 : 1;
    const w = s * 0.45; // half width of the cube projection
    const q = s * 0.225; // vertical offset of the top diamond
    const cx = s / 2;
    const top = s * 0.08 + (1 - h) * q * 2;
    // Top face (parallelogram mapped from the unit square).
    drawFace(ctx, atlas, tiles.top, [w, q, -w, q, cx, top], 1);
    // Left face.
    const faceH = w * 1.15 * h;
    drawFace(ctx, atlas, tiles.front, [w, q, 0, faceH, cx - w, top + q], 0.78, 1);
    // Right face.
    drawFace(ctx, atlas, tiles.side, [w, -q, 0, faceH, cx, top + q * 2], 0.6, 1);
  }
  const url = canvas.toDataURL();
  cache.set(id, url);
  return url;
}
