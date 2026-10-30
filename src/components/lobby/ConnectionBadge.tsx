'use client';

import { STATUS_LABELS, useConnection } from '@/stores/connection';

const COLORS: Record<string, string> = {
  connected: 'bg-lime-500',
  connecting: 'bg-amber-400 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-neutral-500',
  failed: 'bg-red-600',
  idle: 'bg-neutral-500',
};

export function ConnectionBadge({ showLatency = false }: { showLatency?: boolean }) {
  const { status, latency } = useConnection();
  return (
    <span data-testid="connection-status" data-status={status} className="inline-flex items-center gap-2 border-2 border-black bg-black/60 px-2 py-1 font-pixel text-xs text-white">
      <span className={`h-2.5 w-2.5 ${COLORS[status]}`} />
      {STATUS_LABELS[status]}
      {showLatency && status === 'connected' && <span className="text-neutral-400">{latency} ms</span>}
    </span>
  );
}
