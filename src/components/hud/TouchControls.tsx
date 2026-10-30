'use client';

import { useRef, useState } from 'react';
import { useGame } from '@/stores/game';
import { useGameEngine } from '../game/GameContext';

const JOYSTICK_RADIUS = 52;

function capture(e: React.PointerEvent): void {
  try {
    capture(e);
  } catch {
    // The pointer may already be released (e.g. a very short tap).
  }
}

/** Virtual joystick, touch look area and action buttons for phones and tablets. */
export function TouchControls() {
  const game = useGameEngine();
  const panel = useGame((s) => s.panel);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const stickPointer = useRef<number | null>(null);
  const stickOrigin = useRef({ x: 0, y: 0 });
  const lookPointer = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  if (!game || panel) return null;
  const input = game.controls;

  const onStickDown = (e: React.PointerEvent) => {
    stickPointer.current = e.pointerId;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    stickOrigin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    capture(e);
    onStickMove(e);
  };
  const onStickMove = (e: React.PointerEvent) => {
    if (stickPointer.current !== e.pointerId) return;
    let dx = e.clientX - stickOrigin.current.x;
    let dy = e.clientY - stickOrigin.current.y;
    const len = Math.hypot(dx, dy);
    if (len > JOYSTICK_RADIUS) {
      dx = (dx / len) * JOYSTICK_RADIUS;
      dy = (dy / len) * JOYSTICK_RADIUS;
    }
    setStick({ x: dx, y: dy });
    input.setTouchMove(dx / JOYSTICK_RADIUS, dy / JOYSTICK_RADIUS);
  };
  const onStickUp = () => {
    stickPointer.current = null;
    setStick({ x: 0, y: 0 });
    input.setTouchMove(0, 0);
  };

  const onLookDown = (e: React.PointerEvent) => {
    lookPointer.current = e.pointerId;
    lookLast.current = { x: e.clientX, y: e.clientY };
    capture(e);
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (lookPointer.current !== e.pointerId) return;
    input.addTouchLook((e.clientX - lookLast.current.x) * 1.6, (e.clientY - lookLast.current.y) * 1.6);
    lookLast.current = { x: e.clientX, y: e.clientY };
  };

  const hold = (down: () => void, up: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      capture(e);
      down();
    },
    onPointerUp: up,
    onPointerCancel: up,
  });

  const button = 'pointer-events-auto flex h-14 w-14 items-center justify-center border-2 border-black bg-white/20 font-pixel text-xs text-white active:bg-white/40';

  return (
    <div className="absolute inset-0" data-testid="touch-controls">
      {/* Look area: right part of the screen. */}
      <div
        className="pointer-events-auto absolute top-0 right-0 bottom-0 left-1/3"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={() => (lookPointer.current = null)}
        onPointerCancel={() => (lookPointer.current = null)}
      />
      <div
        className="pointer-events-auto absolute bottom-24 left-6 h-36 w-36 rounded-full border-2 border-white/40 bg-black/25"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
        aria-label="Movement joystick"
      >
        <div className="absolute top-1/2 left-1/2 h-14 w-14 rounded-full bg-white/50" style={{ transform: `translate(calc(-50% + ${stick.x}px), calc(-50% + ${stick.y}px))` }} />
      </div>
      <div className="absolute right-4 bottom-24 grid grid-cols-3 gap-2">
        <button type="button" className={button} {...hold(() => game.actions.primary(true), () => game.actions.primary(false))}>
          Break
        </button>
        <button type="button" className={button} {...hold(() => input.setTouchButton('jump', true), () => input.setTouchButton('jump', false))}>
          Jump
        </button>
        <button type="button" className={button} {...hold(() => game.actions.secondary(true), () => game.actions.secondary(false))}>
          Place
        </button>
        <button type="button" className={button} {...hold(() => input.setTouchButton('crouch', true), () => input.setTouchButton('crouch', false))}>
          Crouch
        </button>
        <button type="button" className={button} onClick={() => useGame.getState().openPanel('inventory')}>
          Items
        </button>
        <button type="button" className={button} onClick={() => useGame.getState().openPanel('pause')}>
          Menu
        </button>
      </div>
      <button type="button" className={`${button} absolute top-16 right-4`} onClick={() => useGame.getState().openPanel('chat')}>
        Chat
      </button>
    </div>
  );
}
