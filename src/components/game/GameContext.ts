'use client';

import { createContext, useContext } from 'react';
import type { Game } from '@/game/engine/Game';

export const GameContext = createContext<Game | null>(null);

/** The running game engine (null until the world has loaded). */
export function useGameEngine(): Game | null {
  return useContext(GameContext);
}
