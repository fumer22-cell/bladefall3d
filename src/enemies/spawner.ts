import type { Vector3 } from 'three';
import { ENEMIES } from '../config';
import type { Combatant } from '../combat/combatant';
import { SHAPE } from '../world/blocks';
import type { World } from '../world/world';
import { Crow } from './crow';
import { Husk } from './husk';
import { standable } from './pathfinding';

/**
 * Spawns Husks in darkness (torch light keeps an area safe) and Crows under open sky, in a ring
 * around the player, and despawns enemies that are left far behind.
 */
export class Spawner {
  enabled: boolean = ENEMIES.SPAWN_ENABLED;
  private timer = 2;

  constructor(private readonly rng: () => number = Math.random) {}

  /** Returns enemies to add; marks far-away ones in `despawn`. */
  update(dt: number, world: World, player: Vector3, enemies: Combatant[], despawn: Set<Combatant>): Combatant[] {
    for (const e of enemies) {
      if (e.kind === 'dummy') continue;
      if (Math.hypot(e.pos.x - player.x, e.pos.z - player.z) > ENEMIES.DESPAWN_DIST) despawn.add(e);
    }
    this.timer -= dt;
    if (!this.enabled || this.timer > 0) return [];
    this.timer = ENEMIES.SPAWN_INTERVAL;
    const husks = enemies.filter((e) => e.kind === 'husk' && e.alive).length;
    const crows = enemies.filter((e) => e.kind === 'crow' && e.alive).length;
    const out: Combatant[] = [];
    if (husks < ENEMIES.MAX_HUSKS) {
      const p = this.findSpot(world, player, (x, y, z) => (world.getLight(x, y, z) & 15) <= ENEMIES.HUSK_MAX_BLOCK_LIGHT);
      if (p) out.push(new Husk(p.x + 0.5, p.y, p.z + 0.5, this.rng));
    }
    if (crows < ENEMIES.MAX_CROWS && this.rng() < 0.5) {
      const p = this.findSpot(world, player, (x, y, z) => world.getLight(x, y + 1, z) >> 4 >= ENEMIES.CROW_MIN_SKY_LIGHT);
      if (p && !world.isSolid(p.x, p.y + 8, p.z)) out.push(new Crow(p.x + 0.5, p.y + 8, p.z + 0.5, this.rng));
    }
    return out;
  }

  private findSpot(world: World, player: Vector3, ok: (x: number, y: number, z: number) => boolean): { x: number; y: number; z: number } | null {
    for (let tries = 0; tries < 6; tries++) {
      const a = this.rng() * Math.PI * 2;
      const r = ENEMIES.SPAWN_MIN_DIST + this.rng() * (ENEMIES.SPAWN_MAX_DIST - ENEMIES.SPAWN_MIN_DIST);
      const x = Math.floor(player.x + Math.cos(a) * r), z = Math.floor(player.z + Math.sin(a) * r);
      if (!world.isLoaded(x, z)) continue;
      // Search a vertical band around the player's height (terrain here is very vertical).
      for (let y = Math.floor(player.y) + 16; y > Math.floor(player.y) - 24; y--) {
        if (!standable(world, x, y, z)) continue;
        if (SHAPE[world.getBlock(x, y, z)] === 'water' || SHAPE[world.getBlock(x, y - 1, z)] === 'water') break;
        if (ok(x, y, z)) return { x, y, z };
        break;
      }
    }
    return null;
  }
}
