import { Vector3 } from 'three';
import { COMBAT, ENEMIES, type EnemyAttackDef } from '../config';
import { lerp, moveToward2 } from '../core/math';
import type { Combatant, CombatantEvent, PlayerView } from '../combat/combatant';
import { Posture } from '../combat/posture';
import { moveBox, type AABB } from '../world/collision';
import type { VoxelQuery } from '../world/world';

/** Shared state machine phases for wild enemies. */
export type EnemyPhase =
  | 'idle'
  | 'chase'
  | 'windup'
  | 'active'
  | 'recovery'
  | 'shootWindup'
  | 'dive'
  | 'climb'
  | 'recoil'
  | 'staggered'
  | 'dead';

/**
 * Common enemy plumbing: physics against voxels, health/posture, taking hits, being parried,
 * stagger, death and loot. Subclasses implement `think()` (the AI).
 */
export abstract class EnemyBase implements Combatant {
  abstract readonly kind: string;
  readonly pos = new Vector3();
  readonly prevPos = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  health: number;
  readonly posture: Posture;
  lastHitSwing = 0;
  events: CombatantEvent[] = [];
  phase: EnemyPhase = 'idle';
  t = 0;
  phaseLen = 0;
  attack: EnemyAttackDef | null = null;
  grounded = false;
  /** Seconds since last hurt (for flinch animation). */
  hurtTime = 10;
  protected cooldown = 1;
  protected rng: () => number;

  constructor(
    x: number,
    y: number,
    z: number,
    readonly maxHealth: number,
    maxPosture: number,
    readonly width: number,
    readonly height: number,
    rng: () => number = Math.random,
  ) {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.health = maxHealth;
    this.posture = new Posture(maxPosture);
    this.rng = rng;
  }

  get alive(): boolean {
    return this.phase !== 'dead';
  }
  get staggered(): boolean {
    return this.phase === 'staggered';
  }
  get removable(): boolean {
    return this.phase === 'dead' && this.t > ENEMIES.CORPSE_TIME;
  }

  hurtbox(): AABB {
    const h = this.width / 2;
    return {
      minX: this.pos.x - h, minY: this.pos.y, minZ: this.pos.z - h,
      maxX: this.pos.x + h, maxY: this.pos.y + this.height, maxZ: this.pos.z + h,
    };
  }

  center(): Vector3 {
    return new Vector3(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
  }

  isParrying(): boolean {
    return false;
  }

  telegraph(): 'none' | 'yellow' | 'red' {
    if (this.phase === 'shootWindup') return 'yellow';
    if ((this.phase === 'windup' || this.phase === 'active') && this.attack) return this.attack.unblockable ? 'red' : 'yellow';
    return 'none';
  }

  threatening(): boolean {
    return this.phase === 'windup' || this.phase === 'shootWindup';
  }

  update(dt: number, world: VoxelQuery, player: PlayerView): void {
    this.prevPos.copy(this.pos);
    this.t += dt;
    this.hurtTime += dt;
    if (this.phase !== 'staggered' && this.phase !== 'dead') {
      this.posture.update(dt, lerp(COMBAT.POSTURE_REGEN_LOW_HEALTH_MULT, 1, this.health / this.maxHealth));
    }
    if (this.phase === 'dead') {
      this.physics(dt, world, true);
      return;
    }
    if (this.phase === 'staggered') {
      this.physics(dt, world, true);
      if (this.t >= this.phaseLen) this.recoverFromStagger();
      return;
    }
    this.think(dt, world, player);
  }

  protected abstract think(dt: number, world: VoxelQuery, player: PlayerView): void;

  protected recoverFromStagger(): void {
    this.posture.reset();
    this.posture.value = this.posture.max * 0.5;
    this.toIdle();
  }

  /** Move with gravity (optional), ground friction and voxel collision. */
  protected physics(dt: number, world: VoxelQuery, gravity: boolean, friction = 18): { hitX: boolean; hitZ: boolean } {
    if (gravity) {
      this.vel.y = Math.max(this.vel.y - 46 * dt, -60);
      if (this.grounded) {
        const h = { x: this.vel.x, z: this.vel.z };
        moveToward2(h, 0, 0, friction * dt);
        this.vel.x = h.x;
        this.vel.z = h.z;
      }
    }
    const box = this.hurtbox();
    const hit = moveBox(world, box, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    this.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    if (hit.hitX) this.vel.x = 0;
    if (hit.hitZ) this.vel.z = 0;
    this.grounded = false;
    if (hit.hitY) {
      if (this.vel.y < 0) this.grounded = true;
      this.vel.y = 0;
    }
    if (this.pos.y < -20) this.kill();
    return hit;
  }

  protected faceToward(x: number, z: number, dt: number, rate: number): void {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const max = rate * dt;
    this.yaw += Math.max(-max, Math.min(max, d));
  }

  protected startAttack(a: EnemyAttackDef): void {
    this.attack = a;
    this.setPhase('windup', a.windup);
    this.events.push({ type: 'telegraph', unblockable: a.unblockable });
  }

  /** Advance windup → active → recovery; returns true while an attack is in progress. */
  protected runAttack(onActiveStart?: () => void): boolean {
    const a = this.attack;
    if (!a) return false;
    if (this.phase === 'windup' && this.t >= this.phaseLen) {
      this.setPhase('active', a.active);
      this.events.push({ type: 'attack', attack: a });
      onActiveStart?.();
    } else if (this.phase === 'active' && this.t >= this.phaseLen) {
      this.setPhase('recovery', a.recovery);
    } else if (this.phase === 'recovery' && this.t >= this.phaseLen) {
      this.attack = null;
      this.toIdle();
      return false;
    }
    return this.phase === 'windup' || this.phase === 'active' || this.phase === 'recovery';
  }

  takeHit(damage: number, posture: number, knockX: number, knockZ: number): { broke: boolean; died: boolean } {
    this.health -= damage;
    this.hurtTime = 0;
    this.vel.x += knockX;
    this.vel.z += knockZ;
    this.vel.y = Math.max(this.vel.y, 2.5);
    this.events.push({ type: 'aggro' });
    if (this.health <= 0) {
      this.kill();
      return { broke: false, died: true };
    }
    const broke = this.phase !== 'staggered' && this.posture.damage(posture);
    if (broke) this.stagger();
    return { broke, died: false };
  }

  onParried(postureDamage: number): boolean {
    if (this.posture.damage(postureDamage)) {
      this.stagger();
      return true;
    }
    this.attack = null;
    this.setPhase('recoil', this.recoilTime());
    return false;
  }

  onParriedPlayer(): void {}

  protected recoilTime(): number {
    return 0.9;
  }

  kill(): void {
    if (this.phase === 'dead') return;
    this.health = 0;
    this.attack = null;
    this.setPhase('dead', 0);
  }

  protected stagger(): void {
    this.attack = null;
    this.setPhase('staggered', COMBAT.ENEMY_STAGGER_TIME);
  }

  protected toIdle(): void {
    this.attack = null;
    this.setPhase('idle', 0);
  }

  protected setPhase(p: EnemyPhase, len: number): void {
    this.phase = p;
    this.t = 0;
    this.phaseLen = len;
  }

  protected abstract lootTable(): Record<string, readonly [number, number]>;

  loot(): { item: string; count: number }[] {
    const out: { item: string; count: number }[] = [];
    for (const [item, [lo, hi]] of Object.entries(this.lootTable())) {
      const n = lo + Math.floor(this.rng() * (hi - lo + 1));
      if (n > 0) out.push({ item, count: n });
    }
    return out;
  }
}
