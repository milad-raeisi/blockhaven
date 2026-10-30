'use client';

import Link from 'next/link';
import { ConnectionBadge } from '@/components/lobby/ConnectionBadge';
import { WorldList } from '@/components/lobby/WorldList';
import { MenuShell } from '@/components/menu/MenuShell';
import { ProfileGate } from '@/components/menu/ProfileGate';
import { ErrorText, VoxelButton, VoxelLink } from '@/components/ui/controls';
import { useLobby } from '@/hooks/useLobby';
import { getNetworkClient } from '@/network/client/NetworkClient';
import { useConnection } from '@/stores/connection';
import { useSession } from '@/stores/session';

function Lobby() {
  const player = useSession((s) => s.player)!;
  const { worlds, error } = useLobby(true);
  const { status, error: connectionError } = useConnection();

  return (
    <div className="space-y-4">
      <div className="panel-voxel flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="text-sm">
          Playing as <span className="font-pixel text-lime-300">{player.displayName}</span>{' '}
          <Link href="/profile?next=/multiplayer" className="text-xs text-neutral-400 underline">
            change
          </Link>
        </div>
        <ConnectionBadge />
      </div>

      {status === 'failed' && (
        <div className="space-y-2">
          <ErrorText>{connectionError ?? error ?? 'Could not connect to the server.'}</ErrorText>
          <VoxelButton onClick={() => void getNetworkClient().retry().catch(() => undefined)}>Retry connection</VoxelButton>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <VoxelLink href="/worlds/new" variant="primary" className="flex-1">
          Create World
        </VoxelLink>
        <VoxelLink href="/worlds/join" className="flex-1">
          Join by Code
        </VoxelLink>
      </div>

      <h3 className="hud-text font-pixel text-lg text-white">Worlds on this server</h3>
      {worlds === null ? (
        <p className="hud-text text-neutral-300">Loading worlds...</p>
      ) : (
        <WorldList worlds={worlds.filter((w) => w.visibility !== 'private' || w.isOwner)} emptyText="No worlds yet. Create the first one!" />
      )}
    </div>
  );
}

export default function MultiplayerPage() {
  return (
    <MenuShell title="Multiplayer" wide>
      <ProfileGate>
        <Lobby />
      </ProfileGate>
    </MenuShell>
  );
}
