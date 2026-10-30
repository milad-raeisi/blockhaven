import { describe, expect, it } from 'vitest';
import { B } from '../../src/game/blocks/ids';
import { consumeIngredients, matchRecipe } from '../../src/game/crafting/crafting';
import { RECIPES } from '../../src/game/crafting/recipes';
import { addItem, countItem, createSlots, moveItems, removeFromSlot, sanitizeSlots } from '../../src/game/inventory/inventory';
import { I, isValidItemId } from '../../src/game/items/items';

describe('inventory operations', () => {
  it('adds items into existing stacks first, then empty slots', () => {
    const slots = createSlots(36);
    slots[5] = { id: B.DIRT, count: 60 };
    expect(addItem(slots, B.DIRT, 10)).toBe(0);
    expect(slots[5]).toEqual({ id: B.DIRT, count: 64 });
    expect(slots[0]).toEqual({ id: B.DIRT, count: 6 });
    expect(countItem(slots, B.DIRT)).toBe(70);
  });

  it('reports leftovers when full', () => {
    const slots = createSlots(1);
    expect(addItem(slots, B.STONE, 100)).toBe(36);
  });

  it('moves, merges and swaps stacks', () => {
    const slots = createSlots(4);
    slots[0] = { id: B.STONE, count: 10 };
    slots[1] = { id: B.STONE, count: 60 };
    slots[2] = { id: B.DIRT, count: 5 };
    expect(moveItems(slots, 0, slots, 1).ok).toBe(true);
    expect(slots[1]!.count).toBe(64);
    expect(slots[0]!.count).toBe(6);
    expect(moveItems(slots, 0, slots, 2).ok).toBe(true); // swap whole stacks
    expect(slots[0]!.id).toBe(B.DIRT);
    expect(slots[2]!.id).toBe(B.STONE);
    expect(moveItems(slots, 2, slots, 3, 1).ok).toBe(true); // split one item
    expect(slots[3]).toEqual({ id: B.STONE, count: 1 });
    expect(moveItems(slots, 2, slots, 0, 1).ok).toBe(false); // partial stack onto a different item
  });

  it('removes items and clears empty slots', () => {
    const slots = createSlots(1);
    slots[0] = { id: B.SAND, count: 1 };
    expect(removeFromSlot(slots, 0)).toBe(true);
    expect(slots[0]).toBeNull();
    expect(removeFromSlot(slots, 0)).toBe(false);
  });

  it('sanitizes untrusted slot data', () => {
    const slots = sanitizeSlots([{ id: B.STONE, count: 999 }, { id: 9999, count: 1 }, { id: B.AIR, count: 3 }, 'junk', { id: B.DIRT, count: -2 }], 6);
    expect(slots[0]).toEqual({ id: B.STONE, count: 64 });
    expect(slots.slice(1).every((s) => s === null)).toBe(true);
    expect(isValidItemId(B.PISTON_ARM)).toBe(false);
  });
});

describe('crafting', () => {
  const grid = () => createSlots(9);

  it('crafts planks from a log anywhere in the grid (shapeless)', () => {
    const g = grid();
    g[4] = { id: B.LOG, count: 2 };
    const recipe = matchRecipe(g, 3);
    expect(recipe?.result).toEqual({ id: B.PLANKS, count: 4 });
    consumeIngredients(g);
    expect(g[4]).toEqual({ id: B.LOG, count: 1 });
  });

  it('crafts a crafting table from 2x2 planks at any offset', () => {
    const g = grid();
    for (const i of [1, 2, 4, 5]) g[i] = { id: B.PLANKS, count: 1 };
    expect(matchRecipe(g, 3)?.result.id).toBe(B.CRAFTING_TABLE);
    // The same pattern outside the 2x2 area is not available in the small grid.
    expect(matchRecipe(g, 2)).toBeNull();
  });

  it('requires a 3x3 grid for large recipes', () => {
    const g = grid();
    for (const i of [0, 1, 2, 3, 5, 6, 7, 8]) g[i] = { id: B.PLANKS, count: 1 };
    expect(matchRecipe(g, 3)?.result.id).toBe(B.CHEST);
    expect(matchRecipe(g, 2)).toBeNull();
  });

  it('rejects patterns with extra items', () => {
    const g = grid();
    for (const i of [0, 1, 3, 4]) g[i] = { id: B.STONE, count: 1 };
    expect(matchRecipe(g, 2)?.result.id).toBe(B.STONE_BRICKS);
    g[8] = { id: B.DIRT, count: 1 };
    expect(matchRecipe(g, 3)).toBeNull();
  });

  it('matches shaped recipes with mixed ingredients', () => {
    const g = grid();
    g[0] = { id: B.PLANKS, count: 1 };
    g[1] = { id: I.STICK, count: 1 };
    g[2] = { id: B.PLANKS, count: 1 };
    g[3] = { id: B.PLANKS, count: 1 };
    g[4] = { id: I.STICK, count: 1 };
    g[5] = { id: B.PLANKS, count: 1 };
    expect(matchRecipe(g, 3)?.result.id).toBe(B.FENCE);
  });

  it('has unique recipe ids and valid results', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const r of RECIPES) expect(isValidItemId(r.result.id)).toBe(true);
  });
});
