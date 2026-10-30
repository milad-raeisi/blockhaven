'use client';

import { useConnection } from '@/stores/connection';
import { useGame } from '@/stores/game';

export function clock(ticks: number): string {
  // Tick 0 is 6:00; 1000 ticks = 1 hour.
  const hours = (Math.floor(ticks / 1000) + 6) % 24;
  const minutes = Math.floor(((ticks % 1000) / 1000) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}


/** Development performance overlay (F3). */
export function DebugOverlay() {
  const hud = useGame((s) => s.hud);
  const latency = useConnection((s) => s.latency);
  const rows: [string, string][] = [
    ['FPS', `${hud.fps} (${hud.frameMs.toFixed(1)} ms frame)`],
    ['Draw calls', String(hud.drawCalls)],
    ['Triangles', hud.triangles.toLocaleString()],
    ['Chunks', `${hud.chunksMeshed} visible / ${hud.chunksLoaded} loaded`],
    ['Last mesh', `${hud.meshMs.toFixed(1)} ms`],
    ['Latency', `${latency} ms`],
    ['Position', `${hud.x.toFixed(2)} / ${hud.y.toFixed(2)} / ${hud.z.toFixed(2)}`],
    ['Facing', hud.facing],
    ['Biome', hud.biome],
    ['Time', `${clock(hud.timeOfDay)} (${Math.floor(hud.timeOfDay)})`],
    ['Weather', hud.weather],
    ['Target', hud.target ?? '-'],
  ];
  return (
    <div className="hud-text pointer-events-none absolute top-24 right-2 bg-black/55 px-3 py-2 font-pixel text-xs leading-5 text-white" data-testid="debug-overlay">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="text-neutral-400">{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}
