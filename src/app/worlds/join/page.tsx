'use client';

import { useState } from 'react';
import { WorldList } from '@/components/lobby/WorldList';
import { MenuShell } from '@/components/menu/MenuShell';
import { ProfileGate } from '@/components/menu/ProfileGate';
import { ErrorText, Field, inputClass, Panel, VoxelButton } from '@/components/ui/controls';
import { useLobby } from '@/hooks/useLobby';
import { api } from '@/lib/api';
import type { WorldSummary } from '@/network/protocol/messages';

function JoinWorld() {
  const [code, setCode] = useState('');
  const [found, setFound] = useState<WorldSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { worlds } = useLobby(true);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFound(null);
    try {
      setFound((await api.getWorld(code.trim())).world);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'World not found');
    }
  };

  return (
    <div className="space-y-6">
      <Panel title="Join with a world code">
        <form onSubmit={lookup} className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <Field label="World code" hint="Ask the host for the code shown in their lobby or pause menu.">
              <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. cmx3k2..." data-testid="world-code" />
            </Field>
          </div>
          <VoxelButton type="submit" variant="primary" disabled={!code.trim()}>
            Find World
          </VoxelButton>
        </form>
        <div className="mt-4 space-y-3">
          <ErrorText>{error}</ErrorText>
          {found && <WorldList worlds={[found]} emptyText="" />}
        </div>
      </Panel>
      <div>
        <h3 className="hud-text mb-3 font-pixel text-lg">Public worlds</h3>
        {worlds === null ? <p className="hud-text text-neutral-300">Loading...</p> : <WorldList worlds={worlds.filter((w) => w.visibility === 'public')} emptyText="No public worlds right now." />}
      </div>
    </div>
  );
}

export default function JoinWorldPage() {
  return (
    <MenuShell title="Join World" back="/multiplayer" wide>
      <ProfileGate>
        <JoinWorld />
      </ProfileGate>
    </MenuShell>
  );
}
