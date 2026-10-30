import { B } from '../../src/game/blocks/ids';
import { getBlock } from '../../src/game/blocks/registry';
import { consumeIngredients, matchRecipe } from '../../src/game/crafting/crafting';
import { addItem, createSlots, moveItems, type Slot } from '../../src/game/inventory/inventory';
import { getMaxStack, isValidItemId } from '../../src/game/items/items';
import type { ClientMessageOf, InventoryState } from '../../src/network/protocol/messages';
import type { ServerPlayer } from './ServerPlayer';

export interface ContainerAccess {
  /** Slots of the chest the player has open, if any. */
  getOpenChestSlots(player: ServerPlayer): Slot[] | null;
  markChestDirty(player: ServerPlayer): void;
}

export interface InventoryResult {
  ok: boolean;
  reason?: string;
}

/** Validated, server-authoritative inventory and crafting operations. */
export class InventoryService {
  constructor(private readonly containers: ContainerAccess) {}

  state(player: ServerPlayer): InventoryState {
    const recipe = matchRecipe(player.craft, player.craftGridSize);
    const chestSlots = this.containers.getOpenChestSlots(player);
    return {
      slots: player.inventory,
      craft: player.craft,
      craftResult: recipe ? { ...recipe.result } : null,
      gridSize: player.craftGridSize,
      selectedSlot: player.selectedSlot,
      chest: player.openChest && chestSlots ? { ...player.openChest, slots: chestSlots } : null,
    };
  }

  private container(player: ServerPlayer, name: 'inventory' | 'craft' | 'chest'): Slot[] | null {
    if (name === 'inventory') return player.inventory;
    if (name === 'craft') return player.craft;
    return this.containers.getOpenChestSlots(player);
  }

  move(player: ServerPlayer, msg: ClientMessageOf<'inventory:move'>): InventoryResult {
    if (player.gameMode === 'spectator') return { ok: false, reason: 'Spectators cannot use inventories' };
    const from = this.container(player, msg.from.container);
    const to = this.container(player, msg.to.container);
    if (!from || !to) return { ok: false, reason: 'Container is not open' };
    for (const ref of [msg.from, msg.to]) {
      if (ref.container === 'craft') {
        if (ref.slot >= 9) return { ok: false, reason: 'Invalid crafting slot' };
        if (player.craftGridSize === 2 && (ref.slot % 3 === 2 || ref.slot >= 6)) return { ok: false, reason: 'Crafting slot unavailable' };
      }
    }
    const result = moveItems(from, msg.from.slot, to, msg.to.slot, msg.count);
    if (result.ok) {
      player.stateDirty = true;
      if (msg.from.container === 'chest' || msg.to.container === 'chest') this.containers.markChestDirty(player);
    }
    return result;
  }

  creativeSet(player: ServerPlayer, msg: ClientMessageOf<'inventory:creative-set'>): InventoryResult {
    if (player.gameMode !== 'creative') return { ok: false, reason: 'Only available in Creative mode' };
    if (msg.item === null || msg.item === 0) {
      player.inventory[msg.slot] = null;
    } else {
      if (!isValidItemId(msg.item)) return { ok: false, reason: 'Unknown item' };
      if (msg.item < 256 && !getBlock(msg.item).obtainable) return { ok: false, reason: 'Item is not obtainable' };
      player.inventory[msg.slot] = { id: msg.item, count: Math.min(msg.count, getMaxStack(msg.item)) };
    }
    player.stateDirty = true;
    return { ok: true };
  }

  /** Craft the current grid result (once, or as many times as possible). */
  craft(player: ServerPlayer, all: boolean): InventoryResult {
    if (player.gameMode === 'spectator') return { ok: false, reason: 'Spectators cannot craft' };
    let crafted = 0;
    const limit = all ? 64 : 1;
    while (crafted < limit) {
      const recipe = matchRecipe(player.craft, player.craftGridSize);
      if (!recipe) break;
      // Make sure the result fits before consuming ingredients.
      const trial = player.inventory.map((s) => (s ? { ...s } : null));
      if (addItem(trial, recipe.result.id, recipe.result.count) > 0) {
        if (crafted === 0) return { ok: false, reason: 'Inventory is full' };
        break;
      }
      consumeIngredients(player.craft);
      player.inventory = trial;
      crafted++;
    }
    if (crafted === 0) return { ok: false, reason: 'Nothing to craft' };
    player.bumpStat('itemsCrafted', crafted);
    return { ok: true };
  }

  /** Return crafting grid items to the inventory and close containers. */
  close(player: ServerPlayer): void {
    for (let i = 0; i < player.craft.length; i++) {
      const s = player.craft[i];
      if (!s) continue;
      addItem(player.inventory, s.id, s.count);
      player.craft[i] = null;
    }
    player.craftGridSize = 2;
    player.openChest = null;
    player.stateDirty = true;
  }

  /** Give a block drop to the player (Survival). Returns false if it did not fit. */
  giveDrop(player: ServerPlayer, blockId: number): void {
    const def = getBlock(blockId);
    if (def.drops === null) return;
    const item = def.drops ?? blockId;
    if (item === B.AIR) return;
    addItem(player.inventory, item, 1);
    player.stateDirty = true;
  }

  /** Default Survival starting inventory (empty) and Creative hotbar. */
  static defaultInventory(creative: boolean): Slot[] {
    const slots = createSlots(36);
    if (creative) {
      const hotbar = [B.GRASS, B.STONE_BRICKS, B.PLANKS, B.GLASS, B.LOG, B.WIRE, B.LEVER, B.LAMP, B.STICKY_PISTON];
      hotbar.forEach((id, i) => (slots[i] = { id, count: getMaxStack(id) }));
    }
    return slots;
  }
}
