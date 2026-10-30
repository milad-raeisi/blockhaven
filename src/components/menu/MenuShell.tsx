'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { MenuBackground } from './MenuBackground';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <h1
      className={`font-pixel font-black tracking-tight text-white ${small ? 'text-3xl' : 'text-5xl sm:text-7xl'}`}
      style={{ textShadow: '4px 4px 0 #2a4a18, 6px 6px 0 rgba(0,0,0,0.5)' }}
    >
      Block<span className="text-lime-400">haven</span>
    </h1>
  );
}

/** Page frame for all menu screens: animated background, title and back link. */
export function MenuShell({ title, children, back = '/', wide = false }: { title?: string; children: ReactNode; back?: string | null; wide?: boolean }) {
  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center px-4 py-8">
      <MenuBackground />
      <div className={`w-full ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/" aria-label="Main menu">
            <Logo small />
          </Link>
          {back && (
            <Link href={back} className="btn-voxel px-3 py-1 font-pixel text-sm">
              ← Back
            </Link>
          )}
        </div>
        {title && <h2 className="hud-text mb-4 font-pixel text-2xl text-white">{title}</h2>}
        {children}
      </div>
    </main>
  );
}
