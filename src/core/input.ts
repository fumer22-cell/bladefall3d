import { KEYS, type Action } from '../config';

const codeToAction = new Map<string, Action>();
for (const [action, codes] of Object.entries(KEYS) as [Action, readonly string[]][]) {
  for (const code of codes) codeToAction.set(code, action);
}

/** Actions handled per rendered frame rather than per sim step. */
const UI_ACTIONS = new Set<Action>([
  'reset', 'debug', 'slowmo', 'dummyMode', 'dummyReset',
  'weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5',
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
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.held.clear();
    });
  }

  requestLock(): void {
    const req = this.canvas.requestPointerLock() as unknown;
    if (req instanceof Promise) req.catch(() => {});
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

  takeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
}
