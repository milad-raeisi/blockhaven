import { B } from '../blocks/ids';
import { Chunk } from '../chunks/chunk';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../world/constants';
import { localIndex } from '../world/coords';
import { SimplexNoise } from './noise';
import { hash2f, hash3, hash3f, normalizeSeed } from './random';

export type TerrainType = 'default' | 'flat' | 'mountains';
export const TERRAIN_TYPES: readonly TerrainType[] = ['default', 'flat', 'mountains'];

export const Biome = {
  Plains: 0,
  Forest: 1,
  Desert: 2,
  Mountains: 3,
  Snowy: 4,
  Beach: 5,
  Lake: 6,
  River: 7,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: Record<BiomeId, string> = {
  0: 'Plains',
  1: 'Forest',
  2: 'Desert',
  3: 'Mountains',
  4: 'Snowy Plains',
  5: 'Beach',
  6: 'Lake',
  7: 'River',
};

export interface ColumnInfo {
  height: number;
  biome: BiomeId;
}

const TREE_CELL = 7;
const FLAT_HEIGHT = SEA_LEVEL + 4;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic procedural terrain. Every block depends only on the seed and
 * its world coordinates, so chunks generated on the client and the server
 * always match and adjacent chunks line up without gaps.
 */
export class TerrainGenerator {
  readonly seed: number;
  private readonly continent: SimplexNoise;
  private readonly hills: SimplexNoise;
  private readonly detail: SimplexNoise;
  private readonly mountain: SimplexNoise;
  private readonly river: SimplexNoise;
  private readonly temperature: SimplexNoise;
  private readonly moisture: SimplexNoise;
  private readonly cave1: SimplexNoise;
  private readonly cave2: SimplexNoise;
  private readonly cave3: SimplexNoise;

  constructor(
    seed: string,
    readonly type: TerrainType = 'default',
  ) {
    this.seed = normalizeSeed(seed);
    const s = this.seed;
    this.continent = new SimplexNoise(s ^ 0x1001);
    this.hills = new SimplexNoise(s ^ 0x2002);
    this.detail = new SimplexNoise(s ^ 0x3003);
    this.mountain = new SimplexNoise(s ^ 0x4004);
    this.river = new SimplexNoise(s ^ 0x5005);
    this.temperature = new SimplexNoise(s ^ 0x6006);
    this.moisture = new SimplexNoise(s ^ 0x7007);
    this.cave1 = new SimplexNoise(s ^ 0x8008);
    this.cave2 = new SimplexNoise(s ^ 0x9009);
    this.cave3 = new SimplexNoise(s ^ 0xa00a);
  }

  /** Surface height and biome of a world column. */
  getColumn(x: number, z: number): ColumnInfo {
    if (this.type === 'flat') return { height: FLAT_HEIGHT, biome: Biome.Plains };
    const amplified = this.type === 'mountains';

    const c = this.continent.fbm2(x / 700, z / 700, 3);
    const base = SEA_LEVEL + 6 + c * 12 + (amplified ? 6 : 0);
    const hills = this.hills.fbm2(x / 140, z / 140, 4) * (amplified ? 18 : 10);
    const detail = this.detail.noise2(x / 32, z / 32) * 2.5;
    const m = this.mountain.fbm2(x / 420, z / 420, 3);
    const mf = smoothstep(amplified ? 0.05 : 0.18, amplified ? 0.45 : 0.6, m);
    const ridge = 1 - Math.abs(this.mountain.noise2(x / 90 + 100, z / 90));
    const mountainAdd = mf * (25 + ridge * 30) * (amplified ? 1.6 : 1);
    let h = base + hills * (0.5 + 0.5 * (1 - mf)) + detail + mountainAdd;

    let isRiver = false;
    const r = Math.abs(this.river.fbm2(x / 500, z / 500, 2));
    const riverWidth = 0.035;
    if (r < riverWidth && h > SEA_LEVEL - 2) {
      const t = 1 - r / riverWidth;
      const target = SEA_LEVEL - 2 - t * 2;
      const k = smoothstep(0, 0.6, t);
      h = h + (target - h) * k;
      isRiver = k > 0.55;
    }

    const height = Math.max(4, Math.min(WORLD_HEIGHT - 20, Math.floor(h)));
    const temp = this.temperature.fbm2(x / 600, z / 600, 2) - (height - SEA_LEVEL) / 90;
    const moist = this.moisture.fbm2(x / 500 + 50, z / 500, 2);

    let biome: BiomeId;
    if (isRiver && height < SEA_LEVEL) biome = Biome.River;
    else if (height < SEA_LEVEL) biome = Biome.Lake;
    else if (height <= SEA_LEVEL + 1 && temp > -0.45) biome = Biome.Beach;
    else if (temp < -0.45) biome = Biome.Snowy;
    else if (mf > 0.5 && height > SEA_LEVEL + 28) biome = Biome.Mountains;
    else if (temp > 0.3 && moist < 0.05) biome = Biome.Desert;
    else if (moist > 0.1) biome = Biome.Forest;
    else biome = Biome.Plains;
    return { height, biome };
  }

  generateChunk(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    const columns: ColumnInfo[] = new Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const col = this.getColumn(ox + lx, oz + lz);
        columns[lz * CHUNK_SIZE + lx] = col;
        this.fillColumn(chunk, lx, lz, ox + lx, oz + lz, col);
      }
    }
    this.placeVegetation(chunk, ox, oz, columns);
    return chunk;
  }

  private fillColumn(chunk: Chunk, lx: number, lz: number, x: number, z: number, col: ColumnInfo): void {
    const { height, biome } = col;
    const blocks = chunk.blocks;
    const flat = this.type === 'flat';

    let top: number = B.GRASS;
    let filler: number = B.DIRT;
    let fillerDepth = 3;
    let deep: number = B.STONE;
    let deepDepth = 0;
    switch (biome) {
      case Biome.Desert:
        top = B.SAND;
        filler = B.SAND;
        fillerDepth = 4;
        deep = B.SANDSTONE;
        deepDepth = 3;
        break;
      case Biome.Beach:
        top = B.SAND;
        filler = B.SAND;
        fillerDepth = 3;
        deep = B.SANDSTONE;
        deepDepth = 1;
        break;
      case Biome.Lake:
      case Biome.River: {
        const gravel = SEA_LEVEL - height > 5 || hash2f(this.seed ^ 0x33, x, z) < 0.15;
        top = gravel ? B.GRAVEL : B.SAND;
        filler = top;
        fillerDepth = 2;
        break;
      }
      case Biome.Snowy:
        top = height > SEA_LEVEL + 40 ? B.SNOW : B.SNOWY_GRASS;
        break;
      case Biome.Mountains:
        if (height > SEA_LEVEL + 48) {
          top = B.SNOW;
          filler = B.STONE;
        } else if (height > SEA_LEVEL + 36) {
          top = B.STONE;
          filler = B.STONE;
        }
        break;
      default:
        break;
    }

    for (let y = 0; y <= height; y++) {
      let id: number;
      const depth = height - y;
      if (y === 0) id = B.BEDROCK;
      else if (y <= 2 && hash3f(this.seed ^ 0x77, x, y, z) < (y === 1 ? 0.6 : 0.3)) id = B.BEDROCK;
      else if (depth === 0) id = top;
      else if (depth <= fillerDepth) id = filler;
      else if (depth <= fillerDepth + deepDepth) id = deep;
      else id = B.STONE;

      if (id === B.STONE && !flat) id = this.oreAt(x, y, z);
      if (!flat && id !== B.BEDROCK && this.isCave(x, y, z, height, biome)) id = B.AIR;
      blocks[localIndex(lx, y, lz)] = id;
    }
    for (let y = height + 1; y <= SEA_LEVEL; y++) {
      blocks[localIndex(lx, y, lz)] = B.WATER;
    }
  }

  private isCave(x: number, y: number, z: number, height: number, biome: BiomeId): boolean {
    if (y < 5) return false;
    const wet = biome === Biome.Lake || biome === Biome.River || biome === Biome.Beach;
    if (wet ? y > height - 5 : y > height) return false;
    // Keep the surface mostly intact; only occasional entrances break through.
    if (y > height - 3 && hash2f(this.seed ^ 0x99, x >> 3, z >> 3) > 0.25) return false;
    const n1 = this.cave1.noise3(x / 48, y / 32, z / 48);
    const n2 = this.cave2.noise3(x / 48, y / 32, z / 48);
    if (n1 * n1 + n2 * n2 < 0.0065) return true;
    if (y < 36 && this.cave3.noise3(x / 70, y / 40, z / 70) > 0.62) return true;
    return false;
  }

  /** Ore veins: each 4x4x4 cell may hold a small blob of one ore type. */
  private oreAt(x: number, y: number, z: number): number {
    const gx = x >> 2;
    const gy = y >> 2;
    const gz = z >> 2;
    const h = hash3(this.seed ^ 0x0e0e, gx, gy, gz);
    const roll = (h & 0xffff) / 65536;
    let ore = 0;
    if (y < 16 && roll < 0.025) ore = B.DIAMOND_ORE;
    else if (y < 32 && roll < 0.06) ore = B.GOLD_ORE;
    else if (y < 64 && roll < 0.14) ore = B.IRON_ORE;
    else if (y < 90 && roll < 0.26) ore = B.COAL_ORE;
    if (!ore) return B.STONE;
    const centerX = (gx << 2) + ((h >>> 16) & 3);
    const centerY = (gy << 2) + ((h >>> 18) & 3);
    const centerZ = (gz << 2) + ((h >>> 20) & 3);
    const dx = x - centerX;
    const dy = y - centerY;
    const dz = z - centerZ;
    const radius = ore === B.DIAMOND_ORE ? 1.2 : 1.8;
    if (dx * dx + dy * dy + dz * dz > radius * radius) return B.STONE;
    return hash3f(this.seed ^ 0x0f0f, x, y, z) < 0.75 ? ore : B.STONE;
  }

  private placeVegetation(chunk: Chunk, ox: number, oz: number, columns: ColumnInfo[]): void {
    const blocks = chunk.blocks;
    // Ground cover.
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const { height, biome } = columns[lz * CHUNK_SIZE + lx];
        if (height + 1 >= WORLD_HEIGHT) continue;
        if (blocks[localIndex(lx, height, lz)] !== B.GRASS) continue;
        if (blocks[localIndex(lx, height + 1, lz)] !== B.AIR) continue;
        const r = hash2f(this.seed ^ 0x4242, ox + lx, oz + lz);
        const grassChance = biome === Biome.Plains ? 0.18 : biome === Biome.Forest ? 0.1 : 0.04;
        if (r < 0.012) blocks[localIndex(lx, height + 1, lz)] = B.FLOWER;
        else if (r < 0.012 + grassChance) blocks[localIndex(lx, height + 1, lz)] = B.TALL_GRASS;
      }
    }

    // Trees and cacti, sampled on a jittered grid so they can cross chunk borders.
    const minCell = Math.floor((ox - 3) / TREE_CELL);
    const maxCell = Math.floor((ox + CHUNK_SIZE + 3) / TREE_CELL);
    const minCellZ = Math.floor((oz - 3) / TREE_CELL);
    const maxCellZ = Math.floor((oz + CHUNK_SIZE + 3) / TREE_CELL);
    for (let gz = minCellZ; gz <= maxCellZ; gz++) {
      for (let gx = minCell; gx <= maxCell; gx++) {
        const h = hash3(this.seed ^ 0x7ee5, gx, 0, gz);
        const tx = gx * TREE_CELL + (h % TREE_CELL);
        const tz = gz * TREE_CELL + ((h >>> 8) % TREE_CELL);
        if (tx < ox - 3 || tx > ox + CHUNK_SIZE + 2 || tz < oz - 3 || tz > oz + CHUNK_SIZE + 2) continue;
        const inside = tx >= ox && tx < ox + CHUNK_SIZE && tz >= oz && tz < oz + CHUNK_SIZE;
        const col = inside ? columns[(tz - oz) * CHUNK_SIZE + (tx - ox)] : this.getColumn(tx, tz);
        const chance = ((h >>> 16) & 0xffff) / 65536;
        if (col.height <= SEA_LEVEL || col.height > WORLD_HEIGHT - 12) continue;
        switch (col.biome) {
          case Biome.Forest:
            if (chance < 0.85) this.placeTree(chunk, tx, col.height + 1, tz, h, false);
            break;
          case Biome.Plains:
            if (chance < 0.12) this.placeTree(chunk, tx, col.height + 1, tz, h, false);
            break;
          case Biome.Snowy:
            if (chance < 0.35 && col.height < SEA_LEVEL + 40) this.placeTree(chunk, tx, col.height + 1, tz, h, true);
            break;
          case Biome.Mountains:
            if (chance < 0.1 && col.height <= SEA_LEVEL + 36) this.placeTree(chunk, tx, col.height + 1, tz, h, true);
            break;
          case Biome.Desert:
            if (chance < 0.25) this.placeCactus(chunk, tx, col.height + 1, tz, h);
            break;
          default:
            break;
        }
      }
    }
  }

  private setIfInside(chunk: Chunk, x: number, y: number, z: number, id: number, overwriteSolid: boolean): void {
    const lx = x - chunk.originX;
    const lz = z - chunk.originZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const i = localIndex(lx, y, lz);
    const current = chunk.blocks[i];
    if (overwriteSolid || current === B.AIR || current === B.TALL_GRASS || current === B.FLOWER || (id === B.LOG && current === B.LEAVES)) {
      chunk.blocks[i] = id;
    }
  }

  private placeTree(chunk: Chunk, x: number, y: number, z: number, h: number, conifer: boolean): void {
    const trunk = 4 + ((h >>> 24) % 3) + (conifer ? 1 : 0);
    const topY = y + trunk - 1;
    if (conifer) {
      for (let dy = -3; dy <= 1; dy++) {
        const r = dy >= 0 ? (dy === 1 ? 0 : 1) : dy === -1 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
            this.setIfInside(chunk, x + dx, topY + dy, z + dz, B.LEAVES, false);
          }
        }
      }
    } else {
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy < 0 ? 2 : 1;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (dy === 1 || hash3f(this.seed ^ 0x1eaf, x + dx, topY + dy, z + dz) < 0.5)) continue;
            this.setIfInside(chunk, x + dx, topY + dy, z + dz, B.LEAVES, false);
          }
        }
      }
    }
    for (let i = 0; i < trunk; i++) this.setIfInside(chunk, x, y + i, z, B.LOG, false);
  }

  private placeCactus(chunk: Chunk, x: number, y: number, z: number, h: number): void {
    const height = 1 + ((h >>> 24) % 3);
    for (let i = 0; i < height; i++) this.setIfInside(chunk, x, y + i, z, B.CACTUS, false);
  }

  /** Find a dry, reasonably flat column near the origin for spawning. */
  findSpawnColumn(): { x: number; z: number; height: number } {
    for (let radius = 0; radius <= 512; radius += 8) {
      const steps = Math.max(1, Math.floor((radius * 2 * Math.PI) / 8));
      for (let s = 0; s < steps; s++) {
        const angle = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(angle) * radius);
        const z = Math.round(Math.sin(angle) * radius);
        const col = this.getColumn(x, z);
        if (col.biome === Biome.Lake || col.biome === Biome.River) continue;
        if (col.height < SEA_LEVEL + 1 || col.height > SEA_LEVEL + 24) continue;
        return { x, z, height: col.height };
      }
    }
    return { x: 0, z: 0, height: this.getColumn(0, 0).height };
  }
}
