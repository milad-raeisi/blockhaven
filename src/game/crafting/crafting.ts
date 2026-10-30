import type { Slot } from '../inventory/inventory';
import { RECIPES, type Recipe, type ShapedRecipe } from './recipes';

/** The crafting grid is always stored as 3x3 (row-major); small grids use the top-left 2x2. */
export const GRID_WIDTH = 3;

export function recipeSize(recipe: Recipe): { width: number; height: number } {
  if (recipe.type === 'shapeless') {
    return recipe.ingredients.length <= 4 ? { width: 2, height: 2 } : { width: 3, height: 3 };
  }
  return { width: Math.max(...recipe.pattern.map((r) => r.length)), height: recipe.pattern.length };
}

/** Whether a recipe fits in a grid of the given size. */
export function fitsGrid(recipe: Recipe, gridSize: 2 | 3): boolean {
  const { width, height } = recipeSize(recipe);
  return width <= gridSize && height <= gridSize;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function gridBounds(grid: readonly Slot[]): Bounds | null {
  let minX = 3;
  let minY = 3;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < 9; i++) {
    if (!grid[i]) continue;
    const x = i % GRID_WIDTH;
    const y = Math.floor(i / GRID_WIDTH);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function matchesShaped(recipe: ShapedRecipe, grid: readonly Slot[], b: Bounds): boolean {
  const height = recipe.pattern.length;
  const width = Math.max(...recipe.pattern.map((r) => r.length));
  if (b.maxX - b.minX + 1 !== width || b.maxY - b.minY + 1 !== height) return false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = recipe.pattern[y][x] ?? ' ';
      const slot = grid[(b.minY + y) * GRID_WIDTH + b.minX + x];
      if (ch === ' ') {
        if (slot) return false;
      } else if (!slot || slot.id !== recipe.key[ch]) {
        return false;
      }
    }
  }
  return true;
}

function matchesShapeless(ingredients: readonly number[], grid: readonly Slot[]): boolean {
  const present = grid.filter((s): s is NonNullable<Slot> => s !== null).map((s) => s.id);
  if (present.length !== ingredients.length) return false;
  const needed = [...ingredients].sort((a, b) => a - b);
  present.sort((a, b) => a - b);
  return needed.every((id, i) => id === present[i]);
}

/** Find the recipe matching the current grid contents. */
export function matchRecipe(grid: readonly Slot[], gridSize: 2 | 3): Recipe | null {
  const bounds = gridBounds(grid);
  if (!bounds) return null;
  if (gridSize === 2 && (bounds.maxX > 1 || bounds.maxY > 1)) return null;
  for (const recipe of RECIPES) {
    if (!fitsGrid(recipe, gridSize)) continue;
    if (recipe.type === 'shaped' ? matchesShaped(recipe, grid, bounds) : matchesShapeless(recipe.ingredients, grid)) {
      return recipe;
    }
  }
  return null;
}

/** Consume one item from every occupied grid cell. */
export function consumeIngredients(grid: Slot[]): void {
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    s.count -= 1;
    if (s.count <= 0) grid[i] = null;
  }
}
