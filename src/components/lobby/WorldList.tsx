'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, storeWorldPassword } from '@/lib/api';
import type { WorldSummary } from '@/network/protocol/messages';
import { ErrorText, inputClass, VoxelButton } from '../ui/controls';

const MODE_STYLES: Record<string, string> = {
  creative: 'bg-sky-700',
  survival: 'bg-amber-700',
  spectator: 'bg-purple-700',
};

function PasswordPrompt({ world, onCancel, onSubmit }: { world: WorldSummary; onCancel: () => void; onSubmit: (pw: string) => void }) {
  const [password, setPassword] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal>
      <form
        className="panel-voxel w-full max-w-sm space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
        }}
      >
        <h3 className="font-pixel text-lg">“{world.name}” is password protected</h3>
        <input type="password" autoFocus className={inputClass} placeholder="World password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="world-password" />
        <div className="flex gap-2">
          <VoxelButton className="flex-1" onClick={onCancel}>
            Cancel
          </VoxelButton>
          <VoxelButton type="submit" variant="primary" className="flex-1">
            Join
          </VoxelButton>
        </div>
      </form>
    </div>
  );
}

/** World cards with live player counts, join (with password prompt) and delete. */
export function WorldList({ worlds, emptyText, onDeleted }: { worlds: WorldSummary[]; emptyText: string; onDeleted?: (id: string) => void }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState<WorldSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = (world: WorldSummary, password?: string) => {
    if (password) storeWorldPassword(world.id, password);
    router.push(`/game?world=${encodeURIComponent(world.id)}`);
  };

  const remove = async (world: WorldSummary) => {
    if (!window.confirm(`Delete “${world.name}” permanently? This cannot be undone.`)) return;
    try {
      await api.deleteWorld(world.id);
      onDeleted?.(world.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the world');
    }
  };

  if (worlds.length === 0) return <p className="border-2 border-dashed border-neutral-600 bg-black/40 p-6 text-center text-neutral-300">{emptyText}</p>;

  return (
    <>
      <ErrorText>{error}</ErrorText>
      <ul className="space-y-2" data-testid="world-list">
        {worlds.map((w) => {
          const full = w.playerCount >= w.maxPlayers;
          return (
            <li key={w.id} className="panel-voxel flex flex-wrap items-center gap-3 p-3" data-testid="world-card" data-world-name={w.name}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-pixel text-lg text-white">{w.name}</span>
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase ${MODE_STYLES[w.gameMode]}`}>{w.gameMode}</span>
                  {w.hasPassword && <span title="Password protected">🔒</span>}
                  {w.visibility !== 'public' && <span className="text-[10px] uppercase text-neutral-400">{w.visibility}</span>}
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  Host: {w.ownerName} · Terrain: {w.terrainType} · Code: <code className="select-all text-neutral-300">{w.id}</code>
                </div>
              </div>
              <span className={`font-pixel text-sm ${full ? 'text-red-400' : 'text-lime-300'}`} data-testid="player-count">
                {w.playerCount}/{w.maxPlayers}
              </span>
              <VoxelButton
                variant="primary"
                disabled={full}
                data-testid="join-world"
                onClick={() => (w.hasPassword && !w.isOwner ? setPrompt(w) : join(w))}
              >
                {full ? 'Full' : 'Join'}
              </VoxelButton>
              {w.isOwner && (
                <VoxelButton variant="danger" aria-label={`Delete ${w.name}`} onClick={() => void remove(w)}>
                  ✕
                </VoxelButton>
              )}
            </li>
          );
        })}
      </ul>
      {prompt && (
        <PasswordPrompt
          world={prompt}
          onCancel={() => setPrompt(null)}
          onSubmit={(pw) => {
            setPrompt(null);
            join(prompt, pw);
          }}
        />
      )}
    </>
  );
}
