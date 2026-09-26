import { Mesh, MeshBasicMaterial, SphereGeometry, type Scene } from 'three';
import { PROJECTILE } from '../config';
import { lerp } from '../core/math';
import type { Projectiles } from '../combat/projectiles';

const geo = new SphereGeometry(PROJECTILE.RADIUS, 10, 8);
const enemyMat = new MeshBasicMaterial({ color: 0xffc42e });
const playerMat = new MeshBasicMaterial({ color: 0x7fe3ff });

export class ProjectileView {
  private readonly pool: Mesh[] = [];

  constructor(private readonly scene: Scene) {}

  update(projectiles: Projectiles, alpha: number): void {
    const list = projectiles.list;
    while (this.pool.length < list.length) {
      const m = new Mesh(geo, enemyMat);
      this.scene.add(m);
      this.pool.push(m);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const m = this.pool[i];
      const p = list[i];
      m.visible = !!p;
      if (!p) continue;
      m.material = p.faction === 'enemy' ? enemyMat : playerMat;
      m.position.set(lerp(p.prevPos.x, p.pos.x, alpha), lerp(p.prevPos.y, p.pos.y, alpha), lerp(p.prevPos.z, p.pos.z, alpha));
      m.scale.setScalar(p.reflected ? 1.3 : 1);
    }
  }
}
