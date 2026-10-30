import { create } from 'zustand';
import type { InventoryState, PlayerInfo, WeatherWire, WorldInfo } from '@/network/protocol/messages';

export type Panel = 'inventory' | 'chat' | 'pause' | 'settings' | 'players' | null;

export interface ChatEntry {
  id: string;
  kind: 'player' | 'system';
  fromId?: string;
  fromName?: string;
  text: string;
  ts: number;
}

export interface Notice {
  id: number;
  level: 'info' | 'warning' | 'error';
  text: string;
}

export interface HudState {
  x: number;
  y: number;
  z: number;
  facing: string;
  biome: string;
  fps: number;
  frameMs: number;
  chunksLoaded: number;
  chunksMeshed: number;
  drawCalls: number;
  triangles: number;
  meshMs: number;
  target: string | null;
  timeOfDay: number;
  weather: WeatherWire;
  breakProgress: number;
  flying: boolean;
  underwater: boolean;
}

export type GamePhase = 'idle' | 'connecting' | 'joining' | 'loading' | 'playing' | 'error';

interface GameState {
  phase: GamePhase;
  error: string | null;
  world: WorldInfo | null;
  selfId: string | null;
  gameMode: WorldInfo['gameMode'];
  canBuild: boolean;
  isOwner: boolean;
  players: PlayerInfo[];
  inventory: InventoryState | null;
  inventoryKind: 'inventory' | 'crafting' | 'chest';
  panel: Panel;
  chat: ChatEntry[];
  chatDraft: string;
  notices: Notice[];
  hud: HudState;
  thirdPerson: boolean;
  set: (patch: Partial<GameState>) => void;
  setHud: (patch: Partial<HudState>) => void;
  openPanel: (panel: Panel, draft?: string) => void;
  addChat: (entry: ChatEntry) => void;
  notify: (text: string, level?: Notice['level']) => void;
  reset: () => void;
}

const initialHud: HudState = {
  x: 0,
  y: 0,
  z: 0,
  facing: 'North',
  biome: '',
  fps: 0,
  frameMs: 0,
  chunksLoaded: 0,
  chunksMeshed: 0,
  drawCalls: 0,
  triangles: 0,
  meshMs: 0,
  target: null,
  timeOfDay: 6000,
  weather: 'clear',
  breakProgress: 0,
  flying: false,
  underwater: false,
};

let noticeId = 0;

export const useGame = create<GameState>()((set) => ({
  phase: 'idle',
  error: null,
  world: null,
  selfId: null,
  gameMode: 'creative',
  canBuild: true,
  isOwner: false,
  players: [],
  inventory: null,
  inventoryKind: 'inventory',
  panel: null,
  chat: [],
  chatDraft: '',
  notices: [],
  hud: initialHud,
  thirdPerson: false,
  set: (patch) => set(patch),
  setHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),
  openPanel: (panel, draft = '') => set({ panel, chatDraft: draft }),
  addChat: (entry) => set((s) => ({ chat: [...s.chat.slice(-99), entry] })),
  notify: (text, level = 'info') => {
    const id = ++noticeId;
    set((s) => ({ notices: [...s.notices.slice(-4), { id, level, text }] }));
    setTimeout(() => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), 4000);
  },
  reset: () =>
    set({
      phase: 'idle',
      error: null,
      world: null,
      players: [],
      inventory: null,
      inventoryKind: 'inventory',
      panel: null,
      chat: [],
      chatDraft: '',
      notices: [],
      hud: initialHud,
      thirdPerson: false,
    }),
}));
