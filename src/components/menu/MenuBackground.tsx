'use client';

import { useEffect, useRef } from 'react';
import { ATLAS_TILES_PER_ROW, tileIndex, TILE_PIXELS, type TileName } from '@/game/blocks/tiles';
import { getAtlasCanvas } from '@/game/renderer/textures';
import { SimplexNoise } from '@/game/terrain/noise';

/** Slowly scrolling side view of a voxel landscape drawn from the game textures. */
export function MenuBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const atlas = getAtlasCanvas();
    const noise = new SimplexNoise(1234);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let offset = 0;
    let last = performance.now();
    const tile = (name: TileName): [number, number] => {
      const i = tileIndex(name);
      return [(i % ATLAS_TILES_PER_ROW) * TILE_PIXELS, Math.floor(i / ATLAS_TILES_PER_ROW) * TILE_PIXELS];
    };
    const grassSide = tile('grass_side');
    const dirt = tile('dirt');
    const stone = tile('stone');
    const log = tile('log_side');
    const leaves = tile('leaves');

    const draw = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!reduceMotion) offset += dt * 0.6;
      const scale = Math.max(3, Math.round(window.innerHeight / 180));
      const size = TILE_PIXELS * scale;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.imageSmoothingEnabled = false;
      const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
      sky.addColorStop(0, '#3f78d6');
      sky.addColorStop(1, '#a9cdf7');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const columns = Math.ceil(canvas.width / size) + 2;
      const base = Math.floor(offset);
      const frac = offset - base;
      for (let c = 0; c < columns; c++) {
        const wx = base + c;
        const h = Math.round(5 + noise.fbm2(wx / 18, 0.5, 3) * 3);
        const x = Math.round((c - frac) * size);
        for (let r = 0; r < h; r++) {
          const y = canvas.height - (r + 1) * size;
          const src = r === h - 1 ? grassSide : r > h - 4 ? dirt : stone;
          ctx.drawImage(atlas, src[0], src[1], TILE_PIXELS, TILE_PIXELS, x, y, size, size);
        }
        if (((wx * 2654435761) >>> 0) % 9 === 0) {
          const top = canvas.height - h * size;
          for (let t = 1; t <= 4; t++) ctx.drawImage(atlas, log[0], log[1], 16, 16, x, top - t * size, size, size);
          for (let lx = -1; lx <= 1; lx++)
            for (let ly = 4; ly <= 6; ly++) ctx.drawImage(atlas, leaves[0], leaves[1], 16, 16, x + lx * size, top - ly * size, size, size);
        }
      }
      ctx.fillStyle = 'rgba(8, 10, 18, 0.35)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pixelated fixed inset-0 -z-10 h-full w-full" />;
}
