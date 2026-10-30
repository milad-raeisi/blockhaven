'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { GameView } from '@/components/game/GameView';
import { MenuShell } from '@/components/menu/MenuShell';
import { Panel, VoxelLink } from '@/components/ui/controls';

function GamePage() {
  const worldId = useSearchParams().get('world');
  if (!worldId) {
    return (
      <MenuShell>
        <Panel title="No world selected">
          <VoxelLink href="/multiplayer" variant="primary">
            Go to the lobby
          </VoxelLink>
        </Panel>
      </MenuShell>
    );
  }
  return <GameView worldId={worldId} />;
}

export default function Page() {
  return (
    <Suspense>
      <GamePage />
    </Suspense>
  );
}
