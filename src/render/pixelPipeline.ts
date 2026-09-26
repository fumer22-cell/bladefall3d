import {
  DataTexture,
  DepthTexture,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  HalfFloatType,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { PIXEL } from '../config';
import { PALETTE } from './palette';

const LUT_N = 32;

/** 3D lookup (32³, laid out as 1024×32) from any color to its nearest palette color. */
function buildPaletteLut(): DataTexture {
  const data = new Uint8Array(LUT_N * LUT_N * LUT_N * 4);
  for (let b = 0; b < LUT_N; b++)
    for (let g = 0; g < LUT_N; g++)
      for (let r = 0; r < LUT_N; r++) {
        const R = (r / (LUT_N - 1)) * 255, G = (g / (LUT_N - 1)) * 255, B = (b / (LUT_N - 1)) * 255;
        let best = 0, bestD = Infinity;
        for (let i = 0; i < PALETTE.length; i++) {
          const [pr, pg, pb] = PALETTE[i];
          // "Redmean" weighted distance: cheap and much closer to perception than plain RGB.
          const rm = (R + pr) / 2;
          const dr = R - pr, dg = G - pg, db = B - pb;
          const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        const o = ((g * LUT_N * LUT_N) + b * LUT_N + r) * 4;
        data[o] = PALETTE[best][0];
        data[o + 1] = PALETTE[best][1];
        data[o + 2] = PALETTE[best][2];
        data[o + 3] = 255;
      }
  const tex = new DataTexture(data, LUT_N * LUT_N, LUT_N, RGBAFormat, UnsignedByteType);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Renders the world at low resolution, then upscales with hard pixels while applying ink
 * outlines at depth edges, a cool-shadow/warm-highlight grade, a vignette and palette snapping
 * with 4×4 ordered dithering.
 */
export class PixelPipeline {
  private readonly rt: WebGLRenderTarget;
  private readonly post: Mesh;
  private readonly postScene = new Scene();
  private readonly postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: ShaderMaterial;
  factor = 1;

  constructor(private readonly gl: WebGLRenderer) {
    // Linear, half-float target: three's built-in materials write linear color here, and the
    // voxel/sky shaders convert to linear at the end to match. The post pass encodes to sRGB.
    this.rt = new WebGLRenderTarget(1, 1, { depthBuffer: true, type: HalfFloatType });
    this.rt.texture.magFilter = this.rt.texture.minFilter = NearestFilter;
    this.rt.texture.generateMipmaps = false;
    this.rt.depthTexture = new DepthTexture(1, 1);

    this.mat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        tLut: { value: buildPaletteLut() },
        factor: { value: 1 },
        near: { value: 0.05 },
        far: { value: 600 },
        paletteStrength: { value: PIXEL.PALETTE_STRENGTH },
        dither: { value: PIXEL.DITHER },
        outline: { value: PIXEL.OUTLINE },
        outlineThreshold: { value: PIXEL.OUTLINE_THRESHOLD },
        vignette: { value: PIXEL.VIGNETTE },
        grade: { value: PIXEL.GRADE },
        screen: { value: [1, 1] },
      },
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform sampler2D tLut;
        uniform float factor;
        uniform float near;
        uniform float far;
        uniform float paletteStrength;
        uniform float dither;
        uniform float outline;
        uniform float outlineThreshold;
        uniform float vignette;
        uniform float grade;
        uniform vec2 screen;

        float viewZ(ivec2 p) {
          float d = texelFetch(tDepth, p, 0).r;
          return (near * far) / (far - d * (far - near));
        }

        float bayer4(ivec2 p) {
          int x = p.x & 3, y = p.y & 3;
          int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
          return (float(m[y * 4 + x]) + 0.5) / 16.0 - 0.5;
        }

        vec3 lut(vec3 c) {
          vec3 q = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5);
          vec2 uv = vec2((q.r + q.b * 32.0 + 0.5) / 1024.0, (q.g + 0.5) / 32.0);
          return texture2D(tLut, uv).rgb;
        }

        void main() {
          ivec2 size = textureSize(tColor, 0);
          ivec2 p = min(ivec2(gl_FragCoord.xy / factor), size - 1);
          vec3 c = texelFetch(tColor, p, 0).rgb;
          // Linear → sRGB (everything below works in display space, like the palette).
          c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));

          // Ink outline drawn just outside silhouettes: this pixel is far behind a neighbor.
          float z = viewZ(p);
          float edge = 0.0;
          ivec2 offs[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
          for (int i = 0; i < 4; i++) {
            ivec2 q = clamp(p + offs[i], ivec2(0), size - 1);
            float nz = viewZ(q);
            if ((z - nz) / nz > outlineThreshold) edge = 1.0;
          }
          c = mix(c, c * 0.25 + vec3(0.03, 0.025, 0.05), edge * outline);

          // Grade: cool, violet shadows and warm, golden highlights.
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 cool = c * vec3(0.86, 0.9, 1.12) + vec3(0.01, 0.0, 0.025);
          vec3 warm = c * vec3(1.07, 1.0, 0.86);
          c = mix(c, mix(cool, warm, smoothstep(0.18, 0.7, l)), grade);

          // Vignette.
          vec2 uv = gl_FragCoord.xy / screen;
          float v = smoothstep(0.35, 0.95, length(uv - 0.5) * 1.35);
          c *= 1.0 - v * vignette;

          // Palette snap with ordered dithering.
          vec3 snapped = lut(c + bayer4(p) * dither);
          gl_FragColor = vec4(mix(c, snapped, paletteStrength), 1.0);
        }
      `,
    });
    this.post = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.post.frustumCulled = false;
    this.postScene.add(this.post);
  }

  setSize(width: number, height: number): void {
    this.factor = Math.max(1, Math.round(height / PIXEL.TARGET_HEIGHT));
    const w = Math.ceil(width / this.factor), h = Math.ceil(height / this.factor);
    this.rt.setSize(w, h);
    this.mat.uniforms.factor.value = this.factor;
    this.mat.uniforms.screen.value = [width, height];
  }

  get lowResSize(): [number, number] {
    return [this.rt.width, this.rt.height];
  }

  render(scene: Scene, camera: PerspectiveCamera, overlay?: Scene): void {
    const gl = this.gl;
    this.mat.uniforms.near.value = camera.near;
    this.mat.uniforms.far.value = camera.far;
    gl.setRenderTarget(this.rt);
    gl.clear();
    gl.render(scene, camera);
    if (overlay) {
      gl.clearDepth();
      gl.render(overlay, camera);
    }
    gl.setRenderTarget(null);
    gl.clear();
    gl.render(this.postScene, this.postCam);
  }
}
