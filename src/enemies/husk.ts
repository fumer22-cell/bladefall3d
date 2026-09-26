import { ENEMIES } from '../config';
import { lerp } from '../core/math';
import type { PlayerView } from '../combat/combatant';
import type { VoxelQuery } from '../world/world';
import { EnemyBase } from './enemyBase';
import { findPath, type PathNode } from './pathfinding';

const H = ENEMIES.HUSK;

/**
 * Husk: a slow, hunched revenant with a rusted blade. It paths to the player over the voxels
 * and fights with long, clearly telegraphed swings (yellow = parry it) and an occasional red
 * lunge (jump or dash it). It exists to teach parrying.
 */
export class Husk extends EnemyBase {
  readonly kind = 'husk';
  private path: PathNode[] | null = null;
  private repath = 0;
  private wanderTarget: { x: number; z: number } | null = null;
  private comboLeft = 0;
  private aggro = false;
  /** Walk-cycle phase for the view. */
  stride = 0;

  /** Night spawn: tougher, hits harder, drops more. */
  readonly nightborn: boolean;

  constructor(x: number, y: number, z: number, rng: () => number = Math.random, nightborn = false) {
    super(x, y, z, H.HEALTH * (nightborn ? ENEMIES.NIGHTBORN_HEALTH_MULT : 1), H.POSTURE, H.WIDTH, H.HEIGHT, rng);
    this.yaw = rng() * Math.PI * 2;
    this.nightborn = nightborn;
    if (nightborn) {
      this.damageMult = ENEMIES.NIGHTBORN_DAMAGE_MULT;
      this.lootMult = ENEMIES.NIGHTBORN_LOOT_MULT;
    }
  }

  protected recoilTime(): number {
    return H.PARRIED_RECOIL;
  }

  protected lootTable() {
    return H.LOOT;
  }

  protected think(dt: number, world: VoxelQuery, player: PlayerView): void {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const dy = player.pos.y - this.pos.y;
    let moveX = 0, moveZ = 0, speed = 0;

    if (this.events.some((e) => e.type === 'aggro')) this.aggro = true;
    if (!this.aggro && dist < H.AGGRO_RANGE && Math.abs(dy) < 12) {
      this.aggro = true;
      this.events.push({ type: 'aggro' });
    }
    if (this.aggro && dist > H.LEASH_RANGE) this.aggro = false;

    switch (this.phase) {
      case 'windup':
      case 'active':
      case 'recovery': {
        if (this.phase === 'windup') this.faceToward(player.pos.x, player.pos.z, dt, H.TURN_RATE * 0.5);
        const lunging = this.phase === 'active' && this.attack?.name === 'lunge';
        if (lunging) {
          this.vel.x = -Math.sin(this.yaw) * H.LUNGE_SPEED;
          this.vel.z = -Math.cos(this.yaw) * H.LUNGE_SPEED;
        }
        if (!this.runAttack() && this.comboLeft > 0 && dist < H.ATTACK_RANGE + 0.8) {
          this.comboLeft--;
          this.startAttack(H.ATTACKS.slash);
        }
        break;
      }
      case 'recoil':
        if (this.t >= this.phaseLen) this.toIdle();
        break;
      default: {
        this.cooldown -= dt;
        if (this.aggro) {
          this.phase = 'chase';
          const inRange = dist < H.ATTACK_RANGE && Math.abs(dy) < 1.6;
          if (inRange) {
            this.faceToward(player.pos.x, player.pos.z, dt, H.TURN_RATE);
            if (this.cooldown <= 0) this.chooseAttack();
          } else {
            const step = this.followPath(dt, world, player);
            moveX = step.x;
            moveZ = step.z;
            speed = H.SPEED;
          }
        } else {
          this.phase = 'idle';
          const w = this.wander(dt);
          moveX = w.x;
          moveZ = w.z;
          speed = H.WANDER_SPEED;
        }
      }
    }

    // Steer horizontal velocity toward the desired move (ground control), keep knockback.
    if (this.phase !== 'active' || this.attack?.name !== 'lunge') {
      const len = Math.hypot(moveX, moveZ);
      const tx = len > 0 ? (moveX / len) * speed : 0, tz = len > 0 ? (moveZ / len) * speed : 0;
      const k = this.grounded ? 1 - Math.exp(-10 * dt) : 1 - Math.exp(-2 * dt);
      this.vel.x = lerp(this.vel.x, tx, k);
      this.vel.z = lerp(this.vel.z, tz, k);
      if (len > 0) this.faceToward(this.pos.x + moveX, this.pos.z + moveZ, dt, H.TURN_RATE);
    }
    const hit = this.physics(dt, world, true, this.grounded && speed === 0 ? 18 : 0);
    // Blocked while walking: hop up (1-block steps and small ledges).
    if ((hit.hitX || hit.hitZ) && this.grounded && speed > 0) this.vel.y = H.JUMP_VELOCITY;
    this.stride += Math.hypot(this.vel.x, this.vel.z) * dt;
  }

  private chooseAttack(): void {
    const r = this.rng();
    this.comboLeft = 0;
    if (r < H.LUNGE_CHANCE) this.startAttack(H.ATTACKS.lunge);
    else if (r < H.LUNGE_CHANCE + H.HEAVY_CHANCE) this.startAttack(H.ATTACKS.overhead);
    else {
      this.comboLeft = this.rng() < H.COMBO_CHANCE ? 1 : 0;
      this.startAttack(H.ATTACKS.slash);
    }
    this.cooldown = lerp(H.ATTACK_COOLDOWN[0], H.ATTACK_COOLDOWN[1], this.rng());
  }

  /** Direction to move this step along the current path (re-planned periodically). */
  private followPath(dt: number, world: VoxelQuery, player: PlayerView): { x: number; z: number } {
    this.repath -= dt;
    const goal = { x: Math.floor(player.pos.x), y: Math.floor(player.pos.y + 0.01), z: Math.floor(player.pos.z) };
    if (this.repath <= 0 || !this.path) {
      this.repath = ENEMIES.REPATH_INTERVAL * (0.8 + this.rng() * 0.4);
      const start = { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y + 0.01), z: Math.floor(this.pos.z) };
      this.path = findPath(world, start, goal);
    }
    const p = this.path;
    if (!p || p.length === 0) return { x: player.pos.x - this.pos.x, z: player.pos.z - this.pos.z };
    // Drop waypoints we've reached.
    while (p.length > 0 && Math.hypot(p[0].x + 0.5 - this.pos.x, p[0].z + 0.5 - this.pos.z) < 0.45 && Math.abs(p[0].y - this.pos.y) < 1.2) p.shift();
    if (p.length === 0) return { x: player.pos.x - this.pos.x, z: player.pos.z - this.pos.z };
    const next = p[0];
    // Jump up to a higher waypoint or across a gap.
    const gap = Math.hypot(next.x + 0.5 - this.pos.x, next.z + 0.5 - this.pos.z) > 1.6;
    if (this.grounded && (next.y > Math.floor(this.pos.y + 0.01) || gap)) this.vel.y = H.JUMP_VELOCITY;
    return { x: next.x + 0.5 - this.pos.x, z: next.z + 0.5 - this.pos.z };
  }

  private wander(dt: number): { x: number; z: number } {
    this.cooldown -= dt;
    if (!this.wanderTarget || this.cooldown < -4) {
      this.cooldown = 0;
      const a = this.rng() * Math.PI * 2;
      this.wanderTarget = this.rng() < 0.4 ? null : { x: this.pos.x + Math.cos(a) * 6, z: this.pos.z + Math.sin(a) * 6 };
      if (!this.wanderTarget) return { x: 0, z: 0 };
    }
    const t = this.wanderTarget;
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    if (Math.hypot(dx, dz) < 0.6) {
      this.wanderTarget = null;
      return { x: 0, z: 0 };
    }
    return { x: dx, z: dz };
  }
}
