import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { Drops } from '../items/drops';
import { ITEMS } from '../items/items';

const MAX = 512;

/** Dropped items: small spinning, bobbing cubes in the item's color. */
export class DropView {
  private readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly c = new Color();
  private readonly axis = new Vector3(0, 1, 0);
  private readonly p = new Vector3();
  private readonly s = new Vector3(0.25, 0.25, 0.25);
  private time = 0;

  constructor(scene: Scene) {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, this.c.set(0xffffff));
    scene.add(this.mesh);
  }

  update(drops: Drops, alpha: number, dt: number): void {
    this.time += dt;
    const n = Math.min(MAX, drops.list.length);
    for (let i = 0; i < n; i++) {
      const d = drops.list[i];
      this.p.lerpVectors(d.prevPos, d.pos, alpha);
      this.p.y += Math.sin(this.time * 3 + i) * 0.05 + 0.05;
      this.q.setFromAxisAngle(this.axis, this.time * 2 + i);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.set(ITEMS[d.item]?.color ?? 0xffffff));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
