'use client';

import { getItemInfo } from '@/game/items/items';
import { useGame } from '@/stores/game';
import { ItemIcon } from '../inventory/ItemIcon';
import { useGameEngine } from '../game/GameContext';

export function Hotbar() {
  const inventory = useGame((s) => s.inventory);
  const game = useGameEngine();
  if (!inventory) return null;
  const selected = inventory.slots[inventory.selectedSlot];
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1">
      {selected && <span className="hud-text font-pixel text-sm text-white" data-testid="selected-item">{getItemInfo(selected.id).displayName}</span>}
      <div className="flex border-2 border-black bg-black/50 p-0.5" data-testid="hotbar">
        {inventory.slots.slice(0, 9).map((slot, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Hotbar slot ${i + 1}`}
            data-selected={i === inventory.selectedSlot}
            onClick={() => game?.selectSlot(i)}
            className={`relative flex h-11 w-11 items-center justify-center sm:h-12 sm:w-12 ${
              i === inventory.selectedSlot ? 'z-10 outline outline-3 outline-white' : 'border border-neutral-700/80'
            }`}
          >
            {slot && <ItemIcon id={slot.id} count={slot.count} size={32} />}
            <span className="hud-text absolute top-0 left-0.5 text-[9px] text-neutral-300">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
