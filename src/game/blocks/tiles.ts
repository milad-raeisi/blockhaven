/**
 * Texture tile names in atlas order. The renderer paints each tile procedurally
 * (see src/game/renderer/textures.ts); the mesher only needs the indices.
 */
export const TILE_NAMES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'sand',
  'gravel',
  'snow',
  'snow_side',
  'water',
  'log_side',
  'log_top',
  'leaves',
  'coal_ore',
  'iron_ore',
  'gold_ore',
  'diamond_ore',
  'sandstone',
  'sandstone_top',
  'bedrock',
  'cobblestone',
  'stone_bricks',
  'bricks',
  'glass',
  'planks',
  'concrete_white',
  'concrete_red',
  'concrete_orange',
  'concrete_yellow',
  'concrete_green',
  'concrete_blue',
  'concrete_purple',
  'concrete_black',
  'glowstone',
  'door',
  'trapdoor',
  'tall_grass',
  'flower',
  'switch_off',
  'switch_on',
  'button',
  'lever_base',
  'lever_handle',
  'plate',
  'wire_off',
  'wire_on',
  'lamp_off',
  'lamp_on',
  'piston_side',
  'piston_front',
  'piston_front_sticky',
  'piston_back',
  'piston_arm',
  'repeater',
  'repeater_on',
  'inverter',
  'inverter_on',
  'and_gate',
  'and_gate_on',
  'or_gate',
  'or_gate_on',
  'timer',
  'timer_on',
  'gate_side',
  'chest_side',
  'chest_front',
  'chest_top',
  'crafting_top',
  'crafting_side',
  'crafting_front',
  'cactus_side',
  'cactus_top',
  'iron_panel',
  'item_stick',
  'item_coal',
  'item_iron_ingot',
  'item_gold_ingot',
  'item_diamond',
] as const;

export type TileName = (typeof TILE_NAMES)[number];

export const ATLAS_TILES_PER_ROW = 16;
export const TILE_PIXELS = 16;

const tileIndexMap = new Map<string, number>(TILE_NAMES.map((name, i) => [name, i]));

export function tileIndex(name: TileName): number {
  const index = tileIndexMap.get(name);
  if (index === undefined) throw new Error(`Unknown tile: ${name}`);
  return index;
}
