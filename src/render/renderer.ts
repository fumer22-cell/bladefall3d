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
  private readonly hemi: HemisphereLight;
  private readonly sun: DirectionalLight;

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
    this.hemi = new HemisphereLight(0x9a8fb8, 0x3b2717, 1.7);
    this.scene.add(this.hemi);
    this.sun = new DirectionalLight(0xffd9a0, 1.9);
    this.sun.position.set(-0.6, 0.5, -0.8);
    this.scene.add(this.sun);
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

  /** Dim and tint the entity lights with the time of day (voxels are lit by their own shader). */
  setDaylight(daylight: number, tint: readonly number[], sunDir: { x: number; y: number; z: number }): void {
    this.hemi.intensity = 0.55 + 1.15 * daylight;
    this.hemi.color.setRGB(0.6 * tint[0], 0.56 * tint[1], 0.72 * tint[2]);
    const up = Math.max(0, sunDir.y);
    this.sun.intensity = 1.9 * Math.min(1, up * 4) * daylight + 0.35 * (1 - daylight);
    // Below the horizon, the "sun" light becomes cool moonlight from above.
    if (sunDir.y > 0) this.sun.position.set(sunDir.x, sunDir.y, sunDir.z);
    else this.sun.position.set(-sunDir.x, 0.8, -sunDir.z);
    this.sun.color.setRGB(tint[0], 0.85 * tint[1], 0.63 * tint[2]);
  }

  /** Render the world, then `overlay` (the first-person viewmodel) on top, through the pixel-art pass. */
  render(overlay?: Scene): void {
    this.pixels.render(this.scene, this.camera, overlay);
  }

}
