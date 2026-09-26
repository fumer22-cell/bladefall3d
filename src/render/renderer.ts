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
import { PixelPipeline } from './pixelPipeline';
import { Sky } from './sky';

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly pixels: PixelPipeline;
  readonly sky: Sky;

  constructor(container: HTMLElement) {
    this.gl = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // The pixel pipeline renders at low resolution anyway; a 1:1 canvas keeps the upscale crisp.
    this.gl.setPixelRatio(1);
    this.gl.setSize(window.innerWidth, window.innerHeight);
    this.gl.domElement.style.imageRendering = 'pixelated';
    this.pixels = new PixelPipeline(this.gl);
    this.pixels.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.gl.domElement);

    this.scene.background = new Color(WORLD.SKY_COLOR);
    this.scene.fog = new FogExp2(WORLD.SKY_COLOR, WORLD.FOG_DENSITY);
    // Lights for box-model entities (voxels use their own shader).
    this.scene.add(new HemisphereLight(0x9a8fb8, 0x3b2717, 1.7));
    const sun = new DirectionalLight(0xffd9a0, 1.9);
    sun.position.set(-0.6, 0.5, -0.8);
    this.scene.add(sun);
    this.gl.autoClear = false;
    this.sky = new Sky(this.scene);
    this.camera = new PerspectiveCamera(CAMERA.BASE_FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.camera.rotation.order = 'YXZ';

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.gl.setSize(window.innerWidth, window.innerHeight);
      this.pixels.setSize(window.innerWidth, window.innerHeight);
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

  /** Render the world, then `overlay` (the first-person viewmodel) on top, through the pixel-art pass. */
  render(overlay?: Scene): void {
    this.pixels.render(this.scene, this.camera, overlay);
  }

}
