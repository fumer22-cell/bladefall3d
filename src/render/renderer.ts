import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { CAMERA, WORLD } from '../config';

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  constructor(container: HTMLElement) {
    this.gl = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.gl.domElement);

    this.scene.background = new Color(WORLD.SKY_COLOR);
    this.scene.fog = new FogExp2(WORLD.SKY_COLOR, WORLD.FOG_DENSITY);
    // Lights for box-model entities (voxels use their own shader).
    this.scene.add(new HemisphereLight(0xdfe8ff, 0x4a3f2e, 1.8));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);
    this.gl.autoClear = false;
    this.camera = new PerspectiveCamera(CAMERA.BASE_FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.camera.rotation.order = 'YXZ';

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.gl.setSize(window.innerWidth, window.innerHeight);
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** Set sky (clear color) and entity fog color from raw sRGB components. */
  setSkyColor(r: number, g: number, b: number): void {
    (this.scene.background as Color).setRGB(r, g, b, SRGBColorSpace);
    this.scene.fog?.color.setRGB(r, g, b, SRGBColorSpace);
  }

  /** Render the world, then `overlay` (the first-person viewmodel) on top with a fresh depth buffer. */
  render(overlay?: Scene): void {
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (overlay) {
      this.gl.clearDepth();
      this.gl.render(overlay, this.camera);
    }
  }
}
