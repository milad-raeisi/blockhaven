'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Game } from '@/game/engine/Game';
import { takeWorldPassword } from '@/lib/api';
import { getNetworkClient } from '@/network/client/NetworkClient';
import { useConnection } from '@/stores/connection';
import { useGame } from '@/stores/game';
import { useSession } from '@/stores/session';
import { useSettings } from '@/stores/settings';
import { Hud } from '../hud/Hud';
import { GameContext } from './GameContext';

/**
 * Connects to the server, joins the world and mounts the Three.js engine.
 * The engine is loaded with a dynamic import so it never runs on the server.
 */
export function GameView({ worldId }: { worldId: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const phase = useGame((s) => s.phase);

  useEffect(() => {
    let disposed = false;
    let instance: Game | null = null;
    const net = getNetworkClient();
    const offStatus = net.onStatus((status, error) => useConnection.getState().setStatus(status, error));

    const start = async () => {
      const store = useGame.getState();
      store.reset();
      store.set({ phase: 'connecting' });
      const session = useSession.getState();
      const player = session.loaded ? session.player : await session.load();
      if (disposed) return;
      if (!player) {
        router.replace(`/profile?next=${encodeURIComponent(`/game?world=${worldId}`)}`);
        return;
      }
      try {
        await net.connect();
        if (disposed) return;
        store.set({ phase: 'joining' });
        const metadata = await net.joinWorld({ worldId, password: takeWorldPassword(worldId), renderDistance: useSettings.getState().renderDistance });
        const { Game: GameClass } = await import('@/game/engine/Game');
        if (disposed || !containerRef.current) {
          net.leaveWorld();
          return;
        }
        instance = new GameClass({ container: containerRef.current, net, metadata });
        instance.start();
        setGame(instance);
      } catch (error) {
        if (!disposed) useGame.getState().set({ phase: 'error', error: error instanceof Error ? error.message : 'Could not join the world.' });
      }
    };
    // Deferred so React Strict Mode's mount/unmount/mount cycle never sends a stray join.
    const timer = setTimeout(() => void start(), 0);

    return () => {
      disposed = true;
      clearTimeout(timer);
      offStatus();
      if (instance) {
        instance.dispose();
        net.leaveWorld();
      }
      setGame(null);
      useGame.getState().reset();
    };
  }, [worldId, router]);

  // Ask before closing the tab mid-game (e.g. an accidental Ctrl+W while crouching).
  useEffect(() => {
    if (phase !== 'playing') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  return (
    <GameContext.Provider value={game}>
      <div className="fixed inset-0 touch-none overflow-hidden bg-black select-none" data-testid="game-root">
        <div ref={containerRef} className="absolute inset-0" />
        <Hud />
      </div>
    </GameContext.Provider>
  );
}
