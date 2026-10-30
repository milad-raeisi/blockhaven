import { mulberry32 } from '../terrain/random';
import { ATLAS_TILES_PER_ROW, TILE_NAMES, TILE_PIXELS, type TileName } from '../blocks/tiles';

/**
 * Procedurally painted, original 16x16 pixel-art textures. Every tile is drawn
 * from code with a seeded random generator, so the atlas is identical on every
 * device and no external image assets are needed.
 */

type RGB = [number, number, number];
type Pixels = Uint8ClampedArray;

const S = TILE_PIXELS;

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

class Painter {
  readonly px: Pixels = new Uint8ClampedArray(S * S * 4);
  constructor(readonly rand: () => number) {}

  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = a;
  }

  get(x: number, y: number): RGB {
    const i = (y * S + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2]];
  }

  alpha(x: number, y: number, a: number): void {
    this.px[(y * S + x) * 4 + 3] = a;
  }

  /** Fill with a base colour plus per-pixel brightness noise. */
  noise(base: RGB, variance: number, a = 255): void {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.set(x, y, shade(base, 1 + (this.rand() - 0.5) * variance), a);
  }

  speckle(color: RGB, density: number, variance = 0.15): void {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (this.rand() < density) this.set(x, y, shade(color, 1 + (this.rand() - 0.5) * variance));
  }

  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 255): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
  }

  frame(c: RGB, inset = 0): void {
    for (let i = inset; i < S - inset; i++) {
      this.set(i, inset, c);
      this.set(i, S - 1 - inset, c);
      this.set(inset, i, c);
      this.set(S - 1 - inset, i, c);
    }
  }

  clear(): void {
    this.px.fill(0);
  }

  /** Clusters of coloured pixels (ores). */
  clusters(color: RGB, count: number, size: number): void {
    for (let n = 0; n < count; n++) {
      const cx = 2 + Math.floor(this.rand() * (S - 4));
      const cy = 2 + Math.floor(this.rand() * (S - 4));
      for (let k = 0; k < size; k++) {
        const x = cx + Math.floor(this.rand() * 3) - 1;
        const y = cy + Math.floor(this.rand() * 3) - 1;
        this.set(x, y, shade(color, 0.85 + this.rand() * 0.3));
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      this.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
    }
  }
}

const C = {
  grass: hex('#5f9e3a'),
  dirt: hex('#86603f'),
  stone: hex('#7f7f83'),
  sand: hex('#dccf92'),
  snow: hex('#eef5fa'),
  water: hex('#3a6fd8'),
  bark: hex('#6b5034'),
  wood: hex('#b88b55'),
  leaves: hex('#3d8a2e'),
  plank: hex('#b38551'),
  brick: hex('#9c4a37'),
  mortar: hex('#cbbba8'),
  iron: hex('#c8cdd2'),
  red: hex('#d4342a'),
};

function paintPlanks(p: Painter, base: RGB): void {
  p.noise(base, 0.12);
  for (let row = 0; row < 4; row++) {
    const y = row * 4 + 3;
    for (let x = 0; x < S; x++) p.set(x, y, shade(base, 0.62));
    const seam = (row * 7 + 3) % S;
    for (let y2 = row * 4; y2 < row * 4 + 3; y2++) p.set(seam, y2, shade(base, 0.7));
    for (let k = 0; k < 3; k++) {
      const gx = Math.floor(p.rand() * S);
      p.set(gx, row * 4 + 1, shade(base, 0.85));
    }
  }
}

function paintBricks(p: Painter, brick: RGB, mortar: RGB, rowHeight: number, brickWidth: number): void {
  p.noise(brick, 0.14);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rowHeight);
    const offset = row % 2 === 0 ? 0 : brickWidth / 2;
    for (let x = 0; x < S; x++) {
      const isMortar = y % rowHeight === rowHeight - 1 || (x + offset) % brickWidth === 0;
      if (isMortar) p.set(x, y, shade(mortar, 0.95 + p.rand() * 0.1));
    }
  }
}

function paintCobble(p: Painter, base: RGB): void {
  const seeds: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) seeds.push([p.rand() * S, p.rand() * S, 0.8 + p.rand() * 0.35]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let best = Infinity;
      let second = Infinity;
      let bestShade = 1;
      for (const [sx, sy, sh] of seeds) {
        for (const ox of [-S, 0, S]) {
          for (const oy of [-S, 0, S]) {
            const d = Math.hypot(x - sx - ox, y - sy - oy);
            if (d < best) {
              second = best;
              best = d;
              bestShade = sh;
            } else if (d < second) second = d;
          }
        }
      }
      const edge = second - best < 1.2;
      p.set(x, y, shade(base, edge ? 0.55 : bestShade * (0.93 + p.rand() * 0.14)));
    }
  }
}

function paintGlyph(p: Painter, rows: string[], color: RGB, ox = 0, oy = 0): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') p.set(ox + x, oy + y, color);
  });
}

function paintGate(p: Painter, glyph: string[], on: boolean): void {
  p.noise(hex('#a5a5a8'), 0.06);
  p.frame(hex('#8a8a8e'));
  paintGlyph(p, glyph, on ? hex('#ff3b2b') : hex('#5a1414'));
}

const ARROW = [
  '................',
  '.......##.......',
  '......####......',
  '.....######.....',
  '....###..###....',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '......####......',
  '......####......',
  '................',
  '................',
];
const NOT_ARROW = [
  '................',
  '.......##.......',
  '......####......',
  '.....######.....',
  '.......##.......',
  '.......##.......',
  '.....######.....',
  '.....#....#.....',
  '.....#....#.....',
  '.....######.....',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '................',
  '................',
];
const AND_GLYPH = [
  '................',
  '.......##.......',
  '......####......',
  '.......##.......',
  '.......##.......',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '#################',
  '#################',
  '.....######.....',
  '.....######.....',
  '................',
  '................',
  '................',
  '................',
];
const OR_GLYPH = [
  '................',
  '.......##.......',
  '......####......',
  '.......##.......',
  '.......##.......',
  '.....######.....',
  '.....#....#.....',
  '.....#....#.....',
  '######....######',
  '######....######',
  '.....#....#.....',
  '.....######.....',
  '.......##.......',
  '.......##.......',
  '................',
  '................',
];

const painters: Record<TileName, (p: Painter) => void> = {
  grass_top: (p) => {
    p.noise(C.grass, 0.22);
    p.speckle(shade(C.grass, 1.2), 0.08);
    p.speckle(shade(C.grass, 0.8), 0.08);
  },
  grass_side: (p) => {
    p.noise(C.dirt, 0.2);
    p.speckle(shade(C.dirt, 0.75), 0.06);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(p.rand() * 3);
      for (let y = 0; y < depth; y++) p.set(x, y, shade(C.grass, 0.9 + p.rand() * 0.2));
    }
  },
  dirt: (p) => {
    p.noise(C.dirt, 0.22);
    p.speckle(shade(C.dirt, 0.7), 0.07);
    p.speckle(shade(C.dirt, 1.2), 0.05);
  },
  stone: (p) => {
    p.noise(C.stone, 0.16);
    for (let n = 0; n < 5; n++) {
      const x = Math.floor(p.rand() * S);
      const y = Math.floor(p.rand() * S);
      const len = 2 + Math.floor(p.rand() * 4);
      for (let i = 0; i < len; i++) p.set(x + i, y, shade(C.stone, 0.78));
    }
  },
  sand: (p) => {
    p.noise(C.sand, 0.1);
    p.speckle(shade(C.sand, 0.88), 0.08);
  },
  gravel: (p) => {
    p.noise(hex('#85807b'), 0.1);
    for (let n = 0; n < 22; n++) {
      const x = Math.floor(p.rand() * S);
      const y = Math.floor(p.rand() * S);
      const c = shade(hex('#8f8a84'), 0.6 + p.rand() * 0.7);
      p.rect(x, y, 2, 2, c);
    }
  },
  snow: (p) => {
    p.noise(C.snow, 0.05);
    p.speckle(hex('#dbe6f0'), 0.06, 0.05);
  },
  snow_side: (p) => {
    p.noise(C.dirt, 0.2);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(p.rand() * 2);
      for (let y = 0; y < depth; y++) p.set(x, y, shade(C.snow, 0.95 + p.rand() * 0.05));
    }
  },
  water: (p) => {
    p.noise(C.water, 0.08, 190);
    for (let n = 0; n < 6; n++) {
      const y = Math.floor(p.rand() * S);
      const x = Math.floor(p.rand() * S);
      for (let i = 0; i < 4; i++) p.set((x + i) % S, y, shade(C.water, 1.3), 200);
    }
  },
  log_side: (p) => {
    p.noise(C.bark, 0.12);
    for (let x = 0; x < S; x += 3 + Math.floor(p.rand() * 2)) for (let y = 0; y < S; y++) if (p.rand() < 0.85) p.set(x, y, shade(C.bark, 0.7));
  },
  log_top: (p) => {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d > 6.5) p.set(x, y, shade(C.bark, 0.9 + p.rand() * 0.15));
        else p.set(x, y, shade(C.wood, (Math.floor(d) % 2 === 0 ? 0.88 : 1.02) + (p.rand() - 0.5) * 0.06));
      }
    }
  },
  leaves: (p) => {
    p.noise(C.leaves, 0.3);
    p.speckle(shade(C.leaves, 0.65), 0.15);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (p.rand() < 0.16) p.alpha(x, y, 0);
  },
  coal_ore: (p) => {
    painters.stone(p);
    p.clusters(hex('#1e1e1f'), 5, 6);
  },
  iron_ore: (p) => {
    painters.stone(p);
    p.clusters(hex('#d9ab88'), 4, 6);
  },
  gold_ore: (p) => {
    painters.stone(p);
    p.clusters(hex('#f6d943'), 4, 6);
  },
  diamond_ore: (p) => {
    painters.stone(p);
    p.clusters(hex('#5fe3ea'), 4, 6);
  },
  sandstone: (p) => {
    p.noise(hex('#d8c58a'), 0.06);
    for (const y of [3, 4, 10, 11]) for (let x = 0; x < S; x++) p.set(x, y, shade(hex('#d8c58a'), 0.9));
    for (let x = 0; x < S; x++) p.set(x, 15, shade(hex('#d8c58a'), 0.82));
  },
  sandstone_top: (p) => {
    p.noise(hex('#dccb90'), 0.05);
    p.frame(shade(hex('#dccb90'), 0.92));
  },
  bedrock: (p) => {
    p.noise(hex('#4c4c4e'), 0.5);
    p.speckle(hex('#1d1d1e'), 0.2);
  },
  cobblestone: (p) => paintCobble(p, hex('#7b7b7e')),
  stone_bricks: (p) => paintBricks(p, hex('#7d7d80'), hex('#5c5c5f'), 8, 16),
  bricks: (p) => paintBricks(p, C.brick, C.mortar, 4, 8),
  glass: (p) => {
    p.clear();
    p.frame(hex('#dbeef5'));
    for (let i = 3; i < 7; i++) p.set(i, 9 - i, hex('#ffffff'), 200);
    for (let i = 9; i < 12; i++) p.set(i, 21 - i, hex('#ffffff'), 180);
  },
  planks: (p) => paintPlanks(p, C.plank),
  concrete_white: (p) => p.noise(hex('#d8dbdd'), 0.03),
  concrete_red: (p) => p.noise(hex('#a82822'), 0.04),
  concrete_orange: (p) => p.noise(hex('#e06a13'), 0.04),
  concrete_yellow: (p) => p.noise(hex('#f0b51e'), 0.04),
  concrete_green: (p) => p.noise(hex('#4f7a24'), 0.04),
  concrete_blue: (p) => p.noise(hex('#2d3e9c'), 0.04),
  concrete_purple: (p) => p.noise(hex('#6a2a9e'), 0.04),
  concrete_black: (p) => p.noise(hex('#141518'), 0.06),
  glowstone: (p) => {
    p.noise(hex('#c98a3a'), 0.2);
    p.clusters(hex('#fff2a8'), 8, 5);
    p.clusters(hex('#ffd25e'), 6, 4);
  },
  door: (p) => {
    paintPlanks(p, hex('#a87a45'));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x * 7 + y) % 5 === 0) p.set(x, y, shade(p.get(x, y), 0.95));
    p.frame(hex('#6b4a26'));
    p.rect(3, 3, 4, 4, hex('#9fd3e6'), 230);
    p.rect(9, 3, 4, 4, hex('#9fd3e6'), 230);
    p.rect(11, 9, 2, 2, hex('#2a2a2a'));
  },
  trapdoor: (p) => {
    paintPlanks(p, hex('#a87a45'));
    p.frame(hex('#6b4a26'));
    p.line(1, 1, 14, 14, hex('#6b4a26'));
    p.rect(4, 4, 3, 3, hex('#000000'), 0);
    p.rect(9, 9, 3, 3, hex('#000000'), 0);
  },
  tall_grass: (p) => {
    p.clear();
    for (let n = 0; n < 9; n++) {
      const x = 1 + Math.floor(p.rand() * 14);
      const h = 6 + Math.floor(p.rand() * 9);
      const lean = p.rand() < 0.5 ? -1 : 1;
      for (let i = 0; i < h; i++) p.set(x + (i > h / 2 ? lean : 0), 15 - i, shade(C.grass, 0.8 + p.rand() * 0.4));
    }
  },
  flower: (p) => {
    p.clear();
    for (let y = 8; y < 16; y++) p.set(7, y, hex('#3f7d27'));
    p.set(6, 11, hex('#3f7d27'));
    p.set(8, 13, hex('#3f7d27'));
    p.rect(5, 4, 5, 4, hex('#e0352b'));
    p.rect(6, 3, 3, 6, hex('#e0352b'));
    p.rect(7, 5, 1, 2, hex('#f6d943'));
  },
  switch_off: (p) => {
    paintCobble(p, hex('#6f6f72'));
    p.rect(4, 4, 8, 8, hex('#3a3a3c'));
    p.rect(6, 6, 4, 4, hex('#7a1d16'));
  },
  switch_on: (p) => {
    paintCobble(p, hex('#6f6f72'));
    p.rect(4, 4, 8, 8, hex('#3a3a3c'));
    p.rect(6, 6, 4, 4, hex('#4cff5c'));
  },
  button: (p) => {
    p.noise(hex('#8f8f92'), 0.08);
    p.frame(hex('#6d6d70'));
  },
  lever_base: (p) => paintCobble(p, hex('#7b7b7e')),
  lever_handle: (p) => {
    p.noise(hex('#7a5a33'), 0.15);
    p.rect(0, 0, 16, 3, hex('#4a4a4a'));
  },
  plate: (p) => {
    p.noise(hex('#9b9b9e'), 0.06);
    p.frame(hex('#7e7e81'));
  },
  wire_off: (p) => {
    p.noise(hex('#5c1210'), 0.15);
  },
  wire_on: (p) => {
    p.noise(hex('#ff3a28'), 0.12);
    p.speckle(hex('#ffb3a6'), 0.08);
  },
  lamp_off: (p) => {
    p.noise(hex('#5e3d20'), 0.12);
    for (let i = 0; i < S; i += 5) {
      for (let k = 0; k < S; k++) {
        p.set(i, k, hex('#3b2714'));
        p.set(k, i, hex('#3b2714'));
      }
    }
  },
  lamp_on: (p) => {
    p.noise(hex('#ffd77a'), 0.1);
    p.clusters(hex('#fffbe0'), 6, 5);
    for (let i = 0; i < S; i += 5) {
      for (let k = 0; k < S; k++) {
        p.set(i, k, hex('#b9822f'));
        p.set(k, i, hex('#b9822f'));
      }
    }
  },
  piston_side: (p) => {
    p.noise(C.stone, 0.12);
    for (let y = 0; y < 4; y++) for (let x = 0; x < S; x++) p.set(x, y, shade(C.plank, 0.9 + p.rand() * 0.2));
    for (let x = 0; x < S; x++) p.set(x, 4, shade(C.plank, 0.6));
  },
  piston_front: (p) => {
    paintPlanks(p, C.plank);
    p.rect(6, 6, 4, 4, C.iron);
  },
  piston_front_sticky: (p) => {
    paintPlanks(p, C.plank);
    p.rect(3, 3, 10, 10, hex('#5fbf48'));
    p.speckle(hex('#8be070'), 0.05);
  },
  piston_back: (p) => {
    p.noise(C.stone, 0.12);
    p.rect(5, 5, 6, 6, hex('#4a4a4c'));
    p.frame(shade(C.stone, 0.7));
  },
  piston_arm: (p) => paintPlanks(p, hex('#c09a62')),
  repeater: (p) => paintGate(p, ARROW, false),
  repeater_on: (p) => paintGate(p, ARROW, true),
  inverter: (p) => paintGate(p, NOT_ARROW, false),
  inverter_on: (p) => paintGate(p, NOT_ARROW, true),
  and_gate: (p) => paintGate(p, AND_GLYPH, false),
  and_gate_on: (p) => paintGate(p, AND_GLYPH, true),
  or_gate: (p) => paintGate(p, OR_GLYPH, false),
  or_gate_on: (p) => paintGate(p, OR_GLYPH, true),
  timer: (p) => {
    p.noise(hex('#5b5b60'), 0.08);
    p.rect(3, 3, 10, 10, hex('#e6e1cf'));
    p.line(8, 8, 8, 4, hex('#202020'));
    p.line(8, 8, 11, 8, hex('#202020'));
    p.frame(hex('#3d3d42'));
  },
  timer_on: (p) => {
    p.noise(hex('#5b5b60'), 0.08);
    p.rect(3, 3, 10, 10, hex('#fff3b0'));
    p.line(8, 8, 8, 4, hex('#d42a1e'));
    p.line(8, 8, 11, 8, hex('#d42a1e'));
    p.frame(hex('#3d3d42'));
  },
  gate_side: (p) => {
    p.noise(hex('#a5a5a8'), 0.06);
    for (let x = 0; x < S; x++) p.set(x, 15, hex('#77777a'));
  },
  chest_side: (p) => {
    paintPlanks(p, hex('#9a6a34'));
    p.frame(hex('#5a3a18'));
    for (let x = 0; x < S; x++) p.set(x, 5, hex('#5a3a18'));
  },
  chest_front: (p) => {
    painters.chest_side(p);
    p.rect(7, 4, 2, 4, hex('#c8c8c8'));
  },
  chest_top: (p) => {
    paintPlanks(p, hex('#a87538'));
    p.frame(hex('#5a3a18'));
  },
  crafting_top: (p) => {
    paintPlanks(p, hex('#a87a45'));
    p.frame(hex('#6b4a26'));
    for (let i = 2; i < 14; i++) {
      p.set(i, 8, hex('#6b4a26'));
      p.set(8, i, hex('#6b4a26'));
    }
  },
  crafting_side: (p) => {
    paintPlanks(p, C.plank);
    p.rect(0, 0, 16, 3, hex('#8a6237'));
    p.line(3, 6, 12, 6, hex('#cfcfcf'));
    for (let x = 3; x <= 12; x += 2) p.set(x, 7, hex('#cfcfcf'));
    p.rect(10, 5, 3, 3, hex('#6b4a26'));
  },
  crafting_front: (p) => {
    paintPlanks(p, C.plank);
    p.rect(0, 0, 16, 3, hex('#8a6237'));
    p.line(4, 12, 9, 7, hex('#6b4a26'));
    p.rect(8, 5, 4, 3, hex('#9a9a9a'));
  },
  cactus_side: (p) => {
    p.noise(hex('#4f8f2f'), 0.12);
    for (const x of [2, 7, 12]) for (let y = 0; y < S; y++) p.set(x, y, hex('#3a6c22'));
    for (let n = 0; n < 8; n++) p.set(Math.floor(p.rand() * S), Math.floor(p.rand() * S), hex('#e8e2b5'));
  },
  cactus_top: (p) => {
    p.noise(hex('#5c9a37'), 0.1);
    p.frame(hex('#3a6c22'), 1);
  },
  iron_panel: (p) => {
    p.noise(C.iron, 0.05);
    p.frame(shade(C.iron, 0.75));
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, shade(C.iron, 0.55));
    for (let x = 1; x < 15; x++) p.set(x, 8, shade(C.iron, 0.85));
  },
  item_stick: (p) => {
    p.clear();
    p.line(3, 13, 12, 2, hex('#7a5a33'));
    p.line(4, 13, 13, 2, hex('#5a3e1f'));
  },
  item_coal: (p) => {
    p.clear();
    p.rect(4, 5, 8, 7, hex('#262628'));
    p.rect(5, 4, 6, 9, hex('#262628'));
    p.set(6, 6, hex('#5a5a60'));
    p.set(9, 8, hex('#5a5a60'));
  },
  item_iron_ingot: (p) => {
    p.clear();
    p.rect(2, 6, 12, 5, hex('#d8dde2'));
    p.rect(3, 5, 10, 1, hex('#f4f7f9'));
    p.rect(2, 10, 12, 1, hex('#9aa0a6'));
  },
  item_gold_ingot: (p) => {
    p.clear();
    p.rect(2, 6, 12, 5, hex('#f2cf3a'));
    p.rect(3, 5, 10, 1, hex('#fff2a0'));
    p.rect(2, 10, 12, 1, hex('#b8901c'));
  },
  item_diamond: (p) => {
    p.clear();
    p.rect(5, 3, 6, 2, hex('#a8f5f7'));
    p.rect(3, 5, 10, 3, hex('#5fe3ea'));
    p.rect(5, 8, 6, 3, hex('#3fbcc4'));
    p.rect(7, 11, 2, 2, hex('#2a9aa2'));
  },
};

let atlasCanvas: HTMLCanvasElement | null = null;

/** Paint all tiles into a single atlas canvas (cached). */
export function getAtlasCanvas(): HTMLCanvasElement {
  if (atlasCanvas) return atlasCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_TILES_PER_ROW * S;
  canvas.height = ATLAS_TILES_PER_ROW * S;
  const ctx = canvas.getContext('2d')!;
  TILE_NAMES.forEach((name, index) => {
    const painter = new Painter(mulberry32(0x5eed + index * 7919));
    painters[name](painter);
    const image = new ImageData(new Uint8ClampedArray(painter.px), S, S);
    ctx.putImageData(image, (index % ATLAS_TILES_PER_ROW) * S, Math.floor(index / ATLAS_TILES_PER_ROW) * S);
  });
  atlasCanvas = canvas;
  return canvas;
}

/** Average colour of a tile (used for particles and held-item tint). */
export function getTileAverageColor(index: number): [number, number, number] {
  const ctx = getAtlasCanvas().getContext('2d')!;
  const data = ctx.getImageData((index % ATLAS_TILES_PER_ROW) * S, Math.floor(index / ATLAS_TILES_PER_ROW) * S, S, S).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1];
}

/** Crack overlay frames for block breaking progress (0..9). */
export function createCrackCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = S * 10;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(0xc4ac);
  const lines: [number, number, number, number][] = [];
  for (let i = 0; i < 40; i++) {
    const x = rand() * S;
    const y = rand() * S;
    lines.push([x, y, x + (rand() - 0.5) * 6, y + (rand() - 0.5) * 6]);
  }
  for (let stage = 0; stage < 10; stage++) {
    ctx.save();
    ctx.translate(stage * S, 0);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1;
    const count = Math.floor(((stage + 1) / 10) * lines.length);
    for (let i = 0; i < count; i++) {
      const [x0, y0, x1, y1] = lines[i];
      ctx.beginPath();
      ctx.moveTo(Math.floor(x0) + 0.5, Math.floor(y0) + 0.5);
      ctx.lineTo(Math.floor(x1) + 0.5, Math.floor(y1) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  return canvas;
}
