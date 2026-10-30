import { create } from 'zustand';
import { api, type PlayerProfile } from '@/lib/api';
import type { Appearance } from '@/network/protocol/messages';

interface SessionState {
  player: PlayerProfile | null;
  loaded: boolean;
  error: string | null;
  load: () => Promise<PlayerProfile | null>;
  save: (displayName: string, appearance: Appearance) => Promise<PlayerProfile>;
}

export const useSession = create<SessionState>()((set, get) => ({
  player: null,
  loaded: false,
  error: null,
  load: async () => {
    try {
      const { player } = await api.getSession();
      set({ player, loaded: true, error: null });
      return player;
    } catch (error) {
      set({ loaded: true, error: error instanceof Error ? error.message : 'Failed to load profile' });
      return null;
    }
  },
  save: async (displayName, appearance) => {
    const existing = get().player;
    const { player } = existing ? await api.updateProfile({ displayName, appearance }) : await api.createSession(displayName, appearance);
    set({ player, loaded: true, error: null });
    return player;
  },
}));
