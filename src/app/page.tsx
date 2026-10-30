'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/menu/MenuShell';
import { MenuBackground } from '@/components/menu/MenuBackground';
import { VoxelLink } from '@/components/ui/controls';
import { api, type ServerInfo } from '@/lib/api';
import { useSession } from '@/stores/session';

export default function MainMenu() {
  const { player, loaded, load } = useSession();
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    if (!loaded) void load();
    api.serverInfo().then(setInfo).catch(() => setInfo(null));
  }, [loaded, load]);

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <MenuBackground />
      <div className="text-center">
        <Logo />
        <p className="hud-text mt-3 font-pixel text-sm text-amber-200">Build together on your local network</p>
      </div>

      <nav className="flex w-full max-w-sm flex-col gap-3" aria-label="Main menu" data-testid="main-menu">
        <VoxelLink href="/multiplayer" variant="primary" className="py-3 text-lg">
          Play
        </VoxelLink>
        <div className="grid grid-cols-2 gap-3">
          <VoxelLink href="/singleplayer">Singleplayer</VoxelLink>
          <VoxelLink href="/multiplayer">Multiplayer</VoxelLink>
          <VoxelLink href="/worlds/new">Create World</VoxelLink>
          <VoxelLink href="/worlds/join">Join World</VoxelLink>
          <VoxelLink href="/settings">Settings</VoxelLink>
          <VoxelLink href="/profile">Player Profile</VoxelLink>
        </div>
        <VoxelLink href="/goodbye" variant="danger">
          Exit Game
        </VoxelLink>
      </nav>

      <footer className="hud-text flex flex-col items-center gap-1 text-center text-xs text-neutral-200">
        {player ? (
          <span>
            Playing as <Link href="/profile" className="font-bold text-lime-300 underline">{player.displayName}</Link>
          </span>
        ) : (
          <span>No player profile yet — you will be asked for a name when you play.</span>
        )}
        {info && info.lanUrls.length > 0 && (
          <span data-testid="lan-urls">
            Other devices on your network can join at: {info.lanUrls.map((u) => <code key={u} className="mx-1 select-all bg-black/50 px-1">{u}</code>)}
          </span>
        )}
        {info && <span className="text-neutral-400">Blockhaven {info.version} · {info.playersOnline} player(s) online</span>}
      </footer>
    </main>
  );
}
