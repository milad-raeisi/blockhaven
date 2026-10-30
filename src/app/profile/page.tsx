'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { MenuShell } from '@/components/menu/MenuShell';
import { ProfileForm } from '@/components/menu/ProfileForm';
import { Panel } from '@/components/ui/controls';
import { useSession } from '@/stores/session';

function Profile() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const { loaded, load, player } = useSession();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  return (
    <MenuShell title="Player Profile">
      <Panel>
        {!loaded ? (
          <p>Loading...</p>
        ) : (
          <>
            <ProfileForm
              key={player?.id ?? 'new'}
              onSaved={() => {
                setSaved(true);
                if (safeNext) router.push(safeNext);
              }}
            />
            {saved && !safeNext && <p className="mt-3 text-sm text-lime-300">Profile saved.</p>}
            <p className="mt-4 text-xs text-neutral-400">
              Your guest identity is stored in a secure cookie in this browser. Use the same browser to keep your inventory and position in each world.
            </p>
          </>
        )}
      </Panel>
    </MenuShell>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}
