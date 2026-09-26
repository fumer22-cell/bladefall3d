import { AdditiveBlending, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, SphereGeometry, type Scene } from 'three';
import type { MemoryOrb } from '../survival/memory';

/** The glowing memory left where you died: a slowly turning crystal inside a pulsing halo. */
export class MemoryView {
  private readonly root = new Group();
  private readonly core: Mesh;
  private readonly halo: Mesh;
  private readonly haloMat: MeshBasicMaterial;
  private time = 0;

  constructor(scene: Scene) {
    this.core = new Mesh(new IcosahedronGeometry(0.22, 0), new MeshBasicMaterial({ color: 0xb1eeee }));
    const inner = new Mesh(new IcosahedronGeometry(0.13, 0), new MeshBasicMaterial({ color: 0xffffff }));
    this.core.add(inner);
    this.haloMat = new MeshBasicMaterial({ color: 0x378bab, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false });
    this.halo = new Mesh(new SphereGeometry(0.55, 12, 8), this.haloMat);
    this.root.add(this.core, this.halo);
    this.root.visible = false;
    scene.add(this.root);
  }

  update(orb: MemoryOrb | null, dt: number): void {
    this.root.visible = !!orb;
    if (!orb) return;
    this.time += dt;
    this.root.position.set(orb.x, orb.y + Math.sin(this.time * 1.6) * 0.12, orb.z);
    this.core.rotation.set(this.time * 0.7, this.time * 1.1, 0);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4);
    this.halo.scale.setScalar(0.8 + pulse * 0.35);
    this.haloMat.opacity = 0.3 + pulse * 0.3;
  }
}
