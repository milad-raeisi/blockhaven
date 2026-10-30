import { BLOCK_COUNT } from '../blocks/ids';
import { getBlock, getIconTiles, isValidBlockId } from '../blocks/registry';
import type { TileName } from '../blocks/tiles';

/** Item ids below 256 are block items; non-block items start at 256. */
export const ITEM_ID_OFFSET = 256;

export const I = {
  STICK: 256,
  COAL: 257,
  IRON_INGOT: 258,
  GOLD_INGOT: 259,
  DIAMOND: 260,
} as const;

export interface ItemInfo {
  id: number;
  name: string;
  displayName: string;
  stackSize: number;
  isBlock: boolean;
  /** Flat icon tile for non-block items. */
  icon?: TileName;
}

const NON_BLOCK_ITEMS: ItemInfo[] = [
  { id: I.STICK, name: 'stick', displayName: 'Stick', stackSize: 64, isBlock: false, icon: 'item_stick' },
  { id: I.COAL, name: 'coal', displayName: 'Coal', stackSize: 64, isBlock: false, icon: 'item_coal' },
  { id: I.IRON_INGOT, name: 'iron_ingot', displayName: 'Iron Ingot', stackSize: 64, isBlock: false, icon: 'item_iron_ingot' },
  { id: I.GOLD_INGOT, name: 'gold_ingot', displayName: 'Gold Ingot', stackSize: 64, isBlock: false, icon: 'item_gold_ingot' },
  { id: I.DIAMOND, name: 'diamond', displayName: 'Diamond', stackSize: 64, isBlock: false, icon: 'item_diamond' },
];

const itemMap = new Map<number, ItemInfo>(NON_BLOCK_ITEMS.map((item) => [item.id, item]));

export function isBlockItem(id: number): boolean {
  return id >= 0 && id < BLOCK_COUNT;
}

export function isValidItemId(id: number): boolean {
  if (!Number.isInteger(id)) return false;
  if (isValidBlockId(id)) return id !== 0 && getBlock(id).category !== 'hidden';
  return itemMap.has(id);
}

export function getItemInfo(id: number): ItemInfo {
  const item = itemMap.get(id);
  if (item) return item;
  const def = getBlock(id);
  return { id, name: def.name, displayName: def.displayName, stackSize: def.stackSize, isBlock: true };
}

export function getMaxStack(id: number): number {
  return getItemInfo(id).stackSize;
}

export function allNonBlockItems(): readonly ItemInfo[] {
  return NON_BLOCK_ITEMS;
}

export function getItemIconTiles(id: number): { top: TileName; side: TileName; front: TileName; flat?: TileName } {
  const item = itemMap.get(id);
  if (item?.icon) return { top: item.icon, side: item.icon, front: item.icon, flat: item.icon };
  return getIconTiles(id);
}
