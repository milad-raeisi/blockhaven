import { useSettings, type KeyAction } from '@/stores/settings';

export type InputAction =
  | 'inventory'
  | 'chat'
  | 'command'
  | 'pause'
  | 'camera'
  | 'players'
  | 'debug'
  | 'toggleFly'
  | 'primaryDown'
  | 'primaryUp'
  | 'secondaryDown'
  | 'secondaryUp'
  | 'pick'
  | 'hotbar'
  | 'hotbarScroll';

export interface Movement {
  forward: number;
  strafe: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
}

const DOUBLE_TAP_MS = 300;

/**
 * Keyboard, mouse (Pointer Lock) and touch input. Gameplay input is ignored
 * while a UI panel is open; panel shortcuts are reported as actions.
 */
export class InputManager {
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private lastJumpTap = 0;
  private touchMove = { x: 0, y: 0 };
  private readonly touchButtons = { jump: false, crouch: false, sprint: false };
  /** False while a menu or chat is open. */
  gameplayEnabled = true;
  private readonly abort = new AbortController();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onAction: (action: InputAction, value?: number) => void,
  ) {
    const opts = { signal: this.abort.signal };
    window.addEventListener('keydown', (e) => this.onKeyDown(e), opts);
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code), opts);
    window.addEventListener('blur', () => this.pressed.clear(), opts);
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e), opts);
    window.addEventListener('mouseup', (e) => this.onMouseUp(e), opts);
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), opts);
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { ...opts, passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    document.addEventListener('pointerlockchange', () => this.onPointerLockChange(), opts);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestPointerLock(): void {
    if (this.pointerLocked || typeof this.canvas.requestPointerLock !== 'function') return;
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    } catch {
      // Browsers throttle re-locking right after Esc; the next click retries.
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private binding(action: KeyAction): string {
    return useSettings.getState().keybindings[action];
  }

  private isBound(code: string, action: KeyAction): boolean {
    return this.binding(action) === code;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const code = e.code;
    if (code === 'Escape') {
      this.onAction('pause');
      return;
    }
    if (this.isBound(code, 'inventory')) {
      e.preventDefault();
      this.onAction('inventory');
      return;
    }
    if (!this.gameplayEnabled) return;
    if (this.isBound(code, 'chat')) {
      e.preventDefault();
      this.onAction('chat');
      return;
    }
    if (this.isBound(code, 'command')) {
      e.preventDefault();
      this.onAction('command');
      return;
    }
    if (this.isBound(code, 'camera')) {
      e.preventDefault();
      this.onAction('camera');
      return;
    }
    if (this.isBound(code, 'players')) {
      e.preventDefault();
      this.onAction('players');
      return;
    }
    if (this.isBound(code, 'debug')) {
      e.preventDefault();
      this.onAction('debug');
      return;
    }
    if (/^Digit[1-9]$/.test(code)) {
      this.onAction('hotbar', Number(code.slice(5)) - 1);
      return;
    }
    if (this.isBound(code, 'jump') && !e.repeat) {
      const now = performance.now();
      if (now - this.lastJumpTap < DOUBLE_TAP_MS) {
        this.onAction('toggleFly');
        this.lastJumpTap = 0;
      } else {
        this.lastJumpTap = now;
      }
    }
    // Keep the browser from scrolling or triggering shortcuts during play.
    if (code === 'Space' || code === 'Tab' || code.startsWith('Arrow') || (e.ctrlKey && this.pointerLocked)) e.preventDefault();
    this.pressed.add(code);
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.gameplayEnabled) return;
    if (!this.pointerLocked) {
      this.requestPointerLock();
      return;
    }
    if (e.button === 0) this.onAction('primaryDown');
    else if (e.button === 2) this.onAction('secondaryDown');
    else if (e.button === 1) {
      e.preventDefault();
      this.onAction('pick');
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) this.onAction('primaryUp');
    else if (e.button === 2) this.onAction('secondaryUp');
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.pointerLocked || !this.gameplayEnabled) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  }

  private onWheel(e: WheelEvent): void {
    if (!this.gameplayEnabled) return;
    e.preventDefault();
    this.onAction('hotbarScroll', Math.sign(e.deltaY));
  }

  private onPointerLockChange(): void {
    // Losing the lock with Esc while playing opens the pause menu.
    if (!this.pointerLocked && this.gameplayEnabled) {
      this.pressed.clear();
      this.onAction('pause');
    }
  }

  /** Mouse/touch look delta since the last call, in pixels. */
  consumeLook(): { dx: number; dy: number } {
    const result = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return result;
  }

  // --- Touch controls ----------------------------------------------------------

  setTouchMove(x: number, y: number): void {
    this.touchMove = { x, y };
  }

  addTouchLook(dx: number, dy: number): void {
    if (!this.gameplayEnabled) return;
    this.lookX += dx;
    this.lookY += dy;
  }

  setTouchButton(button: 'jump' | 'crouch' | 'sprint', down: boolean): void {
    if (button === 'jump' && down && !this.touchButtons.jump) {
      const now = performance.now();
      if (now - this.lastJumpTap < DOUBLE_TAP_MS) {
        this.onAction('toggleFly');
        this.lastJumpTap = 0;
      } else this.lastJumpTap = now;
    }
    this.touchButtons[button] = down;
  }

  movement(): Movement {
    if (!this.gameplayEnabled) return { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false };
    const k = (a: KeyAction) => this.pressed.has(this.binding(a));
    let forward = (k('forward') ? 1 : 0) - (k('back') ? 1 : 0);
    let strafe = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
      forward = -this.touchMove.y;
      strafe = this.touchMove.x;
    }
    const touchSprint = Math.hypot(this.touchMove.x, this.touchMove.y) > 0.92;
    return {
      forward,
      strafe,
      jump: k('jump') || this.touchButtons.jump,
      sprint: k('sprint') || this.touchButtons.sprint || touchSprint,
      crouch: k('crouch') || this.touchButtons.crouch || this.pressed.has('KeyC'),
    };
  }

  dispose(): void {
    this.abort.abort();
    this.exitPointerLock();
  }
}
