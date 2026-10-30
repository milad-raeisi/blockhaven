import { create } from 'zustand';
import type { ConnectionStatus } from '@/network/client/NetworkClient';

interface ConnectionState {
  status: ConnectionStatus;
  error: string | null;
  latency: number;
  setStatus: (status: ConnectionStatus, error: string | null) => void;
  setLatency: (latency: number) => void;
}

export const useConnection = create<ConnectionState>()((set) => ({
  status: 'idle',
  error: null,
  latency: 0,
  setStatus: (status, error) => set({ status, error }),
  setLatency: (latency) => set({ latency }),
}));

export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
  failed: 'Connection Failed',
};
