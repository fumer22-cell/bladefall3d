import { Vector3, type PerspectiveCamera } from 'three';
import { COMBAT, DUMMY, MOVE, WEAPONS } from '../config';
import { DEG } from '../core/math';
import type { CombatSystem } from '../combat/combatSystem';
import { DUMMY_MODE_LABELS, type Dummy } from '../combat/trainingDummy';
import type { Player } from '../player/player';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const CONTROLS: [string, string][] = [
  ['WASD / Mouse', 'Move / look'],
  ['Space', 'Jump / wall jump (3 max)'],
  ['Shift', 'Dash (i-frames)'],
  ['C', 'Slide (ground) / ground slam (air)'],
  ['LMB tap / hold', 'Light / heavy attack'],
  ['Mouse during windup', '← → slash, ↑ overhead, ↓ stab'],
  ['RMB', 'Parry (tap right before a hit) / guard (hold)'],
  ['Q', 'Feint a heavy'],
  ['F or LMB', 'Deathblow a staggered enemy'],
  ['1 – 5', 'Sword, greatsword, daggers, spear, gauntlets'],
  ['G / H', 'Dummy mode / move dummy in front of you'],
  ['R / T / F3', 'Respawn / slow-mo / debug'],
];

const DIR_GLYPH = { slashL: '←', slashR: '→', overhead: '↑', stab: '•' } as const;

interface TargetEl {
  root: HTMLDivElement;
  health: HTMLDivElement;
  posture: HTMLDivElement;
  prompt: HTMLDivElement;
}

export class Hud {
  private readonly pips: HTMLDivElement[] = [];
  private readonly wallJumps: HTMLDivElement[] = [];
  private readonly speed: HTMLDivElement;
  private readonly debugEl: HTMLDivElement;
  private readonly slowmo: HTMLDivElement;
  private readonly healthBar: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthLag: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly posture: HTMLDivElement;
  private readonly postureFill: HTMLDivElement;
  private readonly weaponName: HTMLDivElement;
  private readonly weaponSlots: HTMLDivElement;
  private readonly mode: HTMLDivElement;
  private readonly aimDir: HTMLDivElement;
  private readonly riposte: HTMLDivElement;
  private readonly stateText: HTMLDivElement;
  private readonly flashes: Record<'parry' | 'hurt' | 'heal', { el: HTMLDivElement; v: number }>;
  private readonly targets: TargetEl[] = [];
  private readonly warns: HTMLDivElement[] = [];
  private readonly deadEl: HTMLDivElement;
  private readonly hudRoot: HTMLDivElement;
  readonly overlay: HTMLDivElement;
  private debugOn = false;
  private fps = 60;
  private lagHealth: number = COMBAT.PLAYER_MAX_HEALTH;
  private healGlow = 0;

  constructor(root: HTMLElement) {
    const hud = el('div', 'hud', root);
    this.hudRoot = hud;
    el('div', 'crosshair', hud);
    this.aimDir = el('div', 'aimdir', hud);
    this.riposte = el('div', 'riposte', hud);
    this.riposte.textContent = 'RIPOSTE';
    this.stateText = el('div', 'state', hud);

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
    this.posture = el('div', 'posture', hud);
    this.postureFill = el('div', '', this.posture);

    const vitals = el('div', 'vitals', hud);
    const label = el('div', 'bar-label', vitals);
    label.innerHTML = '<span>HEALTH</span>';
    this.healthText = el('span', '', label);
    this.healthBar = el('div', 'bar', vitals);
    this.healthLag = el('div', 'lag', this.healthBar);
    this.healthFill = el('div', 'fill', this.healthBar);

    const weapon = el('div', 'weapon', hud);
    this.weaponName = el('div', 'name', weapon);
    this.weaponSlots = el('div', 'slots', weapon);
    this.mode = el('div', 'mode', hud);

    this.flashes = {
      parry: { el: el('div', 'flash parry', hud), v: 0 },
      hurt: { el: el('div', 'flash hurt', hud), v: 0 },
      heal: { el: el('div', 'flash heal', hud), v: 0 },
    };

    this.debugEl = el('div', 'debug', hud);
    this.slowmo = el('div', 'flag', hud);
    this.slowmo.textContent = 'SLOW-MO';
    this.deadEl = el('div', 'dead', root);
    this.deadEl.textContent = 'YOU DIED';

    this.overlay = el('div', 'overlay', root);
    const panel = el('div', 'panel', this.overlay);
    panel.innerHTML = `
      <h1>BLADEFALL</h1>
      <p class="sub">Phase 2: melee combat vs. a training dummy</p>
      <table>${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="go">Click to play</div>`;
  }

  flash(kind: 'parry' | 'hurt' | 'heal', strength = 1): void {
    this.flashes[kind].v = Math.max(this.flashes[kind].v, strength);
  }

  onHeal(): void {
    this.healGlow = 1;
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

  update(p: Player, cs: CombatSystem, camera: PerspectiveCamera, frameDt: number): void {
    const c = cs.combat;
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    this.speed.innerHTML = `${p.horizontalSpeed().toFixed(1)}<small>m/s</small>`;
    for (let i = 0; i < this.pips.length; i++) {
      const fill = Math.min(1, Math.max(0, p.dashPips - i));
      (this.pips[i].firstChild as HTMLDivElement).style.width = `${fill * 100}%`;
      this.pips[i].classList.toggle('full', fill >= 1);
    }
    for (let i = 0; i < this.wallJumps.length; i++) this.wallJumps[i].classList.toggle('used', i >= p.wallJumpsLeft);

    // Health with a trailing "lag" bar.
    const hf = c.health / COMBAT.PLAYER_MAX_HEALTH;
    this.lagHealth = Math.max(c.health, this.lagHealth - COMBAT.PLAYER_MAX_HEALTH * 0.6 * frameDt);
    this.healthFill.style.width = `${hf * 100}%`;
    this.healthLag.style.width = `${(this.lagHealth / COMBAT.PLAYER_MAX_HEALTH) * 100}%`;
    this.healthText.textContent = `${Math.ceil(c.health)}`;
    this.healGlow = Math.max(0, this.healGlow - frameDt * 3);
    this.healthBar.classList.toggle('heal', this.healGlow > 0);

    const pf = c.posture.fraction;
    this.postureFill.style.width = `${pf * 100}%`;
    this.posture.classList.toggle('high', pf > 0.75);
    this.posture.style.opacity = pf > 0.01 ? '1' : '0.25';

    this.weaponName.textContent = c.weapon.name.toUpperCase();
    this.weaponSlots.innerHTML = WEAPONS.map((_, i) => (i === c.weaponIndex ? `<b>${i + 1}</b>` : `${i + 1}`)).join(' ');
    const d0 = cs.dummies[0];
    this.mode.innerHTML = d0 ? `DUMMY [G]: <b>${DUMMY_MODE_LABELS[d0.mode]}</b>` : '';

    // Swing direction indicator during windup.
    const winding = c.phase === 'windup' && c.swing;
    this.aimDir.classList.toggle('on', !!winding);
    if (winding) {
      this.aimDir.textContent = DIR_GLYPH[c.currentDir()];
      this.aimDir.classList.toggle('heavy', c.swing!.heavy);
    }
    this.riposte.classList.toggle('on', c.riposteTimer > 0);
    const stateMsg = c.phase === 'staggered' ? 'POSTURE BROKEN' : c.phase === 'recoil' ? 'PARRIED' : '';
    this.stateText.textContent = stateMsg;
    this.stateText.classList.toggle('on', stateMsg !== '' && c.riposteTimer <= 0);

    for (const f of Object.values(this.flashes)) {
      f.v = Math.max(0, f.v - frameDt * 4);
      f.el.style.opacity = f.v.toFixed(3);
    }

    this.updateTargets(cs, camera);
    this.deadEl.classList.toggle('on', cs.isDead());

    if (this.debugOn) {
      const f = (n: number) => n.toFixed(2).padStart(7);
      this.debugEl.textContent =
        `fps      ${this.fps.toFixed(0)}\n` +
        `pos     ${f(p.pos.x)}${f(p.pos.y)}${f(p.pos.z)}\n` +
        `vel     ${f(p.vel.x)}${f(p.vel.y)}${f(p.vel.z)}\n` +
        `state    ${p.state}${p.crouched ? ' (crouched)' : ''}  grounded ${p.grounded}\n` +
        `pips     ${p.dashPips.toFixed(2)}   iframes ${p.iframes > 0 ? 'Y' : '-'}\n` +
        `combat   ${c.phase} ${c.t.toFixed(2)}${c.swing ? ` ${c.swing.heavy ? 'heavy' : 'light'}#${c.swing.comboIndex} ${c.currentDir()}` : ''}\n` +
        `parry    ${c.isPerfectParry() ? 'PERFECT' : c.isGuarding() ? 'guard' : '-'}  lockout ${c.parryLockout.toFixed(2)}\n` +
        `posture  ${c.posture.value.toFixed(1)}   perfect parries ${c.perfectParries}\n` +
        (d0 ? `dummy    ${d0.phase} ${d0.t.toFixed(2)} hp ${d0.health.toFixed(0)} post ${d0.posture.value.toFixed(0)}\n` : '');
    }
  }

  private updateTargets(cs: CombatSystem, camera: PerspectiveCamera): void {
    const dbTarget = cs.deathblowTarget();
    const w = window.innerWidth, h = window.innerHeight;
    const v = new Vector3();
    const camDir = new Vector3();
    camera.getWorldDirection(camDir);

    cs.dummies.forEach((d: Dummy, i) => {
      const t = (this.targets[i] ??= this.makeTarget());
      v.set(d.pos.x, d.pos.y + DUMMY.HEIGHT + 0.45, d.pos.z);
      const toTarget = v.clone().sub(camera.position);
      const visible = d.alive && toTarget.dot(camDir) > 0 && toTarget.length() < 40;
      t.root.classList.toggle('on', visible);
      if (visible) {
        v.project(camera);
        t.root.style.left = `${((v.x + 1) / 2) * w}px`;
        t.root.style.top = `${((1 - v.y) / 2) * h}px`;
        t.health.style.width = `${(d.health / DUMMY.MAX_HEALTH) * 100}%`;
        t.posture.style.width = `${d.posture.fraction * 100}%`;
        t.prompt.classList.toggle('on', d === dbTarget);
      }

      // Off-screen attack warning.
      const warn = (this.warns[i] ??= this.makeWarn());
      const threat = d.threatening();
      let show = false;
      if (threat) {
        const to = d.center().sub(camera.position).normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, to.dot(camDir))));
        if (angle > COMBAT.OFFSCREEN_WARN_ANGLE * DEG) {
          show = true;
          // Direction in camera space → angle around the crosshair (0 = up/ahead).
          const local = to.applyQuaternion(camera.quaternion.clone().invert());
          const a = Math.atan2(local.x, -local.z);
          warn.style.transform = `rotate(${a}rad)`;
          warn.classList.toggle('red', d.telegraph() === 'red');
        }
      }
      warn.classList.toggle('on', show);
    });
  }

  private makeTarget(): TargetEl {
    const root = el('div', 'target', this.hudRoot);
    const bar = el('div', 'bar', root);
    const health = el('div', 'fill', bar);
    const pm = el('div', 'posture-mini', root);
    const posture = el('div', '', pm);
    const prompt = el('div', 'prompt', root);
    prompt.textContent = 'F  DEATHBLOW';
    return { root, health, posture, prompt };
  }

  private makeWarn(): HTMLDivElement {
    const w = el('div', 'warn', this.hudRoot);
    el('div', '', w);
    return w;
  }
}
