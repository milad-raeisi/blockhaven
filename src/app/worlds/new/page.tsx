'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CreateWorldForm } from '@/components/lobby/CreateWorldForm';
import { MenuShell } from '@/components/menu/MenuShell';
import { ProfileGate } from '@/components/menu/ProfileGate';

function NewWorld() {
  const single = useSearchParams().get('mode') === 'singleplayer';
  return (
    <MenuShell title={single ? 'New Singleplayer World' : 'Create World'} back={single ? '/singleplayer' : '/multiplayer'} wide>
      <ProfileGate>
        <CreateWorldForm singleplayer={single} />
      </ProfileGate>
    </MenuShell>
  );
}

export default function NewWorldPage() {
  return (
    <Suspense>
      <NewWorld />
    </Suspense>
  );
}
