import { Vector3 } from 'three';
import { COMBAT, DUMMY, type EnemyAttackDef } from '../config';
import { lerp, moveToward2 } from '../core/math';
import { moveBox, type AABB } from '../world/collision';
import type { VoxelQuery } from '../world/world';
import { Posture } from './posture';

export type DummyMode = 'idle' | 'attacker' | 'mixed' | 'shooter' | 'parrier';
export const DUMMY_MODES: DummyMode[] = ['idle', 'attacker', 'mixed', 'shooter', 'parrier'];
export const DUMMY_MODE_LABELS: Record<DummyMode, string> = {
  idle: 'Idle — punching bag',
  attacker: 'Attacker — parryable swings',
  mixed: 'Mixed — feints + red sweeps (jump/dash them)',
  shooter: 'Shooter — parry projectiles back',
  parrier: 'Parrier — parries your lights; use heavies & feints',
};

export type DummyPhase =
  | 'idle'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'shootWindup'
  | 'recoil'
  | 'parry'
  | 'parryWhiff'
  | 'staggered'
  | 'dead';

export type DummyEvent =
  | { type: 'attack'; attack: EnemyAttackDef }
  | { type: 'telegraph'; unblockable: boolean }
  | { type: 'feint' }
  | { type: 'shoot' }
  | { type: 'respawn' };

export interface PlayerView {
  pos: Vector3;
  /** Player is in a melee windup with this swing id (0 if not). */
  windupSwingId: number;
}

export class Dummy {
  readonly pos = new Vector3();
  readonly prevPos = new Vector3();
  readonly vel = new Vector3();
  readonly spawn = new Vector3();
  yaw = 0;
  mode: DummyMode = 'attacker';

  phase: DummyPhase = 'idle';
  t = 0;
  phaseLen = 0;
  attack: EnemyAttackDef | null = null;
  private feintAt = -1;
  private comboLeft = 0;
  private cooldown = 1;
  private parryTimer = -1;
  private lastSeenSwing = 0;
  /** Last player swing id that hit us (each swing hits once). */
  lastHitSwing = 0;

  health: number = DUMMY.MAX_HEALTH;
  readonly posture = new Posture(DUMMY.MAX_POSTURE);
  events: DummyEvent[] = [];

  constructor(x: number, y: number, z: number, private readonly rng: () => number = Math.random) {
    this.spawn.set(x, y, z);
    this.respawn();
  }

  get alive(): boolean {
    return this.phase !== 'dead';
  }

  get staggered(): boolean {
    return this.phase === 'staggered';
  }

  isParrying(): boolean {
    return this.phase === 'parry';
  }

  /** Weapon glow: yellow = parryable, red = unblockable. */
  telegraph(): 'none' | 'yellow' | 'red' {
    if (this.phase === 'shootWindup') return 'yellow';
    if ((this.phase === 'windup' || this.phase === 'active') && this.attack) {
      return this.attack.unblockable ? 'red' : 'yellow';
    }
    return 'none';
  }

  /** Is this dummy currently winding up an attack aimed at the player? */
  threatening(): boolean {
    return this.phase === 'windup' || this.phase === 'shootWindup';
  }

  hurtbox(): AABB {
    const h = DUMMY.WIDTH / 2;
    return {
      minX: this.pos.x - h, minY: this.pos.y, minZ: this.pos.z - h,
      maxX: this.pos.x + h, maxY: this.pos.y + DUMMY.HEIGHT, maxZ: this.pos.z + h,
    };
  }

  center(): Vector3 {
    return new Vector3(this.pos.x, this.pos.y + DUMMY.HEIGHT * 0.6, this.pos.z);
  }

  respawn(): void {
    this.pos.copy(this.spawn);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.health = DUMMY.MAX_HEALTH;
    this.posture.reset();
    this.setPhase('idle', 0);
    this.attack = null;
    this.cooldown = 1;
    this.parryTimer = -1;
  }

  moveTo(x: number, y: number, z: number): void {
    this.spawn.set(x, y, z);
    this.respawn();
    this.events.push({ type: 'respawn' });
  }

  setMode(m: DummyMode): void {
    this.mode = m;
    if (this.alive && this.phase !== 'staggered') this.setPhase('idle', 0);
    this.attack = null;
    this.cooldown = 0.8;
  }

  update(dt: number, world: VoxelQuery, player: PlayerView): void {
    this.prevPos.copy(this.pos);
    this.t += dt;

    // Physics: knockback slides, gravity.
    const h = { x: this.vel.x, z: this.vel.z };
    moveToward2(h, 0, 0, DUMMY.FRICTION * dt);
    this.vel.x = h.x;
    this.vel.z = h.z;
    this.vel.y -= 32 * dt;
    const box = this.hurtbox();
    const hit = moveBox(world, box, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    this.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    if (hit.hitY) this.vel.y = 0;
    if (hit.hitX) this.vel.x = 0;
    if (hit.hitZ) this.vel.z = 0;
    if (this.pos.y < -30) this.respawn();

    if (this.phase === 'dead') {
      if (this.t >= DUMMY.RESPAWN_TIME) {
        this.respawn();
        this.events.push({ type: 'respawn' });
      }
      return;
    }

    if (this.phase !== 'staggered') {
      this.posture.update(dt, lerp(COMBAT.POSTURE_REGEN_LOW_HEALTH_MULT, 1, this.health / DUMMY.MAX_HEALTH));
    }

    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // Face the player (not while swinging or stunned).
    if (this.phase === 'idle' || this.phase === 'windup' || this.phase === 'shootWindup' || this.phase === 'parry') {
      const want = Math.atan2(-dx, -dz);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = DUMMY.TURN_RATE * dt * (this.phase === 'windup' ? 0.6 : 1);
      this.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
    }

    // Parrier: react to the player's windups.
    if (this.mode === 'parrier' && player.windupSwingId !== 0 && player.windupSwingId !== this.lastSeenSwing) {
      this.lastSeenSwing = player.windupSwingId;
      if (dist < 5.5 && (this.phase === 'idle' || this.phase === 'recovery')) this.parryTimer = DUMMY.PARRY_REACTION;
    }
    if (this.parryTimer >= 0) {
      this.parryTimer -= dt;
      if (this.parryTimer < 0 && (this.phase === 'idle' || this.phase === 'recovery')) this.setPhase('parry', DUMMY.PARRY_WINDOW);
    }

    switch (this.phase) {
      case 'idle':
        this.cooldown -= dt;
        if (this.cooldown <= 0) this.chooseAction(dist);
        break;

      case 'windup':
        if (this.feintAt >= 0 && this.t >= this.feintAt) {
          this.feintAt = -1;
          this.events.push({ type: 'feint' });
          // Pause, then a fast real attack.
          this.attack = null;
          this.comboLeft = 1;
          this.setPhase('recovery', 0.15);
          break;
        }
        if (this.t >= this.phaseLen) {
          this.setPhase('active', this.attack!.active);
          this.events.push({ type: 'attack', attack: this.attack! });
        }
        break;

      case 'active':
        if (this.t >= this.phaseLen) this.setPhase('recovery', this.attack!.recovery);
        break;

      case 'recovery':
        if (this.t >= this.phaseLen) {
          if (this.comboLeft > 0 && dist < DUMMY.AGGRO_RANGE + 1) {
            this.comboLeft--;
            this.startAttack(DUMMY.ATTACKS.quick, false);
          } else {
            this.toIdle();
          }
        }
        break;

      case 'shootWindup':
        if (this.t >= this.phaseLen) {
          this.events.push({ type: 'shoot' });
          this.cooldown = DUMMY.SHOOT_COOLDOWN;
          this.setPhase('idle', 0);
        }
        break;

      case 'parry':
        if (this.t >= this.phaseLen) this.setPhase('parryWhiff', DUMMY.PARRY_WHIFF_RECOVERY);
        break;

      case 'parryWhiff':
      case 'recoil':
        if (this.t >= this.phaseLen) this.toIdle();
        break;

      case 'staggered':
        if (this.t >= this.phaseLen) {
          this.posture.reset();
          this.posture.value = this.posture.max * 0.5;
          this.toIdle();
        }
        break;
    }
  }

  /** We parried the player's attack: counter quickly. */
  onParriedPlayer(): void {
    this.parryTimer = -1;
    this.comboLeft = 0;
    this.startAttack(DUMMY.ATTACKS.quick, false);
  }

  /** The player perfect-parried us. */
  onParried(postureDamage: number): boolean {
    this.comboLeft = 0;
    this.feintAt = -1;
    if (this.posture.damage(postureDamage)) {
      this.stagger();
      return true;
    }
    this.setPhase('recoil', DUMMY.PARRIED_RECOIL);
    return false;
  }

  /** Take a hit. Returns whether posture broke and whether it died. */
  takeHit(damage: number, posture: number, knockX: number, knockZ: number): { broke: boolean; died: boolean } {
    this.health -= damage;
    this.vel.x += knockX;
    this.vel.z += knockZ;
    if (this.health <= 0) {
      this.kill();
      return { broke: false, died: true };
    }
    const broke = this.phase !== 'staggered' && this.posture.damage(posture);
    if (broke) this.stagger();
    return { broke, died: false };
  }

  kill(): void {
    this.health = 0;
    this.attack = null;
    this.setPhase('dead', 0);
  }

  private stagger(): void {
    this.attack = null;
    this.parryTimer = -1;
    this.setPhase('staggered', COMBAT.ENEMY_STAGGER_TIME);
  }

  private chooseAction(dist: number): void {
    const A = DUMMY.ATTACKS;
    switch (this.mode) {
      case 'idle':
        this.cooldown = 0.5;
        return;
      case 'shooter':
        if (dist < DUMMY.SHOOT_RANGE) {
          this.setPhase('shootWindup', DUMMY.SHOOT_WINDUP);
          this.events.push({ type: 'telegraph', unblockable: false });
        } else this.cooldown = 0.3;
        return;
      case 'attacker':
      case 'parrier':
        if (dist > DUMMY.AGGRO_RANGE) {
          this.cooldown = 0.2;
          return;
        }
        if (this.mode === 'parrier' && this.rng() < 0.5) {
          this.cooldown = 1; // parrier attacks less; it mostly waits for you
          return;
        }
        this.comboLeft = this.rng() < DUMMY.COMBO_CHANCE ? 1 : 0;
        this.startAttack(A.swing, false);
        return;
      case 'mixed': {
        if (dist > DUMMY.AGGRO_RANGE) {
          this.cooldown = 0.2;
          return;
        }
        const r = this.rng();
        if (r < DUMMY.UNBLOCKABLE_CHANCE) {
          this.comboLeft = 0;
          this.startAttack(A.sweep, false);
        } else if (r < DUMMY.UNBLOCKABLE_CHANCE + DUMMY.FEINT_CHANCE) {
          this.comboLeft = 0;
          this.startAttack(A.swing, true);
        } else {
          this.comboLeft = this.rng() < DUMMY.COMBO_CHANCE ? 1 : 0;
          this.startAttack(A.swing, false);
        }
        return;
      }
    }
  }

  private startAttack(a: EnemyAttackDef, feint: boolean): void {
    this.attack = a;
    this.feintAt = feint ? a.windup * DUMMY.FEINT_AT : -1;
    this.setPhase('windup', a.windup);
    this.events.push({ type: 'telegraph', unblockable: a.unblockable });
  }

  private toIdle(): void {
    this.attack = null;
    this.setPhase('idle', 0);
    this.cooldown = lerp(DUMMY.ATTACK_COOLDOWN_MIN, DUMMY.ATTACK_COOLDOWN_MAX, this.rng());
  }

  private setPhase(p: DummyPhase, len: number): void {
    this.phase = p;
    this.t = 0;
    this.phaseLen = len;
  }
}
