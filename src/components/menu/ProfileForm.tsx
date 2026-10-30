'use client';

import { useState } from 'react';
import { useSession } from '@/stores/session';
import type { Appearance } from '@/network/protocol/messages';
import { ErrorText, Field, inputClass, VoxelButton } from '../ui/controls';

const DEFAULT: Appearance = { skin: '#d9a066', shirt: '#3b7dd8', pants: '#3a3a5c' };
const SKIN_PRESETS = ['#f1c9a5', '#d9a066', '#a8714a', '#7a4b2e', '#4a2e1c'];

/** Front view of the character in the chosen colours. */
export function CharacterPreview({ appearance, size = 8 }: { appearance: Appearance; size?: number }) {
  const u = size;
  return (
    <div className="relative" style={{ width: u * 8, height: u * 16 }} aria-label="Character preview">
      <div className="absolute" style={{ left: u * 2, top: 0, width: u * 4, height: u * 4, background: appearance.skin }}>
        <div className="absolute bg-white" style={{ left: u * 0.5, top: u * 1.5, width: u, height: u * 0.5 }} />
        <div className="absolute bg-white" style={{ left: u * 2.5, top: u * 1.5, width: u, height: u * 0.5 }} />
        <div className="absolute bg-indigo-950" style={{ left: u, top: u * 1.5, width: u * 0.5, height: u * 0.5 }} />
        <div className="absolute bg-indigo-950" style={{ left: u * 2.5, top: u * 1.5, width: u * 0.5, height: u * 0.5 }} />
      </div>
      <div className="absolute" style={{ left: u * 2, top: u * 4, width: u * 4, height: u * 6, background: appearance.shirt }} />
      <div className="absolute" style={{ left: 0, top: u * 4, width: u * 2, height: u * 6, background: appearance.shirt }} />
      <div className="absolute" style={{ left: u * 6, top: u * 4, width: u * 2, height: u * 6, background: appearance.shirt }} />
      <div className="absolute" style={{ left: 0, top: u * 9, width: u * 2, height: u, background: appearance.skin }} />
      <div className="absolute" style={{ left: u * 6, top: u * 9, width: u * 2, height: u, background: appearance.skin }} />
      <div className="absolute" style={{ left: u * 2, top: u * 10, width: u * 4, height: u * 6, background: appearance.pants }} />
      <div className="absolute bg-black/30" style={{ left: u * 4 - 1, top: u * 11, width: 2, height: u * 5 }} />
    </div>
  );
}

export function ProfileForm({ onSaved, submitLabel = 'Save Profile' }: { onSaved?: () => void; submitLabel?: string }) {
  const player = useSession((s) => s.player);
  const save = useSession((s) => s.save);
  const [name, setName] = useState(player?.displayName ?? '');
  const [appearance, setAppearance] = useState<Appearance>(player?.appearance ?? DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save(name.trim(), appearance);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  };

  const color = (key: keyof Appearance, label: string) => (
    <label className="flex items-center justify-between gap-3 border-2 border-black bg-neutral-900/80 px-3 py-2 text-sm">
      <span>{label}</span>
      <input type="color" value={appearance[key]} onChange={(e) => setAppearance({ ...appearance, [key]: e.target.value })} className="h-7 w-12 cursor-pointer bg-transparent" />
    </label>
  );

  return (
    <form onSubmit={submit} className="grid gap-5 sm:grid-cols-[1fr_auto]">
      <div className="space-y-4">
        <Field label="Player name" hint="2-16 characters: letters, numbers, spaces, _ . -">
          <input
            className={inputClass}
            value={name}
            maxLength={16}
            autoFocus
            required
            placeholder="Enter your name"
            data-testid="player-name"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="space-y-2">
          <span className="block text-sm font-semibold text-neutral-200">Appearance</span>
          <div className="flex gap-2">
            {SKIN_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Skin tone ${c}`}
                onClick={() => setAppearance({ ...appearance, skin: c })}
                className={`h-7 w-7 border-2 ${appearance.skin === c ? 'border-white' : 'border-black'}`}
                style={{ background: c }}
              />
            ))}
          </div>
          {color('skin', 'Skin')}
          {color('shirt', 'Shirt')}
          {color('pants', 'Pants')}
        </div>
        <ErrorText>{error}</ErrorText>
        <VoxelButton type="submit" variant="primary" className="w-full" disabled={busy || name.trim().length < 2} data-testid="save-profile">
          {busy ? 'Saving...' : submitLabel}
        </VoxelButton>
      </div>
      <div className="flex items-center justify-center border-2 border-black bg-sky-900/40 p-6">
        <CharacterPreview appearance={appearance} size={10} />
      </div>
    </form>
  );
}
