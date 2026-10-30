'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getNetworkClient } from '@/network/client/NetworkClient';
import { useGame } from '@/stores/game';
import { SettingsForm } from '../menu/SettingsForm';
import { VoxelButton } from '../ui/controls';
import { useGameEngine } from '../game/GameContext';

export function PauseMenu() {
  const router = useRouter();
  const game = useGameEngine();
  const { world, isOwner, openPanel } = useGame();
  const [copied, setCopied] = useState(false);

  const resume = () => {
    openPanel(null);
    game?.requestPointerLock();
  };

  const copyCode = async () => {
    if (!world) return;
    try {
      await navigator.clipboard.writeText(world.id);
      setCopied(true);
    } catch {
      window.prompt('World code', world.id);
    }
  };

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55" data-testid="pause-menu">
      <div className="panel-voxel w-full max-w-sm space-y-3 p-5">
        <h2 className="text-center font-pixel text-2xl">Game Menu</h2>
        <VoxelButton variant="primary" className="w-full" onClick={resume} data-testid="resume">
          Resume Game
        </VoxelButton>
        <VoxelButton className="w-full" onClick={() => openPanel('settings')}>
          Settings
        </VoxelButton>
        <VoxelButton
          className="w-full"
          disabled={!isOwner}
          title={isOwner ? 'Save the world now' : 'Only the world owner can save manually (worlds also save automatically)'}
          onClick={() => world && getNetworkClient().send({ type: 'world:save', worldId: world.id })}
        >
          Save World
        </VoxelButton>
        <VoxelButton className="w-full" onClick={() => openPanel('players')}>
          Players
        </VoxelButton>
        <VoxelButton className="w-full" onClick={() => void copyCode()}>
          {copied ? 'World code copied!' : 'Copy World Code'}
        </VoxelButton>
        <VoxelButton variant="danger" className="w-full" onClick={() => router.push('/multiplayer')} data-testid="return-to-lobby">
          Return to Lobby
        </VoxelButton>
        <p className="text-center text-xs text-neutral-400">The game keeps running while this menu is open. Worlds save automatically.</p>
      </div>
    </div>
  );
}

export function SettingsOverlay() {
  const openPanel = useGame((s) => s.openPanel);
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <div className="panel-voxel w-full max-w-3xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-pixel text-2xl">Settings</h2>
          <VoxelButton variant="primary" onClick={() => openPanel('pause')}>
            Done
          </VoxelButton>
        </div>
        <SettingsForm />
      </div>
    </div>
  );
}
