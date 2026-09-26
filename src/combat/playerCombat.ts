import { COMBAT, WEAPONS, type AttackDef, type AttackDir, type WeaponDef } from '../config';
import { directionFromAim } from './melee';
import { Posture } from './posture';

export type CombatPhase =
  | 'idle'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'parry' // block pressed; perfect window may be open, then becomes guard if held
  | 'recoil' // got parried
  | 'staggered' // posture broken
  | 'deathblow';

export interface CombatIntent {
  attackPressed: boolean;
  attackHeld: boolean;
  blockPressed: boolean;
  blockHeld: boolean;
  feintPressed: boolean;
  /** A dash started this step (cancels windup/recovery/parry). */
  dashed: boolean;
}

export const NO_COMBAT_INTENT: CombatIntent = {
  attackPressed: false,
  attackHeld: false,
  blockPressed: false,
  blockHeld: false,
  feintPressed: false,
  dashed: false,
};

export interface Swing {
  /** Unique per swing, so each target is hit once per swing. */
  id: number;
  def: AttackDef;
  heavy: boolean;
  /** Undecided until released or held past HEAVY_HOLD_TIME. */
  decided: boolean;
  comboIndex: number;
  dir: AttackDir;
  aimX: number;
  aimY: number;
  riposte: boolean;
  /** Which hand (dual wield): 1 = right, -1 = left. */
  hand: 1 | -1;
}

export type CombatEvent =
  | { type: 'swingStart'; heavy: boolean; riposte: boolean }
  | { type: 'swingActive'; swing: Swing }
  | { type: 'feint' }
  | { type: 'parryStart' };

let swingIds = 1;

/** The player's melee state machine: attacks, combos, heavies, feints, parry and guard. */
export class PlayerCombat {
  weaponIndex = 0;
  phase: CombatPhase = 'idle';
  /** Time in the current phase. */
  t = 0;
  /** Length of the current recovery/recoil/stagger phase. */
  phaseLen = 0;
  swing: Swing | null = null;
  comboIndex = 0;
  private comboResetTimer = 0;
  private attackBuffered = false;

  /** Whether the current block press opened a perfect-parry window. */
  perfectArmed = false;
  /** Presses during this lockout only guard (anti-mash). */
  parryLockout = 0;
  riposteTimer = 0;
  /** Time since the player last landed a hit (for aggressive posture regen). */
  sinceLandedHit = Infinity;

  health: number = COMBAT.PLAYER_MAX_HEALTH;
  readonly posture = new Posture(COMBAT.PLAYER_MAX_POSTURE);
  perfectParries = 0;

  events: CombatEvent[] = [];

  get weapon(): WeaponDef {
    return WEAPONS[this.weaponIndex];
  }

  setWeapon(i: number): void {
    if (i < 0 || i >= WEAPONS.length || i === this.weaponIndex) return;
    if (this.phase === 'recoil' || this.phase === 'staggered' || this.phase === 'deathblow') return;
    this.weaponIndex = i;
    this.toIdle();
    this.comboIndex = 0;
  }

  /** Mouse movement since last call, applied to the swing direction while winding up. */
  addAim(dx: number, dy: number): void {
    if (this.phase === 'windup' && this.swing) {
      this.swing.aimX += dx;
      this.swing.aimY += dy;
    }
  }

  /** Direction the current swing will go (live during windup). */
  currentDir(): AttackDir {
    const s = this.swing;
    if (!s) return 'slashR';
    if (this.phase !== 'windup') return s.dir;
    return directionFromAim(s.aimX, s.aimY, s.dir);
  }

  perfectWindow(): number {
    return COMBAT.PERFECT_PARRY_WINDOW * this.weapon.parryWindowMult;
  }

  isPerfectParry(): boolean {
    return this.phase === 'parry' && this.perfectArmed && this.t <= this.perfectWindow();
  }

  isGuarding(): boolean {
    return this.phase === 'parry';
  }

  /** Can the player act (not stunned)? */
  canAct(): boolean {
    return this.phase !== 'recoil' && this.phase !== 'staggered' && this.phase !== 'deathblow';
  }

  moveSpeedMult(): number {
    if (this.phase === 'parry') return COMBAT.GUARD_MOVE_MULT;
    if (this.phase === 'windup' && this.swing?.heavy) return COMBAT.HEAVY_WINDUP_MOVE_MULT;
    if (this.phase === 'staggered') return 0.2;
    if (this.phase === 'recoil') return 0.5;
    return 1;
  }

  update(dt: number, input: CombatIntent): void {
    this.t += dt;
    this.riposteTimer = Math.max(0, this.riposteTimer - dt);
    this.parryLockout = Math.max(0, this.parryLockout - dt);
    this.sinceLandedHit += dt;
    if (this.phase === 'idle' && this.comboResetTimer > 0) {
      this.comboResetTimer -= dt;
      if (this.comboResetTimer <= 0) this.comboIndex = 0;
    }

    let regen = 1;
    if (this.phase === 'parry') regen *= COMBAT.POSTURE_REGEN_GUARD_MULT;
    if (this.sinceLandedHit < COMBAT.AGGRO_WINDOW) regen *= COMBAT.POSTURE_REGEN_AGGRO_MULT;
    if (this.phase !== 'staggered') this.posture.update(dt, regen);

    if (input.dashed && (this.phase === 'windup' || this.phase === 'recovery' || this.phase === 'parry')) {
      if (this.phase === 'windup' && this.swing?.heavy) this.events.push({ type: 'feint' });
      this.toIdle();
    }

    switch (this.phase) {
      case 'idle':
        if (input.blockPressed) this.startParry();
        else if (input.attackPressed || this.attackBuffered) this.startSwing(input.attackHeld);
        break;

      case 'windup': {
        const s = this.swing!;
        if (input.blockPressed) {
          if (s.heavy) this.events.push({ type: 'feint' });
          this.startParry();
          break;
        }
        if (input.feintPressed && s.heavy) {
          this.feint();
          break;
        }
        if (!s.decided) {
          if (!input.attackHeld) s.decided = true;
          else if (this.t >= COMBAT.HEAVY_HOLD_TIME) {
            s.decided = true;
            s.heavy = true;
            s.def = this.weapon.heavy;
            s.dir = this.weapon.heavyDir;
            this.events.push({ type: 'swingStart', heavy: true, riposte: s.riposte });
          }
        }
        const windup = s.def.windup * (s.riposte ? COMBAT.RIPOSTE_WINDUP_MULT : 1);
        if (s.decided && this.t >= windup) {
          s.dir = directionFromAim(s.aimX, s.aimY, s.dir);
          this.setPhase('active', s.def.active);
          this.events.push({ type: 'swingActive', swing: s });
        }
        break;
      }

      case 'active':
        if (input.attackPressed) this.attackBuffered = true;
        if (this.t >= this.phaseLen) this.setPhase('recovery', this.swing!.def.recovery);
        break;

      case 'recovery':
        if (input.attackPressed) this.attackBuffered = true;
        if (input.blockPressed) {
          this.startParry();
          break;
        }
        if (this.attackBuffered && this.t >= this.phaseLen * COMBAT.COMBO_CANCEL_FRACTION && this.swing && !this.swing.heavy) {
          this.comboIndex = (this.comboIndex + 1) % this.weapon.light.length;
          this.startSwing(input.attackHeld);
          break;
        }
        if (this.t >= this.phaseLen) {
          const endedCombo = !this.swing || this.swing.heavy;
          this.toIdle();
          if (endedCombo) this.comboIndex = 0;
          else {
            this.comboIndex = (this.comboIndex + 1) % this.weapon.light.length;
            this.comboResetTimer = COMBAT.COMBO_RESET_TIME;
          }
        }
        break;

      case 'parry':
        if (this.t > this.perfectWindow() && !input.blockHeld) {
          if (this.perfectArmed) this.parryLockout = COMBAT.PARRY_SPAM_LOCKOUT;
          this.toIdle();
        } else if (input.attackPressed && this.t > this.perfectWindow()) {
          // Attacking out of guard.
          if (this.perfectArmed) this.parryLockout = COMBAT.PARRY_SPAM_LOCKOUT;
          this.phase = 'idle';
          this.startSwing(true);
        }
        break;

      case 'recoil':
      case 'staggered':
        if (this.t >= this.phaseLen) this.toIdle();
        break;

      case 'deathblow':
        break;
    }
  }

  /** Called when this player's perfect parry deflected something. */
  onPerfectParry(): void {
    this.perfectParries++;
    this.riposteTimer = COMBAT.RIPOSTE_WINDOW;
    this.parryLockout = 0;
  }

  /** Our swing got parried by the enemy. */
  onParried(): void {
    const posture = (this.swing?.def.posture ?? 10) * COMBAT.PARRIED_POSTURE_MULT;
    if (this.posture.damage(posture)) this.stagger();
    else this.setPhase('recoil', COMBAT.PARRIED_RECOIL_TIME);
    this.swing = null;
  }

  onLandedHit(): void {
    this.sinceLandedHit = 0;
  }

  /** Apply posture damage; staggers on break. */
  takePosture(amount: number): void {
    if (this.posture.damage(amount)) this.stagger();
  }

  stagger(): void {
    this.swing = null;
    this.setPhase('staggered', COMBAT.PLAYER_STAGGER_TIME);
    this.posture.reset();
    this.posture.value = this.posture.max * 0.5;
  }

  startDeathblow(): void {
    this.swing = null;
    this.attackBuffered = false;
    this.setPhase('deathblow', COMBAT.DEATHBLOW_TIME);
  }

  endDeathblow(): void {
    this.toIdle();
    this.comboIndex = 0;
  }

  reset(): void {
    this.health = COMBAT.PLAYER_MAX_HEALTH;
    this.posture.reset();
    this.riposteTimer = 0;
    this.parryLockout = 0;
    this.comboIndex = 0;
    this.toIdle();
  }

  private startSwing(held: boolean): void {
    const w = this.weapon;
    const i = this.comboIndex % w.light.length;
    const riposte = this.riposteTimer > 0;
    this.riposteTimer = 0;
    this.attackBuffered = false;
    this.swing = {
      id: swingIds++,
      def: w.light[i],
      heavy: false,
      decided: !held,
      comboIndex: i,
      dir: w.lightDirs[i],
      aimX: 0,
      aimY: 0,
      riposte,
      hand: w.dualWield && i % 2 === 1 ? -1 : 1,
    };
    this.setPhase('windup', 0);
    this.events.push({ type: 'swingStart', heavy: false, riposte });
  }

  private feint(): void {
    this.events.push({ type: 'feint' });
    this.posture.damage(COMBAT.FEINT_POSTURE_COST);
    this.swing = null;
    this.setPhase('recovery', COMBAT.FEINT_RECOVERY);
  }

  private startParry(): void {
    this.swing = null;
    this.attackBuffered = false;
    this.perfectArmed = this.parryLockout <= 0;
    this.setPhase('parry', 0);
    this.events.push({ type: 'parryStart' });
  }

  private toIdle(): void {
    this.phase = 'idle';
    this.t = 0;
    this.phaseLen = 0;
    this.attackBuffered = false;
  }

  private setPhase(p: CombatPhase, len: number): void {
    this.phase = p;
    this.t = 0;
    this.phaseLen = len;
  }
}
