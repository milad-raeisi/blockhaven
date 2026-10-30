'use client';

import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/stores/session';
import { Panel } from '../ui/controls';
import { ProfileForm } from './ProfileForm';

/** Renders children once the guest player profile exists; otherwise asks for a name. */
export function ProfileGate({ children }: { children: ReactNode }) {
  const { player, loaded, load, error } = useSession();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (!loaded) return <p className="hud-text font-pixel text-neutral-200">Loading profile...</p>;
  if (!player) {
    return (
      <Panel title="Create your player">
        {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
        <p className="mb-4 text-sm text-neutral-300">Choose a name other players will see. No account or email is needed.</p>
        <ProfileForm submitLabel="Continue" />
      </Panel>
    );
  }
  return <>{children}</>;
}
