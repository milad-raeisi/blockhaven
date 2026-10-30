'use client';

import { useEffect, useState } from 'react';
import { MAX_RENDER_DISTANCE, MIN_RENDER_DISTANCE } from '@/game/world/constants';
import { DEFAULT_KEYBINDINGS, KEY_ACTION_LABELS, useSettings, type KeyAction } from '@/stores/settings';
import { Select, Slider, Toggle, VoxelButton } from '../ui/controls';

function keyLabel(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' (L)').replace('Right', ' (R)');
}

/** Graphics, controls and audio settings, stored locally in the browser. */
export function SettingsForm() {
  const s = useSettings();
  const [binding, setBinding] = useState<KeyAction | null>(null);
  const [tab, setTab] = useState<'video' | 'controls' | 'audio'>('video');

  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') s.setKey(binding, e.code);
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [binding, s]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="space-y-4" data-testid="settings-form">
      <div className="flex gap-2">
        {(['video', 'controls', 'audio'] as const).map((t) => (
          <VoxelButton key={t} variant={tab === t ? 'primary' : 'default'} className="flex-1 capitalize" onClick={() => setTab(t)}>
            {t}
          </VoxelButton>
        ))}
      </div>

      {tab === 'video' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Slider label="Render distance" value={s.renderDistance} min={MIN_RENDER_DISTANCE} max={MAX_RENDER_DISTANCE} format={(v) => `${v} chunks`} onChange={(v) => s.set({ renderDistance: v })} />
          <Slider label="Field of view" value={s.fov} min={50} max={110} format={(v) => `${v}°`} onChange={(v) => s.set({ fov: v })} />
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Graphics quality</span>
            <Select
              value={s.quality}
              onChange={(v) => s.set({ quality: v })}
              options={[
                { value: 'low', label: 'Low (fastest)' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High (antialiasing)' },
              ]}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Shadows</span>
            <Select
              value={s.shadows}
              onChange={(v) => s.set({ shadows: v })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'low', label: 'Low' },
                { value: 'high', label: 'High' },
              ]}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">FPS limit</span>
            <Select
              value={String(s.fpsLimit)}
              onChange={(v) => s.set({ fpsLimit: Number(v) })}
              options={[
                { value: '0', label: 'Unlimited (display refresh)' },
                { value: '30', label: '30 FPS' },
                { value: '60', label: '60 FPS' },
                { value: '120', label: '120 FPS' },
              ]}
            />
          </label>
          <div className="flex items-end">
            <VoxelButton className="w-full" onClick={toggleFullscreen}>
              Toggle Fullscreen
            </VoxelButton>
          </div>
          <Toggle label="Particle effects (rain, snow)" checked={s.particles} onChange={(v) => s.set({ particles: v })} />
          <Toggle label="Show FPS counter" checked={s.showFps} onChange={(v) => s.set({ showFps: v })} />
          <Toggle label="Performance overlay (F3)" checked={s.showDebug} onChange={(v) => s.set({ showDebug: v })} />
        </div>
      )}

      {tab === 'controls' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Slider label="Mouse sensitivity" value={s.mouseSensitivity} min={0.2} max={3} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s.set({ mouseSensitivity: v })} />
            <Toggle label="Invert mouse Y" checked={s.invertY} onChange={(v) => s.set({ invertY: v })} />
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {(Object.keys(KEY_ACTION_LABELS) as KeyAction[]).map((action) => (
              <div key={action} className="flex items-center justify-between border-2 border-black bg-neutral-900/80 px-3 py-1.5 text-sm">
                <span>{KEY_ACTION_LABELS[action]}</span>
                <button
                  type="button"
                  className={`min-w-24 border-2 border-black px-2 py-0.5 font-pixel ${binding === action ? 'bg-lime-700' : 'bg-neutral-700'}`}
                  onClick={() => setBinding(action)}
                >
                  {binding === action ? 'Press a key' : keyLabel(s.keybindings[action] ?? DEFAULT_KEYBINDINGS[action])}
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-neutral-400">
            Fixed controls: left click breaks, right click places or uses, middle click picks a block, 1–9 or the mouse wheel select hotbar slots, double-tap jump to fly
            (Creative), Esc pauses. C also crouches. Browsers reserve some shortcuts (for example Ctrl+W closes the tab), so consider rebinding crouch.
          </p>
          <VoxelButton onClick={() => s.set({ keybindings: { ...DEFAULT_KEYBINDINGS } })}>Reset key bindings</VoxelButton>
        </div>
      )}

      {tab === 'audio' && (
        <Slider label="Sound volume" value={Math.round(s.volume * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => s.set({ volume: v / 100 })} />
      )}

      <div className="flex justify-end">
        <VoxelButton variant="danger" onClick={() => s.reset()}>
          Reset all settings
        </VoxelButton>
      </div>
    </div>
  );
}
