import { Face } from '../world/constants';
import { B, BLOCK_COUNT } from './ids';
import { getFacing, getVariant, isActive, isPowered } from './meta';
import type { TileName } from './tiles';

export type BlockShape =
  | 'none'
  | 'cube'
  | 'cross'
  | 'slab'
  | 'stairs'
  | 'fence'
  | 'door'
  | 'trapdoor'
  | 'wire'
  | 'plate'
  | 'button'
  | 'lever'
  | 'gate'
  | 'pistonArm'
  | 'liquid'
  | 'cactus';

/** opaque: solid geometry; cutout: alpha-tested; translucent: blended (water). */
export type RenderLayer = 'none' | 'opaque' | 'cutout' | 'translucent';

/**
 * none:       no orientation
 * horizontal: faces the player when placed (N/E/S/W)
 * all:        faces away from the clicked face, any of 6 directions (pistons)
 * attach:     stored facing is the face of the block it hangs on (buttons, levers)
 */
export type Orientation = 'none' | 'horizontal' | 'all' | 'attach';

export type CircuitRole =
  | 'none'
  | 'wire'
  | 'source' // levers, switches, buttons, pressure plates: emit while active
  | 'consumer' // lamps, doors, trapdoors: react to incoming power
  | 'repeater'
  | 'inverter'
  | 'andGate'
  | 'orGate'
  | 'timer'
  | 'piston';

export type BlockCategory = 'natural' | 'building' | 'mechanisms' | 'decoration' | 'hidden';

/** How a block reacts when a piston pushes it. */
export type PushBehavior = 'normal' | 'immovable' | 'destroy';

export interface BlockTextures {
  all?: TileName;
  top?: TileName;
  bottom?: TileName;
  side?: TileName;
  front?: TileName;
  back?: TileName;
  /** Alternate front/all texture while the block is active or powered. */
  on?: TileName;
}

export interface BlockDefinition {
  id: number;
  name: string;
  displayName: string;
  category: BlockCategory;
  /** Players collide with the block. */
  solid: boolean;
  /** Light and visibility pass through the block. */
  transparent: boolean;
  /** A full opaque cube that hides neighbouring faces. */
  occludes: boolean;
  breakable: boolean;
  /** Relative break time by hand in Survival mode. */
  hardness: number;
  emitsLight: boolean;
  lightLevel: number;
  textures: BlockTextures;
  shape: BlockShape;
  renderLayer: RenderLayer;
  orientation: Orientation;
  /** Right-click triggers an interaction instead of placing a block. */
  interactive: boolean;
  circuit: CircuitRole;
  /** Can be replaced by placing a block into it (air, water, grass). */
  replaceable: boolean;
  pushBehavior: PushBehavior;
  /** Item dropped in Survival mode: undefined = the block itself, null = nothing. */
  drops?: number | null;
  /** Listed in the Creative inventory. */
  obtainable: boolean;
  stackSize: number;
  /** Extra sky light lost when passing through this block. */
  lightFilter: number;
  /** Can be selected with the crosshair. */
  targetable: boolean;
}

type BlockInit = Partial<BlockDefinition> & Pick<BlockDefinition, 'id' | 'name' | 'displayName'>;

const CUBE_DEFAULTS: Omit<BlockDefinition, 'id' | 'name' | 'displayName'> = {
  category: 'building',
  solid: true,
  transparent: false,
  occludes: true,
  breakable: true,
  hardness: 1,
  emitsLight: false,
  lightLevel: 0,
  textures: {},
  shape: 'cube',
  renderLayer: 'opaque',
  orientation: 'none',
  interactive: false,
  circuit: 'none',
  replaceable: false,
  pushBehavior: 'normal',
  obtainable: true,
  stackSize: 64,
  lightFilter: 0,
  targetable: true,
};

/** Non-cube decorative / mechanical shapes share these defaults. */
const PART_DEFAULTS: Partial<BlockDefinition> = {
  transparent: true,
  occludes: false,
  renderLayer: 'cutout',
};

const registry: BlockDefinition[] = new Array(BLOCK_COUNT);
const byName = new Map<string, BlockDefinition>();

export function registerBlock(init: BlockInit): BlockDefinition {
  const def: BlockDefinition = { ...CUBE_DEFAULTS, ...init };
  if (def.lightLevel > 0) def.emitsLight = true;
  if (registry[def.id]) throw new Error(`Block id ${def.id} registered twice`);
  registry[def.id] = def;
  byName.set(def.name, def);
  return def;
}

// --- Natural -----------------------------------------------------------------
registerBlock({
  id: B.AIR,
  name: 'air',
  displayName: 'Air',
  category: 'hidden',
  solid: false,
  transparent: true,
  occludes: false,
  breakable: false,
  shape: 'none',
  renderLayer: 'none',
  replaceable: true,
  obtainable: false,
  targetable: false,
});
registerBlock({ id: B.GRASS, name: 'grass', displayName: 'Grass Block', category: 'natural', hardness: 0.6, textures: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, drops: B.DIRT });
registerBlock({ id: B.DIRT, name: 'dirt', displayName: 'Dirt', category: 'natural', hardness: 0.5, textures: { all: 'dirt' } });
registerBlock({ id: B.STONE, name: 'stone', displayName: 'Stone', category: 'natural', hardness: 1.5, textures: { all: 'stone' }, drops: B.COBBLESTONE });
registerBlock({ id: B.SAND, name: 'sand', displayName: 'Sand', category: 'natural', hardness: 0.5, textures: { all: 'sand' } });
registerBlock({ id: B.GRAVEL, name: 'gravel', displayName: 'Gravel', category: 'natural', hardness: 0.6, textures: { all: 'gravel' } });
registerBlock({ id: B.SNOW, name: 'snow', displayName: 'Snow', category: 'natural', hardness: 0.3, textures: { all: 'snow' } });
registerBlock({
  id: B.WATER,
  name: 'water',
  displayName: 'Water',
  category: 'natural',
  solid: false,
  transparent: true,
  occludes: false,
  breakable: false,
  shape: 'liquid',
  renderLayer: 'translucent',
  textures: { all: 'water' },
  replaceable: true,
  pushBehavior: 'destroy',
  lightFilter: 2,
  targetable: false,
});
registerBlock({ id: B.LOG, name: 'log', displayName: 'Wood Log', category: 'natural', hardness: 1.2, textures: { top: 'log_top', bottom: 'log_top', side: 'log_side' } });
registerBlock({
  id: B.LEAVES,
  name: 'leaves',
  displayName: 'Leaves',
  category: 'natural',
  hardness: 0.2,
  transparent: true,
  occludes: false,
  renderLayer: 'cutout',
  textures: { all: 'leaves' },
  drops: null,
  lightFilter: 1,
});
registerBlock({ id: B.COAL_ORE, name: 'coal_ore', displayName: 'Coal Ore', category: 'natural', hardness: 2, textures: { all: 'coal_ore' }, drops: 257 });
registerBlock({ id: B.IRON_ORE, name: 'iron_ore', displayName: 'Iron Ore', category: 'natural', hardness: 2.5, textures: { all: 'iron_ore' } });
registerBlock({ id: B.GOLD_ORE, name: 'gold_ore', displayName: 'Gold Ore', category: 'natural', hardness: 2.5, textures: { all: 'gold_ore' } });
registerBlock({ id: B.DIAMOND_ORE, name: 'diamond_ore', displayName: 'Diamond Ore', category: 'natural', hardness: 3, textures: { all: 'diamond_ore' }, drops: 260 });
registerBlock({ id: B.SANDSTONE, name: 'sandstone', displayName: 'Sandstone', category: 'natural', hardness: 1.2, textures: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone' } });
registerBlock({ id: B.BEDROCK, name: 'bedrock', displayName: 'Bedrock', category: 'natural', breakable: false, hardness: Infinity, textures: { all: 'bedrock' }, pushBehavior: 'immovable', obtainable: false });
registerBlock({
  id: B.TALL_GRASS,
  name: 'tall_grass',
  displayName: 'Tall Grass',
  category: 'decoration',
  ...PART_DEFAULTS,
  solid: false,
  hardness: 0,
  shape: 'cross',
  textures: { all: 'tall_grass' },
  replaceable: true,
  pushBehavior: 'destroy',
  drops: null,
});
registerBlock({
  id: B.FLOWER,
  name: 'flower',
  displayName: 'Flower',
  category: 'decoration',
  ...PART_DEFAULTS,
  solid: false,
  hardness: 0,
  shape: 'cross',
  textures: { all: 'flower' },
  pushBehavior: 'destroy',
});
registerBlock({ id: B.CACTUS, name: 'cactus', displayName: 'Cactus', category: 'natural', ...PART_DEFAULTS, renderLayer: 'opaque', hardness: 0.4, shape: 'cactus', textures: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' } });
registerBlock({ id: B.SNOWY_GRASS, name: 'snowy_grass', displayName: 'Snowy Grass', category: 'natural', hardness: 0.6, textures: { top: 'snow', bottom: 'dirt', side: 'snow_side' }, drops: B.DIRT });

// --- Construction --------------------------------------------------------------
registerBlock({ id: B.COBBLESTONE, name: 'cobblestone', displayName: 'Cobblestone', hardness: 1.6, textures: { all: 'cobblestone' } });
registerBlock({ id: B.STONE_BRICKS, name: 'stone_bricks', displayName: 'Stone Bricks', hardness: 1.5, textures: { all: 'stone_bricks' } });
registerBlock({ id: B.BRICKS, name: 'bricks', displayName: 'Bricks', hardness: 1.5, textures: { all: 'bricks' } });
registerBlock({ id: B.GLASS, name: 'glass', displayName: 'Glass', hardness: 0.3, transparent: true, occludes: false, renderLayer: 'cutout', textures: { all: 'glass' }, drops: null });
registerBlock({ id: B.PLANKS, name: 'planks', displayName: 'Wooden Planks', hardness: 1, textures: { all: 'planks' } });
registerBlock({ id: B.CONCRETE, name: 'concrete', displayName: 'Concrete', hardness: 1.2, textures: { all: 'concrete_white' } });
registerBlock({ id: B.CONCRETE_RED, name: 'concrete_red', displayName: 'Red Concrete', category: 'decoration', hardness: 1.2, textures: { all: 'concrete_red' } });
registerBlock({ id: B.CONCRETE_ORANGE, name: 'concrete_orange', displayName: 'Orange Concrete', category: 'decoration', hardness: 1.2, textures: { all: 'concrete_orange' } });
registerBlock({ id: B.CONCRETE_YELLOW, name: 'concrete_yellow', displayName: 'Yellow Concrete', category: 'decoration', hardness: 1.2, textures: { all: 'concrete_yellow' } });
registerBlock({ id: B.CONCRETE_GREEN, name: 'concrete_green', displayName: 'Green Concrete', category: 'decoration', hardness: 1.2, textures: { all: 'concrete_green' } });
registerBlock({ id: B.CONCRETE_BLUE, name: 'concrete_blue', displayName: 'Blue Concrete', category: 'decoration', hardness: 1.2, textures: { all: 'concrete_blue' } });
registerBlock({ id: B.CONCRETE_PURPLE, name: 'concrete_purple', displayName: 'Purple Concrete', category: 'decoration', hardness: 1.2, textures: { all: 'concrete_purple' } });
registerBlock({ id: B.CONCRETE_BLACK, name: 'concrete_black', displayName: 'Black Concrete', category: 'decoration', hardness: 1.2, textures: { all: 'concrete_black' } });
registerBlock({ id: B.GLOWSTONE, name: 'glowstone', displayName: 'Glowstone', category: 'decoration', hardness: 0.4, lightLevel: 15, textures: { all: 'glowstone' } });
registerBlock({ id: B.IRON_PANEL, name: 'iron_panel', displayName: 'Iron Panel', hardness: 2, textures: { all: 'iron_panel' } });
registerBlock({ id: B.PLANK_STAIRS, name: 'plank_stairs', displayName: 'Wooden Stairs', ...PART_DEFAULTS, renderLayer: 'opaque', hardness: 1, shape: 'stairs', orientation: 'horizontal', textures: { all: 'planks' } });
registerBlock({ id: B.STONE_STAIRS, name: 'stone_stairs', displayName: 'Stone Stairs', ...PART_DEFAULTS, renderLayer: 'opaque', hardness: 1.5, shape: 'stairs', orientation: 'horizontal', textures: { all: 'cobblestone' } });
registerBlock({ id: B.PLANK_SLAB, name: 'plank_slab', displayName: 'Wooden Slab', ...PART_DEFAULTS, renderLayer: 'opaque', hardness: 1, shape: 'slab', textures: { all: 'planks' } });
registerBlock({ id: B.STONE_SLAB, name: 'stone_slab', displayName: 'Stone Slab', ...PART_DEFAULTS, renderLayer: 'opaque', hardness: 1.5, shape: 'slab', textures: { all: 'stone_bricks' } });
registerBlock({ id: B.FENCE, name: 'fence', displayName: 'Wooden Fence', ...PART_DEFAULTS, renderLayer: 'opaque', hardness: 1, shape: 'fence', textures: { all: 'planks' } });
registerBlock({
  id: B.DOOR,
  name: 'door',
  displayName: 'Wooden Door',
  ...PART_DEFAULTS,
  hardness: 1,
  shape: 'door',
  orientation: 'horizontal',
  interactive: true,
  circuit: 'consumer',
  textures: { all: 'door' },
  pushBehavior: 'immovable',
});
registerBlock({
  id: B.TRAPDOOR,
  name: 'trapdoor',
  displayName: 'Trapdoor',
  ...PART_DEFAULTS,
  hardness: 1,
  shape: 'trapdoor',
  orientation: 'horizontal',
  interactive: true,
  circuit: 'consumer',
  textures: { all: 'trapdoor' },
});

// --- Interactive & circuits ------------------------------------------------------
registerBlock({ id: B.SWITCH, name: 'switch', displayName: 'Switch Block', category: 'mechanisms', hardness: 0.8, interactive: true, circuit: 'source', textures: { all: 'switch_off', on: 'switch_on' } });
registerBlock({
  id: B.BUTTON,
  name: 'button',
  displayName: 'Button',
  category: 'mechanisms',
  ...PART_DEFAULTS,
  solid: false,
  hardness: 0.3,
  shape: 'button',
  orientation: 'attach',
  interactive: true,
  circuit: 'source',
  textures: { all: 'button' },
  pushBehavior: 'destroy',
});
registerBlock({
  id: B.LEVER,
  name: 'lever',
  displayName: 'Lever',
  category: 'mechanisms',
  ...PART_DEFAULTS,
  solid: false,
  hardness: 0.3,
  shape: 'lever',
  orientation: 'attach',
  interactive: true,
  circuit: 'source',
  textures: { all: 'lever_base', side: 'lever_handle' },
  pushBehavior: 'destroy',
});
registerBlock({
  id: B.PRESSURE_PLATE,
  name: 'pressure_plate',
  displayName: 'Pressure Plate',
  category: 'mechanisms',
  ...PART_DEFAULTS,
  solid: false,
  hardness: 0.4,
  shape: 'plate',
  circuit: 'source',
  textures: { all: 'plate' },
  pushBehavior: 'destroy',
});
registerBlock({
  id: B.WIRE,
  name: 'wire',
  displayName: 'Signal Wire',
  category: 'mechanisms',
  ...PART_DEFAULTS,
  solid: false,
  hardness: 0,
  shape: 'wire',
  circuit: 'wire',
  textures: { all: 'wire_off', on: 'wire_on' },
  pushBehavior: 'destroy',
});
registerBlock({ id: B.LAMP, name: 'lamp', displayName: 'Signal Lamp', category: 'mechanisms', hardness: 0.4, circuit: 'consumer', textures: { all: 'lamp_off', on: 'lamp_on' } });
registerBlock({
  id: B.PISTON,
  name: 'piston',
  displayName: 'Piston',
  category: 'mechanisms',
  hardness: 1,
  orientation: 'all',
  interactive: true,
  circuit: 'piston',
  textures: { side: 'piston_side', front: 'piston_front', back: 'piston_back' },
});
registerBlock({
  id: B.STICKY_PISTON,
  name: 'sticky_piston',
  displayName: 'Sticky Piston',
  category: 'mechanisms',
  hardness: 1,
  orientation: 'all',
  interactive: true,
  circuit: 'piston',
  textures: { side: 'piston_side', front: 'piston_front_sticky', back: 'piston_back' },
});
registerBlock({
  id: B.PISTON_ARM,
  name: 'piston_arm',
  displayName: 'Piston Arm',
  category: 'hidden',
  ...PART_DEFAULTS,
  renderLayer: 'opaque',
  breakable: false,
  hardness: Infinity,
  shape: 'pistonArm',
  orientation: 'all',
  textures: { all: 'piston_arm', front: 'piston_front' },
  pushBehavior: 'immovable',
  obtainable: false,
  drops: null,
});
const gateBase: Partial<BlockDefinition> = {
  category: 'mechanisms',
  ...PART_DEFAULTS,
  renderLayer: 'opaque',
  hardness: 0.3,
  shape: 'gate',
  orientation: 'horizontal',
  pushBehavior: 'destroy',
};
registerBlock({ id: B.REPEATER, name: 'repeater', displayName: 'Repeater', ...gateBase, interactive: true, circuit: 'repeater', textures: { top: 'repeater', on: 'repeater_on', side: 'gate_side' } });
registerBlock({ id: B.INVERTER, name: 'inverter', displayName: 'Inverter', ...gateBase, circuit: 'inverter', textures: { top: 'inverter', on: 'inverter_on', side: 'gate_side' } });
registerBlock({ id: B.AND_GATE, name: 'and_gate', displayName: 'AND Gate', ...gateBase, circuit: 'andGate', textures: { top: 'and_gate', on: 'and_gate_on', side: 'gate_side' } });
registerBlock({ id: B.OR_GATE, name: 'or_gate', displayName: 'OR Gate', ...gateBase, circuit: 'orGate', textures: { top: 'or_gate', on: 'or_gate_on', side: 'gate_side' } });
registerBlock({ id: B.TIMER, name: 'timer', displayName: 'Timer', category: 'mechanisms', hardness: 0.8, interactive: true, circuit: 'timer', textures: { all: 'timer', on: 'timer_on' } });
registerBlock({ id: B.CHEST, name: 'chest', displayName: 'Chest', category: 'decoration', hardness: 1, orientation: 'horizontal', interactive: true, textures: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }, pushBehavior: 'immovable' });
registerBlock({ id: B.CRAFTING_TABLE, name: 'crafting_table', displayName: 'Crafting Table', category: 'decoration', hardness: 1.2, orientation: 'horizontal', interactive: true, textures: { top: 'crafting_top', bottom: 'planks', side: 'crafting_side', front: 'crafting_front' } });

for (let id = 0; id < BLOCK_COUNT; id++) {
  if (!registry[id]) throw new Error(`Block id ${id} has no definition`);
}

export function getBlock(id: number): BlockDefinition {
  return registry[id] ?? registry[B.AIR];
}

export function getBlockByName(name: string): BlockDefinition | undefined {
  return byName.get(name);
}

export function allBlocks(): readonly BlockDefinition[] {
  return registry;
}

export function isValidBlockId(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < BLOCK_COUNT;
}

// Precomputed lookup tables for hot loops (meshing, lighting, physics).
export const OCCLUDES = new Uint8Array(BLOCK_COUNT);
export const TRANSPARENT = new Uint8Array(BLOCK_COUNT);
export const SOLID = new Uint8Array(BLOCK_COUNT);
export const LIGHT_FILTER = new Uint8Array(BLOCK_COUNT);
for (const def of registry) {
  OCCLUDES[def.id] = def.occludes ? 1 : 0;
  TRANSPARENT[def.id] = def.transparent ? 1 : 0;
  SOLID[def.id] = def.solid ? 1 : 0;
  LIGHT_FILTER[def.id] = def.lightFilter;
}

/** Light emitted by a block in its current state (lamps only glow while powered). */
export function getLightEmission(id: number, meta: number): number {
  if (id === B.LAMP) return isPowered(meta) ? 15 : 0;
  if (id === B.TIMER) return isActive(meta) ? 7 : 0;
  return registry[id]?.lightLevel ?? 0;
}

/** True when the block's alternate "on" texture should be shown. */
export function isVisuallyOn(id: number, meta: number): boolean {
  switch (registry[id]?.circuit) {
    case 'wire':
      return (meta & 0x0f) > 0;
    case 'consumer':
    case 'repeater':
    case 'inverter':
    case 'andGate':
    case 'orGate':
      return isPowered(meta);
    case 'source':
    case 'timer':
      return isActive(meta);
    default:
      return false;
  }
}

/**
 * Resolve the texture tile shown on one face of a block. Directional blocks put
 * their `front` texture on the face they point to.
 */
export function getFaceTile(id: number, meta: number, face: number): TileName {
  const def = getBlock(id);
  const t = def.textures;
  const on = t.on && isVisuallyOn(id, meta);
  if (def.shape === 'gate') {
    if (face === Face.Up) return (on ? t.on : t.top) ?? 'stone';
    return t.side ?? 'stone';
  }
  if (def.orientation === 'all' || def.orientation === 'horizontal') {
    const facing = getFacing(meta);
    if (t.front && face === facing) return t.front;
    if (t.back && face === (facing ^ 1)) return t.back;
  }
  if (on && t.on) return t.on;
  if (face === Face.Up && t.top) return t.top;
  if (face === Face.Down && t.bottom) return t.bottom;
  if (face !== Face.Up && face !== Face.Down && t.side) return t.side;
  return t.all ?? t.side ?? t.top ?? 'stone';
}

/** Tiles used for inventory icons. */
export function getIconTiles(id: number): { top: TileName; side: TileName; front: TileName } {
  const def = getBlock(id);
  const t = def.textures;
  const side = t.side ?? t.all ?? t.top ?? 'stone';
  return {
    top: (def.shape === 'gate' ? t.top : t.top ?? t.all) ?? side,
    side,
    front: t.front ?? side,
  };
}

/** Slab variant: 0 = bottom half, 1 = top half. Door variant: 0 = lower, 1 = upper. */
export function getHalf(meta: number): number {
  return getVariant(meta) & 1;
}

/** Seconds needed to break a block by hand in Survival mode. */
export function getBreakTime(id: number): number {
  const hardness = getBlock(id).hardness;
  return Number.isFinite(hardness) ? hardness * 0.75 : Infinity;
}
