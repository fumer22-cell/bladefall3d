import { AdditiveBlending, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, type Camera, type Scene } from 'three';
import { AMBIENT } from '../config';
import type { VoxelQuery } from '../world/world';

const COLORS = [0xecc865, 0xf6e3a0, 0x66c1d6, 0xb1eeee];

/** Fireflies: tiny glowing motes drifting around the player, pulsing, facing the camera. */
export class Fireflies {
  private readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly seed: Float32Array;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private time = 0;
  private placed = false;

  constructor(scene: Scene, private readonly world: VoxelQuery) {
    const n = AMBIENT.FIREFLIES;
    const mat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(0.09, 0.09), mat, n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, this.c.set(COLORS[i % COLORS.length]));
    scene.add(this.mesh);
    this.pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n).map(() => Math.random() * 100);
  }

  private respawn(i: number, cx: number, cy: number, cz: number): void {
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * AMBIENT.RADIUS;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = cy - 1 + Math.random() * 5;
      if (this.world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z))) continue;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      return;
    }
  }

  update(dt: number, camera: Camera, darkness: number): void {
    this.time += dt;
    const p = camera.position;
    const n = AMBIENT.FIREFLIES;
    if (!this.placed) {
      for (let i = 0; i < n; i++) this.respawn(i, p.x, p.y, p.z);
      this.placed = true;
    }
    const q = camera.quaternion;
    for (let i = 0; i < n; i++) {
      const s = this.seed[i];
      const j = i * 3;
      this.pos[j] += Math.sin(this.time * 0.7 + s) * 0.6 * dt;
      this.pos[j + 1] += Math.sin(this.time * 1.1 + s * 2) * 0.35 * dt;
      this.pos[j + 2] += Math.cos(this.time * 0.6 + s * 3) * 0.6 * dt;
      const dx = this.pos[j] - p.x, dz = this.pos[j + 2] - p.z;
      if (dx * dx + dz * dz > (AMBIENT.RADIUS + 4) ** 2 || this.world.isSolid(Math.floor(this.pos[j]), Math.floor(this.pos[j + 1]), Math.floor(this.pos[j + 2]))) {
        this.respawn(i, p.x, p.y, p.z);
      }
      const pulse = Math.max(0, Math.sin(this.time * 2.2 + s * 5));
      const scale = 0.4 + pulse * (0.8 + darkness * 0.6);
      this.m.makeRotationFromQuaternion(q);
      this.m.scale({ x: scale, y: scale, z: scale } as never);
      this.m.setPosition(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    (this.mesh.material as MeshBasicMaterial).opacity = AMBIENT.MIN_ALPHA + (1 - AMBIENT.MIN_ALPHA) * Math.min(1, 0.5 + darkness);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
