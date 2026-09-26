import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, type Scene } from 'three';
import { BUILD } from '../config';
import type { BlockAt } from '../player/harvest';
import { COLOR } from '../world/blocks';

interface Falling {
  mesh: InstancedMesh;
  blocks: BlockAt[];
  pivot: Vector3;
  axis: Vector3;
  t: number;
}

const geo = new BoxGeometry(1, 1, 1);

/**
 * Felled trees: the blocks above the cut become one rigid piece that topples away from the
 * player, hinged at the stump, accelerating like a real fall. When it lands, `update` returns it
 * so the game can burst it into particles and drops.
 */
export class FallingTrees {
  private readonly list: Falling[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly c = new Color();

  constructor(private readonly scene: Scene) {}

  /** `awayX/Z`: horizontal direction to topple toward. */
  add(stump: { x: number; y: number; z: number }, blocks: BlockAt[], awayX: number, awayZ: number): void {
    const mat = new MeshLambertMaterial();
    const mesh = new InstancedMesh(geo, mat, blocks.length);
    mesh.frustumCulled = false;
    blocks.forEach((b, i) => mesh.setColorAt(i, this.c.set(COLOR[b.id])));
    const len = Math.hypot(awayX, awayZ) || 1;
    // Hinge on the stump's top edge on the far side, rotating about the horizontal axis ⟂ to the fall.
    const pivot = new Vector3(stump.x + 0.5 + (awayX / len) * 0.5, stump.y, stump.z + 0.5 + (awayZ / len) * 0.5);
    const axis = new Vector3(awayZ / len, 0, -awayX / len);
    this.scene.add(mesh);
    const f = { mesh, blocks, pivot, axis, t: 0 };
    this.list.push(f);
    this.pose(f, 0);
  }

  private pose(f: Falling, angle: number): void {
    this.q.setFromAxisAngle(f.axis, angle);
    const p = new Vector3();
    f.blocks.forEach((b, i) => {
      p.set(b.x + 0.5, b.y + 0.5, b.z + 0.5).sub(f.pivot).applyQuaternion(this.q).add(f.pivot);
      this.m.compose(p, this.q, new Vector3(1, 1, 1));
      f.mesh.setMatrixAt(i, this.m);
    });
    f.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Where a block of a landed tree ended up. */
  static landed(f: { pivot: Vector3; axis: Vector3 }, b: BlockAt): Vector3 {
    const q = new Quaternion().setFromAxisAngle(f.axis, Math.PI / 2);
    return new Vector3(b.x + 0.5, b.y + 0.5, b.z + 0.5).sub(f.pivot).applyQuaternion(q).add(f.pivot);
  }

  /** Advance; returns trees that just hit the ground (removed from the scene). */
  update(dt: number): { blocks: BlockAt[]; positions: Vector3[] }[] {
    const done: { blocks: BlockAt[]; positions: Vector3[] }[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const k = Math.min(1, f.t / BUILD.TREE_FALL_TIME);
      // Starts slow, then crashes down.
      this.pose(f, (Math.PI / 2) * k * k * k);
      if (k < 1) continue;
      done.push({ blocks: f.blocks, positions: f.blocks.map((b) => FallingTrees.landed(f, b)) });
      this.scene.remove(f.mesh);
      f.mesh.dispose();
      (f.mesh.material as MeshLambertMaterial).dispose();
      this.list.splice(i, 1);
    }
    return done;
  }
}
