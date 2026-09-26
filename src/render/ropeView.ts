import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, type Camera, type Scene, Vector3 } from 'three';

/** The grappling hook's line, from the player's hand to the anchor, with a little sag while it tightens. */
export class RopeView {
  private readonly line: Line;
  private readonly pos = new Float32Array(9 * 3);
  private readonly hand = new Vector3();

  constructor(scene: Scene) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.line = new Line(geo, new LineBasicMaterial({ color: 0x2b1d17 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
  }

  update(anchor: Vector3 | null, camera: Camera, tension: number): void {
    this.line.visible = !!anchor;
    if (!anchor) return;
    // Start just below and to the right of the view.
    this.hand.set(0.35, -0.35, -0.6).applyQuaternion(camera.quaternion).add(camera.position);
    const sag = (1 - Math.min(1, tension)) * 0.8;
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      this.pos[i * 3] = this.hand.x + (anchor.x - this.hand.x) * t;
      this.pos[i * 3 + 1] = this.hand.y + (anchor.y - this.hand.y) * t - Math.sin(t * Math.PI) * sag;
      this.pos[i * 3 + 2] = this.hand.z + (anchor.z - this.hand.z) * t;
    }
    (this.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}
