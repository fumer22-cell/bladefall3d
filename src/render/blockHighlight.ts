import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, type Scene } from 'three';
import type { VoxelHit } from '../world/raycast';

/** Outline around the targeted block, darkening as it's mined. */
export class BlockHighlight {
  private readonly outline: LineSegments;
  private readonly crack: Mesh;
  private readonly crackMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });

  constructor(scene: Scene) {
    this.outline = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.004, 1.004, 1.004)),
      new LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8 }),
    );
    this.crack = new Mesh(new BoxGeometry(1.006, 1.006, 1.006), this.crackMat);
    this.outline.visible = this.crack.visible = false;
    scene.add(this.outline, this.crack);
  }

  update(hit: VoxelHit | null, progress: number, visible: boolean): void {
    const show = visible && hit !== null;
    this.outline.visible = show;
    this.crack.visible = show && progress > 0;
    if (!show) return;
    this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crack.position.copy(this.outline.position);
    this.crackMat.opacity = progress * 0.55;
  }
}
