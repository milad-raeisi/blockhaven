'use client';

import { useEffect, useState } from 'react';
import { WorldList } from '@/components/lobby/WorldList';
import { MenuShell } from '@/components/menu/MenuShell';
import { ProfileGate } from '@/components/menu/ProfileGate';
import { ErrorText, VoxelLink } from '@/components/ui/controls';
import { api } from '@/lib/api';
import type { WorldSummary } from '@/network/protocol/messages';

function MyWorlds() {
  const [worlds, setWorlds] = useState<WorldSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listWorlds()
      .then(({ worlds }) => setWorlds(worlds.filter((w) => w.isOwner && w.visibility === 'private')))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load worlds'));
  }, []);

  return (
    <div className="space-y-4">
      <p className="hud-text text-sm text-neutral-200">
        Singleplayer worlds are private worlds saved on this server. They use the same world systems as multiplayer, so you can always change your mind later.
      </p>
      <VoxelLink href="/worlds/new?mode=singleplayer" variant="primary">
        New Singleplayer World
      </VoxelLink>
      <ErrorText>{error}</ErrorText>
      {worlds === null ? (
        <p className="hud-text text-neutral-300">Loading...</p>
      ) : (
        <WorldList worlds={worlds} emptyText="You have no singleplayer worlds yet." onDeleted={(id) => setWorlds((w) => w?.filter((x) => x.id !== id) ?? null)} />
      )}
    </div>
  );
}

export default function SingleplayerPage() {
  return (
    <MenuShell title="Singleplayer" wide>
      <ProfileGate>
        <MyWorlds />
      </ProfileGate>
    </MenuShell>
  );
}
