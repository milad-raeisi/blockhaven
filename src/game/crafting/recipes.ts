import { B } from '../blocks/ids';
import { I } from '../items/items';

export interface RecipeResult {
  id: number;
  count: number;
}

/** Pattern rows use single characters mapped through `key`; spaces are empty cells. */
export interface ShapedRecipe {
  id: string;
  type: 'shaped';
  pattern: string[];
  key: Record<string, number>;
  result: RecipeResult;
}

export interface ShapelessRecipe {
  id: string;
  type: 'shapeless';
  ingredients: number[];
  result: RecipeResult;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

/**
 * Data-driven recipe registry. Add new recipes here; the crafting system,
 * server validation, and recipe book pick them up automatically.
 */
export const RECIPES: Recipe[] = [
  { id: 'planks', type: 'shapeless', ingredients: [B.LOG], result: { id: B.PLANKS, count: 4 } },
  { id: 'sticks', type: 'shaped', pattern: ['P', 'P'], key: { P: B.PLANKS }, result: { id: I.STICK, count: 4 } },
  { id: 'crafting_table', type: 'shaped', pattern: ['PP', 'PP'], key: { P: B.PLANKS }, result: { id: B.CRAFTING_TABLE, count: 1 } },
  { id: 'stone_bricks', type: 'shaped', pattern: ['SS', 'SS'], key: { S: B.STONE }, result: { id: B.STONE_BRICKS, count: 4 } },
  { id: 'stone_from_cobble', type: 'shapeless', ingredients: [B.COBBLESTONE, I.COAL], result: { id: B.STONE, count: 1 } },
  { id: 'sandstone', type: 'shaped', pattern: ['SS', 'SS'], key: { S: B.SAND }, result: { id: B.SANDSTONE, count: 1 } },
  { id: 'glass', type: 'shapeless', ingredients: [B.SAND, B.SAND, I.COAL], result: { id: B.GLASS, count: 2 } },
  { id: 'bricks', type: 'shapeless', ingredients: [B.DIRT, B.SAND, I.COAL], result: { id: B.BRICKS, count: 2 } },
  { id: 'concrete', type: 'shapeless', ingredients: [B.SAND, B.GRAVEL, B.COBBLESTONE], result: { id: B.CONCRETE, count: 3 } },
  { id: 'concrete_red', type: 'shapeless', ingredients: [B.CONCRETE, B.FLOWER], result: { id: B.CONCRETE_RED, count: 1 } },
  { id: 'concrete_black', type: 'shapeless', ingredients: [B.CONCRETE, I.COAL], result: { id: B.CONCRETE_BLACK, count: 1 } },
  { id: 'concrete_green', type: 'shapeless', ingredients: [B.CONCRETE, B.LEAVES], result: { id: B.CONCRETE_GREEN, count: 1 } },
  { id: 'concrete_yellow', type: 'shapeless', ingredients: [B.CONCRETE, B.SAND], result: { id: B.CONCRETE_YELLOW, count: 1 } },
  { id: 'concrete_orange', type: 'shapeless', ingredients: [B.CONCRETE, B.BRICKS], result: { id: B.CONCRETE_ORANGE, count: 2 } },
  { id: 'concrete_blue', type: 'shapeless', ingredients: [B.CONCRETE, I.DIAMOND], result: { id: B.CONCRETE_BLUE, count: 8 } },
  { id: 'concrete_purple', type: 'shapeless', ingredients: [B.CONCRETE_RED, B.CONCRETE_BLUE], result: { id: B.CONCRETE_PURPLE, count: 2 } },
  { id: 'iron_ingot', type: 'shapeless', ingredients: [B.IRON_ORE, I.COAL], result: { id: I.IRON_INGOT, count: 1 } },
  { id: 'gold_ingot', type: 'shapeless', ingredients: [B.GOLD_ORE, I.COAL], result: { id: I.GOLD_INGOT, count: 1 } },
  { id: 'iron_panel', type: 'shaped', pattern: ['II', 'II'], key: { I: I.IRON_INGOT }, result: { id: B.IRON_PANEL, count: 4 } },
  { id: 'glowstone', type: 'shapeless', ingredients: [I.GOLD_INGOT, I.COAL, B.GLASS], result: { id: B.GLOWSTONE, count: 2 } },
  { id: 'plank_slab', type: 'shaped', pattern: ['PPP'], key: { P: B.PLANKS }, result: { id: B.PLANK_SLAB, count: 6 } },
  { id: 'stone_slab', type: 'shaped', pattern: ['SSS'], key: { S: B.STONE_BRICKS }, result: { id: B.STONE_SLAB, count: 6 } },
  { id: 'plank_stairs', type: 'shaped', pattern: ['P  ', 'PP ', 'PPP'], key: { P: B.PLANKS }, result: { id: B.PLANK_STAIRS, count: 4 } },
  { id: 'stone_stairs', type: 'shaped', pattern: ['C  ', 'CC ', 'CCC'], key: { C: B.COBBLESTONE }, result: { id: B.STONE_STAIRS, count: 4 } },
  { id: 'fence', type: 'shaped', pattern: ['PSP', 'PSP'], key: { P: B.PLANKS, S: I.STICK }, result: { id: B.FENCE, count: 3 } },
  { id: 'door', type: 'shaped', pattern: ['PP', 'PP', 'PP'], key: { P: B.PLANKS }, result: { id: B.DOOR, count: 3 } },
  { id: 'trapdoor', type: 'shaped', pattern: ['PPP', 'PPP'], key: { P: B.PLANKS }, result: { id: B.TRAPDOOR, count: 2 } },
  { id: 'chest', type: 'shaped', pattern: ['PPP', 'P P', 'PPP'], key: { P: B.PLANKS }, result: { id: B.CHEST, count: 1 } },
  { id: 'wire', type: 'shapeless', ingredients: [I.GOLD_INGOT], result: { id: B.WIRE, count: 16 } },
  { id: 'lever', type: 'shaped', pattern: ['S', 'C'], key: { S: I.STICK, C: B.COBBLESTONE }, result: { id: B.LEVER, count: 1 } },
  { id: 'button', type: 'shapeless', ingredients: [B.STONE], result: { id: B.BUTTON, count: 1 } },
  { id: 'pressure_plate', type: 'shaped', pattern: ['SS'], key: { S: B.STONE }, result: { id: B.PRESSURE_PLATE, count: 1 } },
  { id: 'lamp', type: 'shapeless', ingredients: [B.GLOWSTONE, B.WIRE, B.GLASS], result: { id: B.LAMP, count: 1 } },
  { id: 'switch', type: 'shapeless', ingredients: [B.COBBLESTONE, B.WIRE, B.LEVER], result: { id: B.SWITCH, count: 1 } },
  {
    id: 'piston',
    type: 'shaped',
    pattern: ['PPP', 'CIC', 'CWC'],
    key: { P: B.PLANKS, C: B.COBBLESTONE, I: I.IRON_INGOT, W: B.WIRE },
    result: { id: B.PISTON, count: 1 },
  },
  { id: 'sticky_piston', type: 'shapeless', ingredients: [B.PISTON, B.CACTUS], result: { id: B.STICKY_PISTON, count: 1 } },
  { id: 'repeater', type: 'shaped', pattern: ['WIW', 'SSS'], key: { W: B.WIRE, I: I.IRON_INGOT, S: B.STONE }, result: { id: B.REPEATER, count: 1 } },
  { id: 'inverter', type: 'shapeless', ingredients: [B.WIRE, I.STICK, B.STONE], result: { id: B.INVERTER, count: 1 } },
  { id: 'and_gate', type: 'shapeless', ingredients: [B.WIRE, B.WIRE, I.IRON_INGOT, B.STONE], result: { id: B.AND_GATE, count: 1 } },
  { id: 'or_gate', type: 'shapeless', ingredients: [B.WIRE, B.WIRE, I.GOLD_INGOT, B.STONE], result: { id: B.OR_GATE, count: 1 } },
  { id: 'timer', type: 'shapeless', ingredients: [B.REPEATER, B.WIRE, I.GOLD_INGOT], result: { id: B.TIMER, count: 1 } },
];

const recipeIds = new Set<string>();
for (const recipe of RECIPES) {
  if (recipeIds.has(recipe.id)) throw new Error(`Duplicate recipe id: ${recipe.id}`);
  recipeIds.add(recipe.id);
}
