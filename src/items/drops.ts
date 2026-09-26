import { Vector3 } from 'three';
import { INVENTORY } from '../config';
import { moveBox } from '../world/collision';
import type { VoxelQuery } from '../world/world';
import type { Inventory } from './inventory';

export interface ItemDrop {
  readonly pos: Vector3;
  readonly prevPos: Vector3;
  readonly vel: Vector3;
  item: string;
  count: number;
  age: number;
}

const HALF = 0.125;

/** Items lying in the world: they pop out of broken blocks, fall, and fly to the player. */
export class Drops {
  readonly list: ItemDrop[] = [];

  spawn(x: number, y: number, z: number, item: string, count = 1): void {
    this.list.push({
      pos: new Vector3(x, y, z),
      prevPos: new Vector3(x, y, z),
      vel: new Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3),
      item,
      count,
      age: 0,
    });
  }

  /** Returns picked-up items. `target` is the player's chest position. */
  update(dt: number, world: VoxelQuery, target: Vector3, inv: Inventory): { item: string; count: number }[] {
    const picked: { item: string; count: number }[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.prevPos.copy(d.pos);
      d.age += dt;
      const toPlayer = target.clone().sub(d.pos);
      const dist = toPlayer.length();
      // A short delay before pickup so drops visibly pop out first.
      if (d.age > 0.25 && dist < INVENTORY.MAGNET_RADIUS) {
        d.vel.copy(toPlayer.normalize().multiplyScalar(INVENTORY.MAGNET_SPEED));
        d.pos.addScaledVector(d.vel, dt);
        if (dist < INVENTORY.PICKUP_RADIUS) {
          const left = inv.add(d.item, d.count);
          if (left < d.count) picked.push({ item: d.item, count: d.count - left });
          d.count = left;
          if (left === 0) {
            this.list.splice(i, 1);
            continue;
          }
        }
      } else {
        d.vel.y -= 20 * dt;
        d.vel.x *= Math.max(0, 1 - 4 * dt);
        d.vel.z *= Math.max(0, 1 - 4 * dt);
        const box = {
          minX: d.pos.x - HALF, minY: d.pos.y - HALF, minZ: d.pos.z - HALF,
          maxX: d.pos.x + HALF, maxY: d.pos.y + HALF, maxZ: d.pos.z + HALF,
        };
        const hit = moveBox(world, box, d.vel.x * dt, d.vel.y * dt, d.vel.z * dt);
        d.pos.set(box.minX + HALF, box.minY + HALF, box.minZ + HALF);
        if (hit.hitY) d.vel.y = 0;
        if (hit.hitX) d.vel.x = 0;
        if (hit.hitZ) d.vel.z = 0;
      }
      if (d.age > INVENTORY.DROP_LIFETIME) this.list.splice(i, 1);
    }
    return picked;
  }
}
