import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_RENDER_DISTANCE } from '@/game/world/constants';
import type { GraphicsQuality, ShadowQuality } from '@/game/renderer/Renderer';

export type KeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'inventory'
  | 'chat'
  | 'command'
  | 'camera'
  | 'players'
  | 'debug';

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  forward: 'Move forward',
  back: 'Move backward',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump / Fly up',
  sprint: 'Sprint',
  crouch: 'Crouch / Fly down',
  inventory: 'Open inventory',
  chat: 'Open chat',
  command: 'Open command',
  camera: 'Toggle camera',
  players: 'Player list',
  debug: 'Debug overlay',
};

export const DEFAULT_KEYBINDINGS: Record<KeyAction, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  inventory: 'KeyE',
  chat: 'KeyT',
  command: 'Slash',
  camera: 'F5',
  players: 'Tab',
  debug: 'F3',
};

export interface SettingsState {
  renderDistance: number;
  fov: number;
  mouseSensitivity: number;
  invertY: boolean;
  shadows: ShadowQuality;
  quality: GraphicsQuality;
  particles: boolean;
  fpsLimit: number;
  showFps: boolean;
  showDebug: boolean;
  volume: number;
  keybindings: Record<KeyAction, string>;
  mutedPlayers: string[];
  set: (patch: Partial<Omit<SettingsState, 'set' | 'reset' | 'setKey' | 'toggleMute'>>) => void;
  setKey: (action: KeyAction, code: string) => void;
  toggleMute: (playerId: string) => void;
  reset: () => void;
}

/** Conservative defaults for phones, tablets and low-core machines. */
function detectDefaults() {
  if (typeof window === 'undefined') return { renderDistance: DEFAULT_RENDER_DISTANCE, quality: 'medium' as const, shadows: 'low' as const };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency || 4;
  const low = coarse || cores <= 4;
  return {
    renderDistance: low ? 4 : DEFAULT_RENDER_DISTANCE,
    quality: (low ? 'low' : 'medium') as GraphicsQuality,
    shadows: (low ? 'off' : 'low') as ShadowQuality,
  };
}

const defaults = () => ({
  ...detectDefaults(),
  fov: 75,
  mouseSensitivity: 1,
  invertY: false,
  particles: true,
  fpsLimit: 0,
  showFps: true,
  showDebug: false,
  volume: 0.6,
  keybindings: { ...DEFAULT_KEYBINDINGS },
  mutedPlayers: [] as string[],
});

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults(),
      set: (patch) => set(patch),
      setKey: (action, code) => set((s) => ({ keybindings: { ...s.keybindings, [action]: code } })),
      toggleMute: (playerId) =>
        set((s) => ({ mutedPlayers: s.mutedPlayers.includes(playerId) ? s.mutedPlayers.filter((p) => p !== playerId) : [...s.mutedPlayers, playerId] })),
      reset: () => set(defaults()),
    }),
    {
      name: 'blockhaven-settings',
      version: 1,
      partialize: ({ set: _set, setKey: _setKey, toggleMute: _toggle, reset: _reset, ...rest }) => rest,
    },
  ),
);
