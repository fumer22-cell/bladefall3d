import { Vector3 } from 'three';
import { PROJECTILE } from '../config';
import type { VoxelQuery } from '../world/world';

export type Faction = 'player' | 'enemy';

export interface Projectile {
  readonly pos: Vector3;
  readonly prevPos: Vector3;
  readonly vel: Vector3;
  faction: Faction;
  damage: number;
  posture: number;
  life: number;
  reflected: boolean;
  dead: boolean;
}

export class Projectiles {
  readonly list: Projectile[] = [];

  spawn(pos: Vector3, dir: Vector3, faction: Faction): Projectile {
    const p: Projectile = {
      pos: pos.clone(),
      prevPos: pos.clone(),
      vel: dir.clone().normalize().multiplyScalar(PROJECTILE.SPEED),
      faction,
      damage: PROJECTILE.DAMAGE,
      posture: PROJECTILE.POSTURE,
      life: PROJECTILE.LIFETIME,
      reflected: false,
      dead: false,
    };
    this.list.push(p);
    return p;
  }

  /** Send a projectile back along `dir` as the player's. */
  reflect(p: Projectile, dir: Vector3): void {
    const speed = p.vel.length() * PROJECTILE.REFLECT_SPEED_MULT;
    p.vel.copy(dir).normalize().multiplyScalar(speed);
    p.faction = 'player';
    p.damage *= PROJECTILE.REFLECT_DAMAGE_MULT;
    p.posture *= PROJECTILE.REFLECT_DAMAGE_MULT;
    p.reflected = true;
    p.life = PROJECTILE.LIFETIME;
  }

  /** Move projectiles; those hitting solid voxels die. Returns ones that hit terrain this step. */
  update(dt: number, world: VoxelQuery): Projectile[] {
    const hitWall: Projectile[] = [];
    for (const p of this.list) {
      p.prevPos.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      p.life -= dt;
      if (world.isSolid(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z))) {
        p.dead = true;
        hitWall.push(p);
      } else if (p.life <= 0) p.dead = true;
    }
    return hitWall;
  }

  sweep(): void {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].dead) this.list.splice(i, 1);
  }
}
