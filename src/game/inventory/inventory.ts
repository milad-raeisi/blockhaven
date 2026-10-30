import { getMaxStack, isValidItemId } from '../items/items';

export interface ItemStack {
  id: number;
  count: number;
}

export type Slot = ItemStack | null;

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export const CRAFT_GRID_SIZE = 9;
export const CHEST_SIZE = 27;

export function createSlots(size: number): Slot[] {
  return new Array<Slot>(size).fill(null);
}

export function cloneSlots(slots: readonly Slot[]): Slot[] {
  return slots.map((s) => (s ? { id: s.id, count: s.count } : null));
}

/** Sanitize slots loaded from storage or received from an untrusted source. */
export function sanitizeSlots(raw: unknown, size: number): Slot[] {
  const result = createSlots(size);
  if (!Array.isArray(raw)) return result;
  for (let i = 0; i < size && i < raw.length; i++) {
    const s = raw[i] as { id?: unknown; count?: unknown } | null;
    if (!s || typeof s !== 'object') continue;
    const id = Number(s.id);
    const count = Math.floor(Number(s.count));
    if (!isValidItemId(id) || !Number.isFinite(count) || count <= 0) continue;
    result[i] = { id, count: Math.min(count, getMaxStack(id)) };
  }
  return result;
}

/** Add items, filling existing stacks first. Returns the count that did not fit. */
export function addItem(slots: Slot[], id: number, count: number, preferHotbar = true): number {
  if (!isValidItemId(id) || count <= 0) return count;
  const max = getMaxStack(id);
  let remaining = count;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const s = slots[i];
    if (s && s.id === id && s.count < max) {
      const add = Math.min(max - s.count, remaining);
      s.count += add;
      remaining -= add;
    }
  }
  const order = preferHotbar ? slots.map((_, i) => i) : slots.map((_, i) => i).reverse();
  for (const i of order) {
    if (remaining <= 0) break;
    if (!slots[i]) {
      const add = Math.min(max, remaining);
      slots[i] = { id, count: add };
      remaining -= add;
    }
  }
  return remaining;
}

export function countItem(slots: readonly Slot[], id: number): number {
  let total = 0;
  for (const s of slots) if (s && s.id === id) total += s.count;
  return total;
}

/** Remove `count` items from one slot. Returns false if the slot lacks them. */
export function removeFromSlot(slots: Slot[], index: number, count = 1): boolean {
  const s = slots[index];
  if (!s || s.count < count) return false;
  s.count -= count;
  if (s.count <= 0) slots[index] = null;
  return true;
}

export interface MoveResult {
  ok: boolean;
  reason?: string;
}

/**
 * Move items between two slot arrays (which may be the same array). Merges
 * matching stacks, otherwise swaps when moving a whole stack.
 */
export function moveItems(
  from: Slot[],
  fromIndex: number,
  to: Slot[],
  toIndex: number,
  count?: number,
): MoveResult {
  if (fromIndex < 0 || fromIndex >= from.length || toIndex < 0 || toIndex >= to.length) {
    return { ok: false, reason: 'Invalid slot' };
  }
  if (from === to && fromIndex === toIndex) return { ok: true };
  const src = from[fromIndex];
  if (!src) return { ok: false, reason: 'Source slot is empty' };
  const amount = count === undefined ? src.count : Math.floor(count);
  if (amount <= 0 || amount > src.count) return { ok: false, reason: 'Invalid amount' };
  const dst = to[toIndex];
  if (!dst) {
    to[toIndex] = { id: src.id, count: amount };
    src.count -= amount;
    if (src.count <= 0) from[fromIndex] = null;
    return { ok: true };
  }
  if (dst.id === src.id) {
    const space = getMaxStack(dst.id) - dst.count;
    const moved = Math.min(space, amount);
    if (moved <= 0) return { ok: false, reason: 'Target stack is full' };
    dst.count += moved;
    src.count -= moved;
    if (src.count <= 0) from[fromIndex] = null;
    return { ok: true };
  }
  if (amount !== src.count) return { ok: false, reason: 'Target slot is occupied' };
  to[toIndex] = src;
  from[fromIndex] = dst;
  return { ok: true };
}
