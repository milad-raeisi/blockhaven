'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useIsTouch } from '@/hooks/useIsTouch';
import { getNetworkClient } from '@/network/client/NetworkClient';
import { STATUS_LABELS, useConnection } from '@/stores/connection';
import { useGame } from '@/stores/game';
import { useSettings } from '@/stores/settings';
import { ConnectionBadge } from '../lobby/ConnectionBadge';
import { InventoryScreen } from '../inventory/InventoryScreen';
import { VoxelButton } from '../ui/controls';
import { useGameEngine } from '../game/GameContext';
import { Chat } from './Chat';
import { clock, DebugOverlay } from './DebugOverlay';
import { Hotbar } from './Hotbar';
import { PauseMenu, SettingsOverlay } from './PauseMenu';
import { PlayersPanel } from './PlayersPanel';
import { TouchControls } from './TouchControls';

const WEATHER_ICON = { clear: '☀', rain: '☂', snow: '❄' } as const;

function StatusBar() {
  const { world, players, hud, gameMode } = useGame();
  const showFps = useSettings((s) => s.showFps);
  const latency = useConnection((s) => s.latency);
  return (
    <div className="hud-text pointer-events-none absolute top-2 left-2 space-y-1 text-xs text-white" data-testid="status-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-black/50 px-2 py-1 font-pixel text-sm" data-testid="world-name">
          {world?.name}
        </span>
        <ConnectionBadge />
      </div>
      <div className="w-fit bg-black/40 px-2 py-1 font-pixel leading-5">
        <div data-testid="coordinates">
          XYZ: {hud.x.toFixed(1)} / {hud.y.toFixed(1)} / {hud.z.toFixed(1)} · {hud.facing}
        </div>
        <div>
          {WEATHER_ICON[hud.weather]} {clock(hud.timeOfDay)} · {hud.biome} · <span className="capitalize">{gameMode}</span>
          {hud.flying && ' · Flying'}
        </div>
        <div>
          Players: <span data-testid="hud-player-count">{players.length}</span> · Ping: {latency} ms{showFps && <> · FPS: <span data-testid="fps">{hud.fps}</span></>}
        </div>
      </div>
    </div>
  );
}

function Crosshair() {
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 mix-blend-difference" data-testid="crosshair">
      <div className="absolute top-1/2 left-1/2 h-0.5 w-5 -translate-x-1/2 -translate-y-1/2 bg-white" />
      <div className="absolute top-1/2 left-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white" />
    </div>
  );
}

function Notices() {
  const notices = useGame((s) => s.notices);
  return (
    <div className="pointer-events-none absolute top-16 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
      {notices.map((n) => (
        <div
          key={n.id}
          className={`hud-text border-2 border-black px-3 py-1 text-sm ${n.level === 'error' ? 'bg-red-900/85' : n.level === 'warning' ? 'bg-amber-900/85' : 'bg-black/70'}`}
          data-testid="notice"
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}

function TargetInfo() {
  const hud = useGame((s) => s.hud);
  if (!hud.target) return null;
  return (
    <div className="hud-text pointer-events-none absolute top-1/2 left-1/2 mt-6 -translate-x-1/2 bg-black/40 px-2 py-0.5 font-pixel text-xs text-white" data-testid="target-block">
      {hud.target}
      {hud.breakProgress > 0 && <span className="ml-2 text-amber-300">{Math.floor(hud.breakProgress * 100)}%</span>}
    </div>
  );
}

function LoadingScreen() {
  const router = useRouter();
  const { phase, error, hud } = useGame();
  const label = phase === 'connecting' ? 'Connecting to the server...' : phase === 'joining' ? 'Joining the world...' : 'Generating terrain...';
  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#1b1510] p-6 text-center" data-testid="loading-screen">
      {phase === 'error' ? (
        <>
          <h2 className="font-pixel text-2xl text-red-300">Could not enter the world</h2>
          <p className="max-w-md text-neutral-200" data-testid="game-error">
            {error}
          </p>
          <div className="flex gap-3">
            <VoxelButton onClick={() => window.location.reload()}>Try Again</VoxelButton>
            <VoxelButton variant="primary" onClick={() => router.push('/multiplayer')}>
              Back to Lobby
            </VoxelButton>
          </div>
        </>
      ) : (
        <>
          <h2 className="font-pixel text-2xl text-white">{label}</h2>
          <div className="h-3 w-64 border-2 border-black bg-neutral-800">
            <div className="h-full bg-lime-500 transition-all" style={{ width: `${phase === 'loading' ? Math.min(100, 30 + hud.chunksMeshed * 5) : phase === 'joining' ? 20 : 8}%` }} />
          </div>
          <ConnectionBadge />
        </>
      )}
    </div>
  );
}

function ConnectionOverlay() {
  const router = useRouter();
  const { status, error } = useConnection();
  const phase = useGame((s) => s.phase);
  if (phase !== 'playing') return null;
  if (status === 'reconnecting' || status === 'connecting') {
    return (
      <div className="hud-text pointer-events-none absolute top-0 right-0 left-0 bg-amber-700/90 py-1 text-center font-pixel text-sm text-white" data-testid="reconnecting-banner">
        {STATUS_LABELS[status]} — {error ?? 'trying to restore the connection...'}
      </div>
    );
  }
  if (status === 'failed' || status === 'disconnected') {
    return (
      <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/70 p-4">
        <div className="panel-voxel max-w-md space-y-4 p-5 text-center">
          <h2 className="font-pixel text-xl text-red-300">{STATUS_LABELS[status]}</h2>
          <p className="text-neutral-200">{error ?? 'The connection to the server was lost.'}</p>
          <div className="flex justify-center gap-3">
            <VoxelButton onClick={() => void getNetworkClient().retry().catch(() => undefined)}>Retry</VoxelButton>
            <VoxelButton variant="primary" onClick={() => router.push('/multiplayer')}>
              Return to Lobby
            </VoxelButton>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function ClickToPlay() {
  const game = useGameEngine();
  return (
    <button
      type="button"
      onClick={() => game?.requestPointerLock()}
      className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/25"
      data-testid="click-to-play"
    >
      <span className="hud-text border-2 border-black bg-black/60 px-4 py-2 font-pixel text-lg text-white">Click to play</span>
    </button>
  );
}

export function Hud() {
  const { phase, panel } = useGame();
  const showDebug = useSettings((s) => s.showDebug);
  const isTouch = useIsTouch();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const update = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener('pointerlockchange', update);
    return () => document.removeEventListener('pointerlockchange', update);
  }, []);

  const playing = phase === 'playing';
  return (
    <div className="pointer-events-none absolute inset-0 select-none" data-testid="hud">
      {playing && (
        <>
          <StatusBar />
          <TargetInfo />
          {!panel && <Crosshair />}
          <Notices />
          <Chat />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
            <Hotbar />
          </div>
          {isTouch && <TouchControls />}
          {!isTouch && !locked && !panel && <ClickToPlay />}
          {panel === 'inventory' && <InventoryScreen />}
          {panel === 'pause' && <PauseMenu />}
          {panel === 'settings' && <SettingsOverlay />}
          {panel === 'players' && <PlayersPanel />}
          {showDebug && <DebugOverlay />}
        </>
      )}
      {!playing && <LoadingScreen />}
      <ConnectionOverlay />
    </div>
  );
}
