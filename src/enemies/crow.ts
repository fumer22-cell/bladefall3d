import { ENEMIES } from '../config';
import { lerp } from '../core/math';
import type { PlayerView } from '../combat/combatant';
import type { VoxelQuery } from '../world/world';
import { EnemyBase } from './enemyBase';

const C = ENEMIES.CROW;

/**
 * Carrion Crow: neutral until provoked. It drifts high over the land; hit it (or one of its flock)
 * and it circles above the player spitting parryable orbs (perfect-parry them back for double
 * damage), sometimes diving in for a quick peck. When its posture breaks it drops out of the sky
 * and can be finished with a deathblow. It loses interest if you get far enough away.
 */
export class Crow extends EnemyBase {
  readonly kind = 'crow';
  private angle: number;
  private spitTimer: number;
  private aggro = false;
  /** Wing flap phase for the view. */
  flap = 0;

  constructor(x: number, y: number, z: number, rng: () => number = Math.random) {
    super(x, y, z, C.HEALTH, C.POSTURE, C.WIDTH, C.HEIGHT, rng);
    this.angle = rng() * Math.PI * 2;
    this.spitTimer = lerp(C.SPIT_COOLDOWN[0], C.SPIT_COOLDOWN[1], rng());
  }

  protected recoilTime(): number {
    return C.PARRIED_RECOIL;
  }

  protected lootTable() {
    return C.LOOT;
  }

  /** Falls out of the sky when posture breaks. */
  protected stagger(): void {
    super.stagger();
    this.vel.set(this.vel.x * 0.3, -2, this.vel.z * 0.3);
  }

  protected think(dt: number, world: VoxelQuery, player: PlayerView): void {
    this.flap += dt * (this.phase === 'dive' ? 22 : 12);
    const px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    const dist = Math.hypot(px - this.pos.x, pz - this.pos.z);
    if (this.events.some((e) => e.type === 'aggro')) this.aggro = true;
    if (this.aggro && dist > C.AGGRO_RANGE * 1.6) this.aggro = false;

    let tx = this.pos.x, ty = this.pos.y, tz = this.pos.z;
    let speed: number = C.SPEED;
    switch (this.phase) {
      case 'dive': {
        // Swoop at the player's chest; start the peck when close.
        tx = px;
        ty = py + 1.1;
        tz = pz;
        speed = C.DIVE_SPEED;
        if (Math.hypot(px - this.pos.x, py + 1.1 - this.pos.y, pz - this.pos.z) < 2.2) this.startAttack(C.ATTACKS.peck);
        else if (this.t > 2.5) this.setPhase('climb', 0);
        break;
      }
      case 'windup':
      case 'active':
      case 'recovery':
        tx = px;
        ty = py + 1.1;
        tz = pz;
        speed = this.phase === 'windup' ? 2 : 1;
        if (!this.runAttack()) this.setPhase('climb', 0);
        break;
      case 'climb':
        ty = py + C.ALTITUDE;
        if (this.pos.y > py + C.ALTITUDE - 1.5 || this.t > 2.5) this.toIdle();
        break;
      case 'recoil':
        ty = this.pos.y + 2;
        speed = 3;
        if (this.t >= this.phaseLen) this.setPhase('climb', 0);
        break;
      case 'shootWindup':
        speed = 2;
        tx = this.pos.x;
        tz = this.pos.z;
        if (this.t >= this.phaseLen) {
          this.events.push({ type: 'shoot' });
          this.toIdle();
        }
        break;
      default: {
        if (!this.aggro) {
          // Lazy drift.
          this.angle += dt * 0.3;
          tx = this.pos.x + Math.cos(this.angle) * 4;
          tz = this.pos.z + Math.sin(this.angle) * 4;
          ty = this.pos.y;
          speed = C.SPEED * 0.4;
          break;
        }
        // Orbit the player.
        this.angle += (C.SPEED / C.ORBIT_RADIUS) * dt * 0.7;
        tx = px + Math.cos(this.angle) * C.ORBIT_RADIUS;
        tz = pz + Math.sin(this.angle) * C.ORBIT_RADIUS;
        ty = py + C.ALTITUDE + Math.sin(this.angle * 2) * 1.5;
        this.spitTimer -= dt;
        if (this.spitTimer <= 0) {
          this.spitTimer = lerp(C.SPIT_COOLDOWN[0], C.SPIT_COOLDOWN[1], this.rng());
          if (this.rng() < C.DIVE_CHANCE) this.setPhase('dive', 0);
          else if (this.canSee(world, player)) {
            this.setPhase('shootWindup', C.SPIT_WINDUP);
            this.events.push({ type: 'telegraph', unblockable: false });
          }
        }
      }
    }

    // Steer toward the target point; flap upward away from terrain.
    const dx = tx - this.pos.x, dy = ty - this.pos.y, dz = tz - this.pos.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const k = 1 - Math.exp(-4 * dt);
    this.vel.x = lerp(this.vel.x, (dx / len) * speed * Math.min(1, len / 2), k);
    this.vel.y = lerp(this.vel.y, (dy / len) * speed * Math.min(1, len / 2), k);
    this.vel.z = lerp(this.vel.z, (dz / len) * speed * Math.min(1, len / 2), k);
    const ahead = (s: number) => world.isSolid(Math.floor(this.pos.x + this.vel.x * s), Math.floor(this.pos.y + this.vel.y * s), Math.floor(this.pos.z + this.vel.z * s));
    if (this.phase !== 'dive' && (ahead(0.4) || world.isSolid(Math.floor(this.pos.x), Math.floor(this.pos.y - 1.5), Math.floor(this.pos.z)))) this.vel.y += 30 * dt;
    this.faceToward(this.phase === 'idle' || this.phase === 'climb' ? this.pos.x + this.vel.x : px, this.phase === 'idle' || this.phase === 'climb' ? this.pos.z + this.vel.z : pz, dt, C.TURN_RATE);
    this.physics(dt, world, false);
  }

  get provoked(): boolean {
    return this.aggro;
  }

  /** Another crow of the flock was attacked. */
  provoke(): void {
    if (this.aggro || !this.alive) return;
    this.aggro = true;
    this.events.push({ type: 'aggro' });
  }

  private canSee(world: VoxelQuery, player: PlayerView): boolean {
    const from = this.center();
    const tx = player.pos.x, ty = player.pos.y + 1.4, tz = player.pos.z;
    const d = Math.hypot(tx - from.x, ty - from.y, tz - from.z);
    for (let s = 1; s < d; s += 0.5) {
      const k = s / d;
      if (world.isSolid(Math.floor(from.x + (tx - from.x) * k), Math.floor(from.y + (ty - from.y) * k), Math.floor(from.z + (tz - from.z) * k))) return false;
    }
    return true;
  }

  protected recoverFromStagger(): void {
    super.recoverFromStagger();
    this.setPhase('climb', 0);
  }
}
