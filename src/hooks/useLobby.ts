'use client';

import { useEffect, useState } from 'react';
import { getNetworkClient } from '@/network/client/NetworkClient';
import type { WorldSummary } from '@/network/protocol/messages';
import { useConnection } from '@/stores/connection';

/** Live world list over the WebSocket lobby subscription. */
export function useLobby(enabled: boolean): { worlds: WorldSummary[] | null; error: string | null } {
  const [worlds, setWorlds] = useState<WorldSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setStatus = useConnection((s) => s.setStatus);

  useEffect(() => {
    if (!enabled) return;
    const net = getNetworkClient();
    const offStatus = net.onStatus((status, err) => {
      setStatus(status, err);
      if (status === 'connected') net.send({ type: 'lobby:subscribe' });
    });
    const offWorlds = net.on('lobby:worlds', (msg) => setWorlds(msg.worlds));
    net.connect().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Connection failed'));
    return () => {
      net.send({ type: 'lobby:unsubscribe' });
      offStatus();
      offWorlds();
    };
  }, [enabled, setStatus]);

  return { worlds, error };
}
