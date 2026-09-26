import { MOVE } from '../config';
import type { Player } from '../player/player';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const CONTROLS: [string, string][] = [
  ['WASD', 'Move'],
  ['Mouse', 'Look'],
  ['Space', 'Jump / wall jump (3 max)'],
  ['Shift', 'Dash (3 pips, any direction)'],
  ['C (ground)', 'Slide — hold to keep sliding'],
  ['C (air)', 'Ground slam — jump on landing to bounce'],
  ['R', 'Reset to spawn'],
  ['T', 'Toggle slow-mo'],
  ['F3', 'Debug overlay'],
  ['Esc', 'Release mouse'],
];

export class Hud {
  private readonly pips: HTMLDivElement[] = [];
  private readonly wallJumps: HTMLDivElement[] = [];
  private readonly speed: HTMLDivElement;
  private readonly debugEl: HTMLDivElement;
  private readonly slowmo: HTMLDivElement;
  readonly overlay: HTMLDivElement;
  private debugOn = false;
  private fps = 60;

  constructor(root: HTMLElement) {
    const hud = el('div', 'hud', root);
    el('div', 'crosshair', hud);
    const bottom = el('div', 'bottom', hud);
    this.speed = el('div', 'speed', bottom);
    const wj = el('div', 'walljumps', bottom);
    for (let i = 0; i < MOVE.WALL_JUMPS_MAX; i++) this.wallJumps.push(el('div', 'wj', wj));
    const pips = el('div', 'pips', bottom);
    for (let i = 0; i < MOVE.DASH_PIPS; i++) {
      const pip = el('div', 'pip', pips);
      el('div', '', pip);
      this.pips.push(pip);
    }
    this.debugEl = el('div', 'debug', hud);
    this.slowmo = el('div', 'flag', hud);
    this.slowmo.textContent = 'SLOW-MO';

    this.overlay = el('div', 'overlay', root);
    const panel = el('div', 'panel', this.overlay);
    panel.innerHTML = `
      <h1>BLADEFALL</h1>
      <p class="sub">Phase 1 — movement test arena</p>
      <table>${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="go">Click to play</div>`;
  }

  toggleDebug(): void {
    this.debugOn = !this.debugOn;
    this.debugEl.classList.toggle('on', this.debugOn);
  }

  setSlowmo(on: boolean): void {
    this.slowmo.classList.toggle('on', on);
  }

  setOverlay(visible: boolean): void {
    this.overlay.classList.toggle('hidden', !visible);
  }

  update(p: Player, frameDt: number): void {
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    this.speed.innerHTML = `${p.horizontalSpeed().toFixed(1)}<small>m/s</small>`;
    for (let i = 0; i < this.pips.length; i++) {
      const fill = Math.min(1, Math.max(0, p.dashPips - i));
      (this.pips[i].firstChild as HTMLDivElement).style.width = `${fill * 100}%`;
      this.pips[i].classList.toggle('full', fill >= 1);
    }
    for (let i = 0; i < this.wallJumps.length; i++) this.wallJumps[i].classList.toggle('used', i >= p.wallJumpsLeft);

    if (this.debugOn) {
      const f = (n: number) => n.toFixed(2).padStart(7);
      this.debugEl.textContent =
        `fps      ${this.fps.toFixed(0)}\n` +
        `pos     ${f(p.pos.x)}${f(p.pos.y)}${f(p.pos.z)}\n` +
        `vel     ${f(p.vel.x)}${f(p.vel.y)}${f(p.vel.z)}\n` +
        `hspeed  ${f(p.horizontalSpeed())}\n` +
        `state    ${p.state}${p.crouched ? ' (crouched)' : ''}\n` +
        `grounded ${p.grounded}\n` +
        `wall     ${p.touchingWall ? `${p.wallNX.toFixed(1)}, ${p.wallNZ.toFixed(1)}` : '-'}\n` +
        `pips     ${p.dashPips.toFixed(2)}   iframes ${p.iframes > 0 ? 'Y' : '-'}\n` +
        `walljumps ${p.wallJumpsLeft}\n` +
        `slam bounce ${p.slamBounceTimer > 0 ? `+${p.slamBounceBonus.toFixed(1)}` : '-'}`;
    }
  }
}
