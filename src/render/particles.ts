import { BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, type Scene } from 'three';
import { PARTICLES } from '../config';
import type { VoxelQuery } from '../world/world';

type V3 = { x: number; y: number; z: number };

export interface BurstOptions {
  count: number;
  color: number;
  /** Second color; each particle picks randomly between the two. */
  color2?: number;
  speed: number;
  /** Seconds. */
  life: number;
  size: number;
  gravity?: number;
  /** Bias direction added to each particle's random velocity (scaled by speed). */
  dir?: V3;
}

/** Pooled instanced-cube particles (blood, sparks, debris). */
export class Particles {
  private readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly stuck: Uint8Array;
  private count = 0;
  private readonly m = new Matrix4();
  private readonly c = new Color();

  constructor(scene: Scene, private readonly world: VoxelQuery) {
    const n = PARTICLES.MAX;
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ fog: true }), n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, this.c.set(0xffffff));
    scene.add(this.mesh);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.stuck = new Uint8Array(n);
  }

  burst(at: V3, o: BurstOptions): void {
    for (let k = 0; k < o.count; k++) {
      if (this.count >= PARTICLES.MAX) return;
      const i = this.count++;
      // Random direction on a sphere.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = o.speed * (0.35 + Math.random() * 0.65);
      const d = o.dir ?? { x: 0, y: 0, z: 0 };
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      this.vel[i * 3] = (r * Math.cos(a) + d.x) * s;
      this.vel[i * 3 + 1] = (u + d.y) * s;
      this.vel[i * 3 + 2] = (r * Math.sin(a) + d.z) * s;
      this.maxLife[i] = this.life[i] = o.life * (0.6 + Math.random() * 0.4);
      this.size[i] = o.size * (0.6 + Math.random() * 0.6);
      this.grav[i] = o.gravity ?? PARTICLES.GRAVITY;
      this.stuck[i] = 0;
      this.mesh.setColorAt(i, this.c.set(o.color2 !== undefined && Math.random() < 0.5 ? o.color2 : o.color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  blood(at: V3, damage: number, dir?: V3): void {
    const count = Math.min(PARTICLES.BLOOD_MAX_BURST, Math.ceil(damage * PARTICLES.BLOOD_PER_DAMAGE) + 6);
    this.burst(at, { count, color: 0xa3081a, color2: 0x6e0410, speed: 6, life: 1.6, size: 0.09, dir });
  }

  sparks(at: V3, count: number): void {
    this.burst(at, { count, color: 0xfff1a8, color2: 0xffb530, speed: 11, life: 0.35, size: 0.045, gravity: 10 });
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const j = i * 3;
      if (!this.stuck[i]) {
        this.vel[j + 1] -= this.grav[i] * dt;
        const nx = this.pos[j] + this.vel[j] * dt;
        const ny = this.pos[j + 1] + this.vel[j + 1] * dt;
        const nz = this.pos[j + 2] + this.vel[j + 2] * dt;
        if (this.world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
          this.stuck[i] = 1; // splat on whatever it hit
        } else {
          this.pos[j] = nx;
          this.pos[j + 1] = ny;
          this.pos[j + 2] = nz;
        }
      }
      const f = this.life[i] / this.maxLife[i];
      const s = this.size[i] * (this.stuck[i] ? 1.3 : Math.min(1, f * 2.5));
      this.m.makeScale(s, this.stuck[i] ? s * 0.25 : s, s);
      this.m.setPosition(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.mesh.setMatrixAt(i, this.m);
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[last * 3 + k];
      this.vel[i * 3 + k] = this.vel[last * 3 + k];
    }
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.grav[i] = this.grav[last];
    this.stuck[i] = this.stuck[last];
    this.mesh.getColorAt(last, this.c);
    this.mesh.setColorAt(i, this.c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
