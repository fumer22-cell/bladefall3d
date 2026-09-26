import { CAMERA, KEYS, type Action } from '../config';

const codeToAction = new Map<string, Action>();
for (const [action, codes] of Object.entries(KEYS) as [Action, readonly string[]][]) {
  for (const code of codes) codeToAction.set(code, action);
}

/** Actions handled per rendered frame rather than per sim step. */
const UI_ACTIONS = new Set<Action>([
  'reset', 'debug', 'slowmo', 'dummyMode', 'dummyReset', 'inventory', 'debugKit',
  'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9',
]);

/**
 * Keyboard + mouse input with pointer lock.
 * Presses are latched until the next sim step consumes them (`endStep`), so a tap is never
 * lost between frames and never counted twice.
 */
export class Input {
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  /** Mouse events to discard right after locking. */
  private ignoreMoves = 0;
  locked = false;

  constructor(private readonly canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const action = codeToAction.get(e.code);
      if (!action) return;
      if (this.locked || action === 'debug') e.preventDefault();
      if (!e.repeat) this.pressed.add(action);
      this.held.add(action);
    });
    window.addEventListener('keyup', (e) => {
      const action = codeToAction.get(e.code);
      if (action) this.held.delete(action);
    });
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const action = codeToAction.get(`Mouse${e.button}`);
      if (!action) return;
      e.preventDefault();
      this.pressed.add(action);
      this.held.add(action);
    });
    document.addEventListener('mouseup', (e) => {
      const action = codeToAction.get(`Mouse${e.button}`);
      if (action) this.held.delete(action);
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Browsers occasionally report one absurd movement (notably right after locking, or a
      // Chrome pointer-lock bug when the OS cursor would cross a screen edge). Drop those
      // instead of letting them snap the camera straight up or down.
      if (this.ignoreMoves > 0) {
        this.ignoreMoves--;
        return;
      }
      if (Math.abs(e.movementX) > CAMERA.MOUSE_SPIKE_PX || Math.abs(e.movementY) > CAMERA.MOUSE_SPIKE_PX) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.held.clear();
      else {
        this.mouseDX = this.mouseDY = 0;
        this.ignoreMoves = 2;
      }
    });
  }

  requestLock(): void {
    // Raw (unaccelerated) input avoids the OS acceleration curve and the movement spikes that
    // come with it. Not every browser supports it, so fall back to a plain lock.
    type LockFn = (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    const lock = this.canvas.requestPointerLock.bind(this.canvas) as LockFn;
    try {
      const req = lock({ unadjustedMovement: true });
      if (req instanceof Promise) req.catch(() => this.plainLock(lock));
    } catch {
      this.plainLock(lock);
    }
  }

  private plainLock(lock: (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void): void {
    try {
      const req = lock();
      if (req instanceof Promise) req.catch(() => {});
    } catch {
      /* the page shows the click-to-play overlay again */
    }
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }

  /** Consume a press immediately (for per-frame UI toggles). */
  consumePress(a: Action): boolean {
    return this.pressed.delete(a);
  }

  /** Called after each sim step. UI actions stay latched until consumed with `consumePress`. */
  endStep(): void {
    for (const a of this.pressed) if (!UI_ACTIONS.has(a)) this.pressed.delete(a);
  }

  /** Wheel notches since last call (+ = scrolled down). */
  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  takeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
}
