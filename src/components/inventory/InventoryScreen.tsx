'use client';

import { useMemo, useState } from 'react';
import { allBlocks, type BlockCategory } from '@/game/blocks/registry';
import { fitsGrid, matchRecipe } from '@/game/crafting/crafting';
import { RECIPES, type Recipe } from '@/game/crafting/recipes';
import { allNonBlockItems, getItemInfo, getMaxStack } from '@/game/items/items';
import { getNetworkClient } from '@/network/client/NetworkClient';
import type { ClientMessage, SlotWire } from '@/network/protocol/messages';
import { useGame } from '@/stores/game';
import { VoxelButton } from '../ui/controls';
import { useGameEngine } from '../game/GameContext';
import { ItemIcon } from './ItemIcon';

type Container = 'inventory' | 'craft' | 'chest';
interface SlotRef {
  container: Container;
  slot: number;
}

type Tab = 'all' | BlockCategory | 'items';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'building', label: 'Building' },
  { id: 'natural', label: 'Natural' },
  { id: 'decoration', label: 'Decoration' },
  { id: 'mechanisms', label: 'Mechanisms' },
  { id: 'items', label: 'Items' },
];

const DRAG_TYPE = 'application/x-blockhaven-slot';

function SlotView({
  item,
  selected,
  testId,
  onClick,
  onRightClick,
  onDragStartRef,
  onDropRef,
}: {
  item: SlotWire | null;
  selected?: boolean;
  testId?: string;
  onClick: (e: React.MouseEvent) => void;
  onRightClick?: () => void;
  onDragStartRef?: (e: React.DragEvent) => void;
  onDropRef?: (e: React.DragEvent) => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      draggable={!!item && !!onDragStartRef}
      onDragStart={onDragStartRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropRef}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick?.();
      }}
      title={item ? `${getItemInfo(item.id).displayName}${item.count > 1 ? ` ×${item.count}` : ''}` : undefined}
      className={`slot flex h-11 w-11 items-center justify-center sm:h-12 sm:w-12 ${selected ? 'outline outline-3 outline-lime-400' : ''}`}
    >
      {item && <ItemIcon id={item.id} count={item.count} size={32} />}
    </button>
  );
}

/** Inventory, crafting grid, Creative item palette and chest contents. Every change is validated by the server. */
export function InventoryScreen() {
  const game = useGameEngine();
  const { inventory, inventoryKind, gameMode, world, notify } = useGame();
  const [held, setHeld] = useState<SlotRef | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [hover, setHover] = useState<string | null>(null);

  const send = (msg: Omit<ClientMessage, 'worldId'> & { type: ClientMessage['type'] }) => {
    if (!world) return;
    getNetworkClient().send({ ...msg, worldId: world.id } as ClientMessage);
  };

  const palette = useMemo(() => {
    const blocks = allBlocks()
      .filter((b) => b.obtainable)
      .map((b) => ({ id: b.id, name: b.displayName, category: b.category as Tab }));
    const items = allNonBlockItems().map((i) => ({ id: i.id, name: i.displayName, category: 'items' as Tab }));
    const q = search.trim().toLowerCase();
    return [...blocks, ...items].filter((e) => (tab === 'all' || e.category === tab) && (!q || e.name.toLowerCase().includes(q)));
  }, [tab, search]);

  if (!inventory || !world) return null;
  const creative = gameMode === 'creative';
  const gridSize = inventory.gridSize;
  const showCrafting = !creative || inventoryKind === 'crafting';
  const chest = inventory.chest;

  const slotsOf = (container: Container): (SlotWire | null)[] =>
    container === 'inventory' ? inventory.slots : container === 'craft' ? inventory.craft : (chest?.slots ?? []);

  const move = (from: SlotRef, to: SlotRef, count?: number) => {
    send({ type: 'inventory:move', from, to, ...(count ? { count } : {}) } as ClientMessage);
  };

  /** Shift-click: send a stack to the "other side". */
  const quickMove = (ref: SlotRef) => {
    const item = slotsOf(ref.container)[ref.slot];
    if (!item) return;
    let target: SlotRef | null = null;
    const findIn = (container: Container, from: number, to: number) => {
      const slots = slotsOf(container);
      for (let i = from; i < to; i++) if (slots[i]?.id === item.id && slots[i]!.count < getMaxStack(item.id)) return { container, slot: i };
      for (let i = from; i < to; i++) if (!slots[i]) return { container, slot: i };
      return null;
    };
    if (ref.container === 'inventory') {
      if (chest) target = findIn('chest', 0, 27);
      else target = ref.slot < 9 ? findIn('inventory', 9, 36) : findIn('inventory', 0, 9);
    } else {
      target = findIn('inventory', 0, 36);
    }
    if (target) move(ref, target);
  };

  const clickSlot = (ref: SlotRef, e: React.MouseEvent, single = false) => {
    if (e.shiftKey) {
      quickMove(ref);
      setHeld(null);
      return;
    }
    if (!held) {
      if (slotsOf(ref.container)[ref.slot]) setHeld(ref);
      return;
    }
    if (held.container !== ref.container || held.slot !== ref.slot) move(held, ref, single ? 1 : undefined);
    setHeld(null);
  };

  const dragStart = (ref: SlotRef) => (e: React.DragEvent) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ref }));
  const dropOn = (ref: SlotRef) => (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    const data = JSON.parse(raw) as { ref?: SlotRef; palette?: number };
    if (data.palette !== undefined && ref.container === 'inventory') {
      send({ type: 'inventory:creative-set', slot: ref.slot, item: data.palette, count: getMaxStack(data.palette) } as ClientMessage);
    } else if (data.ref && (data.ref.container !== ref.container || data.ref.slot !== ref.slot)) {
      move(data.ref, ref);
    }
    setHeld(null);
  };

  const renderSlot = (container: Container, slot: number) => {
    const ref = { container, slot };
    const item = slotsOf(container)[slot] ?? null;
    return (
      <div key={`${container}-${slot}`} onMouseEnter={() => setHover(item ? getItemInfo(item.id).displayName : null)} onMouseLeave={() => setHover(null)}>
        <SlotView
          item={item}
          testId={`slot-${container}-${slot}`}
          selected={held?.container === container && held.slot === slot}
          onClick={(e) => clickSlot(ref, e)}
          onRightClick={() => (held ? clickSlot(ref, { shiftKey: false } as React.MouseEvent, true) : undefined)}
          onDragStartRef={dragStart(ref)}
          onDropRef={dropOn(ref)}
        />
      </div>
    );
  };

  const fillRecipe = (recipe: Recipe) => {
    if (inventory.craft.some(Boolean)) {
      notify('Clear the crafting grid first.', 'warning');
      return;
    }
    const counts = inventory.slots.map((s) => (s ? { ...s } : null));
    const cells: { slot: number; id: number }[] = [];
    if (recipe.type === 'shaped') {
      recipe.pattern.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && cells.push({ slot: y * 3 + x, id: recipe.key[ch] })));
    } else {
      const order = gridSize === 2 ? [0, 1, 3, 4] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
      recipe.ingredients.forEach((id, i) => cells.push({ slot: order[i], id }));
    }
    const moves: [number, number][] = [];
    for (const cell of cells) {
      const from = counts.findIndex((s) => s?.id === cell.id && s.count > 0);
      if (from < 0) {
        notify(`Missing ingredient: ${getItemInfo(cell.id).displayName}`, 'warning');
        return;
      }
      counts[from]!.count--;
      moves.push([from, cell.slot]);
    }
    for (const [from, to] of moves) move({ container: 'inventory', slot: from }, { container: 'craft', slot: to }, 1);
  };

  const craftResult = inventory.craftResult;
  const preview = matchRecipe(inventory.craft, gridSize);
  const craftable = RECIPES.filter((r) => fitsGrid(r, gridSize));
  const close = () => game?.closeInventory();
  const gridCells = gridSize === 3 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 3, 4];

  return (
    <div
      className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/55 p-2"
      data-testid="inventory-screen"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="panel-voxel w-full max-w-4xl space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-pixel text-xl">{chest ? 'Chest' : inventoryKind === 'crafting' ? 'Crafting Table' : creative ? 'Creative Inventory' : 'Inventory'}</h2>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-neutral-400 sm:inline">Click to pick up, click again to place · Shift+click to move · Right click places one</span>
            <VoxelButton onClick={close} data-testid="close-inventory">
              Close
            </VoxelButton>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          {creative && !chest && (
            <div className="flex-1 space-y-2" data-testid="creative-palette">
              <div className="flex flex-wrap gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`border-2 border-black px-2 py-1 text-xs font-bold ${tab === t.id ? 'bg-lime-700' : 'bg-neutral-700'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                className="w-full border-2 border-black bg-neutral-900 px-2 py-1 text-sm outline-none"
                placeholder="Search blocks and items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                data-testid="creative-search"
              />
              <div className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1 overflow-y-auto bg-black/30 p-1">
                {palette.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    draggable
                    title={entry.name}
                    data-testid={`palette-${entry.id}`}
                    onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ palette: entry.id }))}
                    onClick={() => send({ type: 'inventory:creative-set', slot: inventory.selectedSlot, item: entry.id, count: getMaxStack(entry.id) } as ClientMessage)}
                    onMouseEnter={() => setHover(entry.name)}
                    onMouseLeave={() => setHover(null)}
                    className="slot flex h-11 w-11 items-center justify-center hover:brightness-125"
                  >
                    <ItemIcon id={entry.id} size={32} />
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-400">Click an item to put it in the selected hotbar slot, or drag it onto any slot.</p>
            </div>
          )}

          {showCrafting && !chest && (
            <div className="space-y-2" data-testid="crafting-area">
              <h3 className="font-pixel text-sm">Crafting {gridSize}×{gridSize}</h3>
              <div className="flex items-center gap-3">
                <div className={`grid gap-1 ${gridSize === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{gridCells.map((i) => renderSlot('craft', i))}</div>
                <span className="font-pixel text-2xl">→</span>
                <SlotView
                  item={craftResult}
                  testId="craft-result"
                  onClick={(e) => send({ type: 'crafting:take', all: e.shiftKey } as ClientMessage)}
                />
              </div>
              {preview && <p className="text-xs text-lime-300">Result: {getItemInfo(preview.result.id).displayName} ×{preview.result.count} (Shift+click crafts all)</p>}
              <details className="max-w-xs text-xs">
                <summary className="cursor-pointer font-bold">Recipe book ({craftable.length})</summary>
                <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                  {craftable.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="flex w-full items-center gap-2 bg-black/30 px-1 py-0.5 text-left hover:bg-black/60" onClick={() => fillRecipe(r)}>
                        <ItemIcon id={r.result.id} size={20} />
                        <span>
                          {getItemInfo(r.result.id).displayName} ×{r.result.count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
              {inventoryKind !== 'crafting' && <p className="text-xs text-neutral-400">Use a Crafting Table for 3×3 recipes.</p>}
            </div>
          )}

          {chest && (
            <div className="space-y-2" data-testid="chest-area">
              <h3 className="font-pixel text-sm">Chest</h3>
              <div className="grid grid-cols-9 gap-1">{Array.from({ length: 27 }, (_, i) => renderSlot('chest', i))}</div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="font-pixel text-sm">Inventory</h3>
          <div className="grid w-fit grid-cols-9 gap-1">{Array.from({ length: 27 }, (_, i) => renderSlot('inventory', i + 9))}</div>
          <div className="grid w-fit grid-cols-9 gap-1 pt-2">{Array.from({ length: 9 }, (_, i) => renderSlot('inventory', i))}</div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="font-pixel text-amber-200" data-testid="hover-item">
            {hover ?? ' '}
          </span>
          {creative && (
            <div
              className="slot flex h-11 w-24 items-center justify-center text-xs text-black"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData(DRAG_TYPE);
                const data = raw ? (JSON.parse(raw) as { ref?: SlotRef }) : {};
                if (data.ref?.container === 'inventory') send({ type: 'inventory:creative-set', slot: data.ref.slot, item: null, count: 1 } as ClientMessage);
              }}
              onClick={() => {
                if (held?.container === 'inventory') send({ type: 'inventory:creative-set', slot: held.slot, item: null, count: 1 } as ClientMessage);
                setHeld(null);
              }}
              data-testid="trash-slot"
            >
              🗑 Delete
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
