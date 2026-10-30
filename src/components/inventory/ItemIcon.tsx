'use client';

import { useMemo } from 'react';
import { getItemInfo } from '@/game/items/items';
import { getItemIcon } from '@/game/renderer/icons';

export function ItemIcon({ id, count, size = 36 }: { id: number; count?: number; size?: number }) {
  const src = useMemo(() => getItemIcon(id), [id]);
  return (
    <span className="relative inline-block" style={{ width: size, height: size }} title={getItemInfo(id).displayName}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={getItemInfo(id).displayName} width={size} height={size} className="pixelated pointer-events-none" draggable={false} />
      {count !== undefined && count > 1 && (
        <span className="hud-text pointer-events-none absolute -right-0.5 -bottom-1 font-pixel text-sm font-bold text-white">{count}</span>
      )}
    </span>
  );
}
