'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, type CreateWorldInput } from '@/lib/api';
import { ErrorText, Field, inputClass, Select, Toggle, VoxelButton } from '../ui/controls';

/** All world options; singleplayer presets a private one-player world. */
export function CreateWorldForm({ singleplayer = false }: { singleplayer?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<CreateWorldInput>({
    name: singleplayer ? 'My World' : 'Creative World',
    seed: '',
    gameMode: 'creative',
    visibility: singleplayer ? 'private' : 'public',
    maxPlayers: singleplayer ? 1 : 8,
    password: '',
    terrainType: 'default',
    dayNightCycle: true,
    weatherEnabled: true,
    buildPermission: 'everyone',
    includeShowcase: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof CreateWorldInput>(key: K, value: CreateWorldInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { world } = await api.createWorld(form);
      router.push(`/game?world=${encodeURIComponent(world.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the world');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel-voxel grid gap-4 p-5 sm:grid-cols-2" data-testid="create-world-form">
      <Field label="World name">
        <input className={inputClass} value={form.name} maxLength={32} required onChange={(e) => update('name', e.target.value)} data-testid="world-name" />
      </Field>
      <Field label="World seed" hint="Leave empty for a random world. The same seed always creates the same terrain.">
        <input className={inputClass} value={form.seed} maxLength={64} placeholder="Random" onChange={(e) => update('seed', e.target.value)} data-testid="world-seed" />
      </Field>
      <Field label="Game mode" hint="Survival: collect resources and craft. Spectator: fly through blocks.">
        <Select
          value={form.gameMode}
          testId="world-gamemode"
          onChange={(v) => update('gameMode', v)}
          options={[
            { value: 'creative', label: 'Creative' },
            { value: 'survival', label: 'Survival' },
            { value: 'spectator', label: 'Spectator' },
          ]}
        />
      </Field>
      <Field label="Terrain type">
        <Select
          value={form.terrainType}
          onChange={(v) => update('terrainType', v)}
          options={[
            { value: 'default', label: 'Default (biomes, rivers, caves)' },
            { value: 'mountains', label: 'Mountains (amplified)' },
            { value: 'flat', label: 'Flat' },
          ]}
        />
      </Field>
      {!singleplayer && (
        <>
          <Field label="Visibility" hint="Unlisted worlds are joined with their world code.">
            <Select
              value={form.visibility}
              onChange={(v) => update('visibility', v)}
              options={[
                { value: 'public', label: 'Public (listed in the lobby)' },
                { value: 'unlisted', label: 'Unlisted (join by code)' },
                { value: 'private', label: 'Private (only me)' },
              ]}
            />
          </Field>
          <Field label={`Maximum players: ${form.maxPlayers}`}>
            <input type="range" min={1} max={16} value={form.maxPlayers} className="w-full" onChange={(e) => update('maxPlayers', Number(e.target.value))} />
          </Field>
          <Field label="Password (optional)" hint="Other players must enter it to join.">
            <input className={inputClass} type="password" value={form.password} maxLength={64} placeholder="No password" onChange={(e) => update('password', e.target.value)} />
          </Field>
          <Field label="Building permissions">
            <Select
              value={form.buildPermission}
              onChange={(v) => update('buildPermission', v)}
              options={[
                { value: 'everyone', label: 'Everyone can build' },
                { value: 'members', label: 'Only players I approve' },
                { value: 'owner', label: 'Only me' },
              ]}
            />
          </Field>
        </>
      )}
      <Toggle label="Day/night cycle" checked={form.dayNightCycle} onChange={(v) => update('dayNightCycle', v)} />
      <Toggle label="Weather (rain and snow)" checked={form.weatherEnabled} onChange={(v) => update('weatherEnabled', v)} />
      <div className="sm:col-span-2">
        <Toggle label="Build the mechanism showcase near spawn (garage door, automatic door, timed lights)" checked={form.includeShowcase} onChange={(v) => update('includeShowcase', v)} />
      </div>
      <div className="sm:col-span-2 space-y-3">
        <ErrorText>{error}</ErrorText>
        <VoxelButton type="submit" variant="primary" className="w-full" disabled={busy} data-testid="create-world-submit">
          {busy ? 'Creating world...' : 'Create World'}
        </VoxelButton>
      </div>
    </form>
  );
}
