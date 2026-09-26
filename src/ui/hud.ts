import { Vector3, type PerspectiveCamera } from 'three';
import { COMBAT, INVENTORY, MOVE, UPGRADES } from '../config';
import { DEG } from '../core/math';
import type { CombatSystem } from '../combat/combatSystem';
import { DUMMY_MODE_LABELS, type Dummy } from '../combat/trainingDummy';
import type { Builder } from '../player/builder';
import type { Inventory } from '../items/inventory';
import type { Player } from '../player/player';
import { BLOCKS } from '../world/blocks';
import { itemName, stackHTML } from './itemIcon';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const CONTROLS: [string, string][] = [
  ['WASD / Mouse', 'Move / look'],
  ['Space', 'Jump / wall jump (3 max)'],
  ['Shift', 'Dash (i-frames). Extra dashes, air jumps, wall runs and a grappling hook (V / middle mouse) come from trinkets'],
  ['C', 'Slide (ground) / ground slam (air)'],
  ['LMB tap / hold', 'Light / heavy attack'],
  ['Mouse during windup', '← → slash, ↑ overhead, ↓ stab'],
  ['RMB', 'Parry (tap right before a hit) / guard (hold)'],
  ['Q', 'Feint a heavy'],
  ['F or LMB', 'Deathblow a staggered enemy'],
  ['1 – 9 / wheel', 'Hotbar. Weapons fight; tools, blocks and hands mine (hold LMB) and place (RMB)'],
  ['E / Tab', 'Inventory and crafting (shift-click armor to wear it)'],
  ['Hold RMB with food', 'Eat'],
  ['F on a bed', 'Sleep through the night / set respawn'],
  ['G / H', 'Dummy mode / move dummy in front of you'],
  ['L', 'Toggle the looming far field'],
  ['R / T / F3', 'Respawn / slow-mo / debug (K in debug: test kit)'],
];

const DIR_GLYPH = { slashL: '←', slashR: '→', overhead: '↑', stab: '•' } as const;

export interface SurvivalHud {
  food: number;
  healPool: number;
  eating: number;
  hunger: 'fed' | 'ok' | 'hungry' | 'starving';
  temp: 'freezing' | 'cold' | 'ok' | 'warm' | 'hot';
  bodyTemp: number;
  warmBuff: boolean;
  day: number;
  phase: string;
  night: boolean;
  memory: { x: number; y: number; z: number; coins: number } | null;
  deathNote: string;
}

interface TargetEl {
  root: HTMLDivElement;
  health: HTMLDivElement;
  posture: HTMLDivElement;
  prompt: HTMLDivElement;
}

export class Hud {
  private readonly pips: HTMLDivElement[] = [];
  private readonly wallJumps: HTMLDivElement[] = [];
  private readonly airJumps: HTMLDivElement[] = [];
  private readonly speed: HTMLDivElement;
  private readonly debugEl: HTMLDivElement;
  private readonly slowmo: HTMLDivElement;
  private readonly healthBar: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthLag: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly posture: HTMLDivElement;
  private readonly postureFill: HTMLDivElement;
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
  readonly quitButton: HTMLButtonElement;
  private readonly hotbar: HTMLDivElement[] = [];
  private readonly heldName: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly pickupsEl: HTMLDivElement;
  private readonly savedEl: HTMLDivElement;
  private hotbarVersion = -1;
  private heldTimer = 0;
  private toastTimer = 0;
  private savedTimer = 0;
  private readonly loading: HTMLDivElement;
  private readonly loadingText: HTMLDivElement;
  private worldInfo = '';
  private debugOn = false;
  private fps = 60;
  private lagHealth: number = COMBAT.PLAYER_MAX_HEALTH;
  private readonly foodBar: HTMLDivElement;
  private readonly foodFill: HTMLDivElement;
  private readonly foodPool: HTMLDivElement;
  private readonly eatBar: HTMLDivElement;
  private readonly eatFill: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private statusKey = '';
  private readonly clockEl: HTMLDivElement;
  private readonly memoryMark: HTMLDivElement;
  private readonly deadNote: HTMLElement;
  private readonly sleepEl: HTMLDivElement;
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
    for (let i = 0; i < UPGRADES.MAX_AIR_JUMPS; i++) this.airJumps.push(el('div', 'wj air', wj));
    const pips = el('div', 'pips', bottom);
    for (let i = 0; i < UPGRADES.MAX_DASH_PIPS; i++) {
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
    this.foodBar = el('div', 'bar food', vitals);
    this.foodPool = el('div', 'pool', this.foodBar);
    this.foodFill = el('div', 'fill', this.foodBar);
    this.eatBar = el('div', 'bar eat', vitals);
    this.eatFill = el('div', 'fill', this.eatBar);
    this.statusEl = el('div', 'status', vitals);
    this.clockEl = el('div', 'clock', hud);
    this.memoryMark = el('div', 'memory-mark', hud);

    this.mode = el('div', 'mode', hud);

    this.flashes = {
      parry: { el: el('div', 'flash parry', hud), v: 0 },
      hurt: { el: el('div', 'flash hurt', hud), v: 0 },
      heal: { el: el('div', 'flash heal', hud), v: 0 },
    };

    const hotbar = el('div', 'hotbar', hud);
    for (let i = 0; i < INVENTORY.HOTBAR; i++) this.hotbar.push(el('div', 'slot', hotbar));
    this.heldName = el('div', 'held-name', hud);
    this.toastEl = el('div', 'toast', hud);
    this.toastEl.style.opacity = '0';
    this.pickupsEl = el('div', 'pickups', hud);
    this.savedEl = el('div', 'saved', hud);
    this.savedEl.textContent = 'SAVED';
    this.loading = el('div', 'loading', root);
    this.loading.innerHTML = '<b>BLADEFALL</b>';
    this.loadingText = el('div', '', this.loading);

    this.debugEl = el('div', 'debug', hud);
    this.slowmo = el('div', 'flag', hud);
    this.slowmo.textContent = 'SLOW-MO';
    this.deadEl = el('div', 'dead', root);
    this.deadEl.textContent = 'YOU DIED';
    this.deadNote = el('small', '', this.deadEl);
    this.sleepEl = el('div', 'sleep', root);

    this.overlay = el('div', 'overlay', root);
    const panel = el('div', 'panel', this.overlay);
    panel.innerHTML = `
      <h1>BLADEFALL</h1>
      <p class="sub">Paused</p>
      <table>${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="go">Click to play</div>
      <div class="pause-actions"><button type="button" class="quit">Save and quit to menu</button></div>`;
    this.quitButton = panel.querySelector('.quit') as HTMLButtonElement;
  }

  /** Hunger, temperature, clock and memory marker. */
  updateSurvival(v: SurvivalHud, camera: PerspectiveCamera): void {
    this.foodFill.style.width = `${v.food}%`;
    this.foodPool.style.width = `${Math.min(100, v.food + v.healPool)}%`;
    this.foodBar.classList.toggle('low', v.hunger === 'hungry' || v.hunger === 'starving');
    this.eatBar.classList.toggle('on', v.eating > 0);
    this.eatFill.style.width = `${v.eating * 100}%`;
    const chips: [string, string][] = [];
    if (v.hunger === 'starving') chips.push(['starving', 'STARVING']);
    else if (v.hunger === 'hungry') chips.push(['hungry', 'HUNGRY']);
    else if (v.hunger === 'fed') chips.push(['fed', 'WELL FED']);
    if (v.temp === 'freezing') chips.push(['freezing', 'FREEZING']);
    else if (v.temp === 'cold') chips.push(['cold', 'COLD']);
    else if (v.temp === 'hot') chips.push(['hot', 'HOT']);
    else if (v.temp === 'warm') chips.push(['warm', 'BY THE FIRE']);
    if (v.warmBuff) chips.push(['warm', 'WARMED']);
    const key = chips.map((c) => c[0] + c[1]).join('|');
    if (key !== this.statusKey) {
      this.statusKey = key;
      this.statusEl.innerHTML = chips.map(([cls, text]) => `<span class="${cls}">${text}</span>`).join('');
    }
    this.clockEl.classList.toggle('night', v.night);
    this.clockEl.innerHTML = `DAY <b>${v.day}</b> · ${v.phase}` + (this.debugOn ? ` · ${v.bodyTemp.toFixed(1)}°` : '');
    this.deadNote.textContent = v.deathNote;

    // Memory marker (only when in front of the camera).
    const m = v.memory;
    let show = false;
    if (m) {
      const p = new Vector3(m.x, m.y + 0.6, m.z);
      const dist = p.distanceTo(camera.position);
      const dir = new Vector3();
      camera.getWorldDirection(dir);
      if (p.clone().sub(camera.position).dot(dir) > 0) {
        p.project(camera);
        if (Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1) {
          show = true;
          this.memoryMark.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
          this.memoryMark.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
          this.memoryMark.textContent = `MEMORY · ${m.coins} COINS · ${Math.round(dist)}m`;
        }
      }
    }
    this.memoryMark.classList.toggle('on', show);
  }

  /** Full-screen fade for sleeping (0..1). */
  setSleep(amount: number, text = ''): void {
    this.sleepEl.style.opacity = amount.toFixed(3);
    this.sleepEl.textContent = amount > 0.6 ? text : '';
  }

  flash(kind: 'parry' | 'hurt' | 'heal', strength = 1): void {
    this.flashes[kind].v = Math.max(this.flashes[kind].v, strength);
  }

  onHeal(): void {
    this.healGlow = 1;
  }

  setLoading(on: boolean, jobs: number): void {
    this.loading.classList.toggle('on', on);
    if (on) this.loadingText.textContent = `Generating world… (${jobs} columns in progress)`;
  }

  /** Brief centered notice (e.g. "Needs a copper pickaxe"). */
  toast(text: string, seconds = 1.8): void {
    this.toastEl.textContent = text;
    this.toastTimer = seconds;
  }

  pickup(item: string, count: number): void {
    const row = document.createElement('div');
    row.textContent = `+${count} ${itemName(item)}`;
    this.pickupsEl.appendChild(row);
    setTimeout(() => (row.style.opacity = '0'), 1600);
    setTimeout(() => row.remove(), 2200);
    while (this.pickupsEl.children.length > 6) this.pickupsEl.firstChild?.remove();
  }

  showSaved(): void {
    this.savedTimer = 1.5;
  }

  updateItems(inv: Inventory, b: Builder, worldInfo: string, dt: number): void {
    this.worldInfo = worldInfo;
    if (inv.version !== this.hotbarVersion) {
      const prevSel = this.hotbar.findIndex((e) => e.classList.contains('sel'));
      const prevItem = this.heldName.dataset.item;
      this.hotbarVersion = inv.version;
      this.hotbar.forEach((slot, i) => {
        slot.innerHTML = `<span class="key">${i + 1}</span>` + stackHTML(inv.slots[i]);
        slot.classList.toggle('sel', i === inv.selected);
      });
      const held = inv.held;
      const heldId = held?.item ?? '';
      if (prevSel !== inv.selected || prevItem !== heldId) {
        this.heldName.textContent = held ? itemName(held.item) : '';
        this.heldName.dataset.item = heldId;
        this.heldTimer = 2;
      }
    }
    this.heldTimer -= dt;
    this.heldName.style.opacity = this.heldTimer > 0 ? '1' : '0';
    this.toastTimer -= dt;
    this.toastEl.style.opacity = this.toastTimer > 0 ? '1' : '0';
    this.savedTimer -= dt;
    this.savedEl.style.opacity = this.savedTimer > 0 ? '1' : '0';
    if (b.target && b.enabled && this.debugOn) this.worldInfo += `\ntarget   ${BLOCKS[b.target.id].name}`;
  }

  get debugVisible(): boolean {
    return this.debugOn;
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
      this.pips[i].classList.toggle('locked', i >= p.abilities.dashPips);
    }
    for (let i = 0; i < this.wallJumps.length; i++) {
      this.wallJumps[i].classList.toggle('used', i >= p.wallJumpsLeft);
      this.wallJumps[i].classList.toggle('locked', i >= p.abilities.wallJumps);
    }
    for (let i = 0; i < this.airJumps.length; i++) {
      this.airJumps[i].classList.toggle('used', i >= p.airJumpsLeft);
      this.airJumps[i].classList.toggle('locked', i >= p.abilities.airJumps);
    }

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

    const d0 = cs.enemies.find((e) => e.kind === 'dummy') as Dummy | undefined;
    const wild = cs.enemies.filter((e) => e.kind !== 'dummy' && e.alive).length;
    this.mode.innerHTML = (d0 ? `DUMMY [G]: <b>${DUMMY_MODE_LABELS[d0.mode]}</b>` : '') + (wild ? ` · ENEMIES: <b>${wild}</b>` : '');

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
        (d0 ? `dummy    ${d0.phase} ${d0.t.toFixed(2)} hp ${d0.health.toFixed(0)} post ${d0.posture.value.toFixed(0)}\n` : '') +
        this.worldInfo;
    }
  }

  private updateTargets(cs: CombatSystem, camera: PerspectiveCamera): void {
    const dbTarget = cs.deathblowTarget();
    const w = window.innerWidth, h = window.innerHeight;
    const v = new Vector3();
    const camDir = new Vector3();
    camera.getWorldDirection(camDir);

    const n = cs.enemies.length;
    for (let i = n; i < this.targets.length; i++) {
      this.targets[i].root.classList.remove('on');
      this.warns[i]?.classList.remove('on');
    }
    cs.enemies.forEach((d, i) => {
      const t = (this.targets[i] ??= this.makeTarget());
      v.set(d.pos.x, d.pos.y + d.height + 0.45, d.pos.z);
      const toTarget = v.clone().sub(camera.position);
      // Wild enemies only show bars once engaged (hurt, posture taken) or close.
      const engaged = d.kind === 'dummy' || d.health < d.maxHealth || d.posture.value > 0 || toTarget.length() < 10;
      const visible = d.alive && engaged && toTarget.dot(camDir) > 0 && toTarget.length() < 40;
      t.root.classList.toggle('on', visible);
      if (visible) {
        v.project(camera);
        t.root.style.left = `${((v.x + 1) / 2) * w}px`;
        t.root.style.top = `${((1 - v.y) / 2) * h}px`;
        t.health.style.width = `${(d.health / d.maxHealth) * 100}%`;
        t.posture.style.width = `${d.posture.fraction * 100}%`;
        t.prompt.classList.toggle('on', d === dbTarget);
      }

      // Off-screen attack warning.
      const warn = (this.warns[i] ??= this.makeWarn());
      // Darkness hides telegraphs: no off-screen warning for attackers you couldn't see.
      const threat = d.threatening() && (d.lit ?? 1) > 0.25;
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
