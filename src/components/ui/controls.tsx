'use client';

import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'danger';

function classes(variant: Variant, extra = ''): string {
  const v = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : '';
  return `btn-voxel ${v} px-4 py-2 font-pixel text-base tracking-wide select-none ${extra}`;
}

export function VoxelButton({ variant = 'default', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={classes(variant, className)} />;
}

export function VoxelLink({ href, children, variant = 'default', className = '' }: { href: string; children: ReactNode; variant?: Variant; className?: string }) {
  return (
    <Link href={href} className={`${classes(variant, className)} block text-center`}>
      {children}
    </Link>
  );
}

export function Panel({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <section className={`panel-voxel p-5 ${className}`}>
      {title && <h2 className="mb-4 font-pixel text-xl text-white">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-neutral-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full border-2 border-black bg-neutral-900/90 px-3 py-2 text-white outline-none placeholder:text-neutral-500 focus:border-lime-500';

export function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between border-2 border-black bg-neutral-900/80 px-3 py-2 text-left text-sm"
    >
      <span>{label}</span>
      <span className={`font-pixel ${checked ? 'text-lime-400' : 'text-neutral-500'}`}>{checked ? 'ON' : 'OFF'}</span>
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-sm">
        <span className="font-semibold text-neutral-200">{label}</span>
        <span className="font-pixel text-lime-300">{format(value)}</span>
      </span>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Select<T extends string>({ value, options, onChange, testId }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <select className={inputClass} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="border-2 border-red-900 bg-red-950/80 px-3 py-2 text-sm text-red-200">
      {children}
    </p>
  );
}
