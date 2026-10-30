'use client';

import { getNetworkClient } from '@/network/client/NetworkClient';
import { useGame } from '@/stores/game';
import { useSettings } from '@/stores/settings';
import { VoxelButton } from '../ui/controls';

export function PlayersPanel() {
  const { players, selfId, isOwner, world, openPanel } = useGame();
  const { mutedPlayers, toggleMute } = useSettings();

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55 p-4" data-testid="players-panel">
      <div className="panel-voxel w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-pixel text-xl">
            Players ({players.length}/{world?.maxPlayers ?? '?'})
          </h2>
          <VoxelButton onClick={() => openPanel(null)}>Close</VoxelButton>
        </div>
        <ul className="space-y-2">
          {players.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 border-2 border-black bg-neutral-900/80 px-3 py-2">
              <span className="h-4 w-4 border border-black" style={{ background: p.appearance.shirt }} />
              <span className="flex-1 font-semibold">
                {p.name}
                {p.id === selfId && <span className="ml-1 text-xs text-neutral-400">(you)</span>}
                {p.isOwner && <span className="ml-1 text-xs text-amber-300">owner</span>}
              </span>
              <span className="text-xs uppercase text-neutral-400">{p.gameMode}</span>
              {p.id !== selfId && (
                <VoxelButton className="px-2 py-1 text-xs" onClick={() => toggleMute(p.id)}>
                  {mutedPlayers.includes(p.id) ? 'Unmute' : 'Mute'}
                </VoxelButton>
              )}
              {isOwner && p.id !== selfId && world && (
                <VoxelButton
                  className="px-2 py-1 text-xs"
                  variant={p.canBuild ? 'primary' : 'default'}
                  onClick={() => getNetworkClient().send({ type: 'world:set-permission', worldId: world.id, playerId: p.id, canBuild: !p.canBuild })}
                >
                  {p.canBuild ? 'Can build' : 'View only'}
                </VoxelButton>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
