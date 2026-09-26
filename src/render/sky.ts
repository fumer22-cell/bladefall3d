import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Scene } from 'three';
import { SKY } from '../config';
import { DEG } from '../core/math';
import { RAMPS, hexToRgb } from './palette';

const dir = (elev: number, azim: number) =>
  new Vector3(Math.cos(elev * DEG) * Math.sin(azim * DEG), Math.sin(elev * DEG), Math.cos(elev * DEG) * Math.cos(azim * DEG));
const rgb = (hex: string) => hexToRgb(hex).map((v) => v / 255);

type SkyKey = 'cZenith' | 'cHigh' | 'cMid' | 'cLow' | 'cHorizon' | 'cSun' | 'cSunCore' | 'cBelow' | 'cCloudDark' | 'cCloudLit';
type SkyPalette = Record<SkyKey, number[]>;

const S = RAMPS.sky, D = RAMPS.day;
const DUSK: SkyPalette = {
  cZenith: rgb(S[1]), cHigh: rgb(S[2]), cMid: rgb(S[3]), cLow: rgb(S[5]), cHorizon: rgb(S[6]),
  cSun: rgb(S[7]), cSunCore: rgb(S[8]), cBelow: rgb(S[4]), cCloudDark: rgb(RAMPS.heather[3]), cCloudLit: rgb(RAMPS.gold[4]),
};
const DAY: SkyPalette = {
  cZenith: rgb(D[1]), cHigh: rgb(D[2]), cMid: rgb(D[3]), cLow: rgb(D[4]), cHorizon: rgb(D[5]),
  cSun: rgb(RAMPS.gold[6]), cSunCore: rgb(RAMPS.snow[3]), cBelow: rgb(D[3]), cCloudDark: rgb(D[4]), cCloudLit: rgb(RAMPS.snow[3]),
};
const NIGHT: SkyPalette = {
  cZenith: rgb(S[0]), cHigh: rgb(S[0]), cMid: rgb(S[1]), cLow: rgb(S[2]), cHorizon: rgb(S[3]),
  cSun: rgb(S[4]), cSunCore: rgb(S[5]), cBelow: rgb(RAMPS.ink[1]), cCloudDark: rgb(RAMPS.ink[3]), cCloudLit: rgb(RAMPS.heather[2]),
};

/** How much of each sky to show (weights are normalized). */
export interface SkyMix {
  day: number;
  dusk: number;
  night: number;
}

/** Sky dome that follows the camera: day, dusk and night gradients, sun, moon, stars, clouds. */
export class Sky {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;
  readonly sunDir = dir(SKY.SUN_ELEVATION, SKY.SUN_AZIMUTH);

  constructor(scene: Scene) {
    const s = RAMPS.sky;
    this.mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        darken: { value: 0 },
        stars: { value: 1 },
        sunGlow: { value: 1 },
        sunDir: { value: this.sunDir },
        moonDir: { value: dir(SKY.MOON_ELEVATION, SKY.MOON_AZIMUTH) },
        moonSize: { value: SKY.MOON_SIZE },
        cloudSpeed: { value: SKY.CLOUD_SPEED },
        cZenith: { value: rgb(s[1]) },
        cHigh: { value: rgb(s[2]) },
        cMid: { value: rgb(s[3]) },
        cLow: { value: rgb(s[5]) },
        cHorizon: { value: rgb(s[6]) },
        cSun: { value: rgb(s[7]) },
        cSunCore: { value: rgb(s[8]) },
        cBelow: { value: rgb(s[4]) },
        cMoon: { value: rgb(RAMPS.pale[4]) },
        cMoonDark: { value: rgb(RAMPS.pale[2]) },
        cCloudDark: { value: rgb(RAMPS.heather[3]) },
        cCloudLit: { value: rgb(RAMPS.gold[4]) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // always at the far plane
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform float darken;
        uniform float stars;
        uniform float sunGlow;
        uniform vec3 sunDir;
        uniform vec3 moonDir;
        uniform float moonSize;
        uniform float cloudSpeed;
        uniform vec3 cZenith, cHigh, cMid, cLow, cHorizon, cSun, cSunCore, cBelow, cMoon, cMoonDark, cCloudDark, cCloudLit;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; }
          return s;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          float toSun = max(dot(d, sunDir), 0.0);

          // Vertical gradient: violet below, rose/amber horizon, indigo zenith.
          vec3 c = cBelow;
          c = mix(c, cHorizon, smoothstep(-0.12, 0.0, h));
          c = mix(c, cLow, smoothstep(0.02, 0.12, h));
          c = mix(c, cMid, smoothstep(0.1, 0.3, h));
          c = mix(c, cHigh, smoothstep(0.28, 0.55, h));
          c = mix(c, cZenith, smoothstep(0.55, 0.95, h));
          // Warm glow around the setting sun.
          c = mix(c, cSun, pow(toSun, 6.0) * 0.75 * smoothstep(-0.2, 0.1, h) * sunGlow);
          c = mix(c, cSunCore, pow(toSun, 60.0) * sunGlow);
          if (toSun > 0.9994 && sunDir.y > -0.05) c = cSunCore;

          // Stars in the upper sky.
          if (h > 0.18) {
            vec2 g = floor(d.xz / (h + 0.25) * 260.0);
            float r = hash(g);
            if (r > 0.9965) {
              float tw = 0.6 + 0.4 * sin(time * 3.0 + r * 60.0);
              c = mix(c, vec3(0.95, 0.9, 0.8), smoothstep(0.18, 0.4, h) * tw * stars);
            }
          }

          // Moon with craters.
          float m = dot(d, moonDir);
          float md = acos(clamp(m, -1.0, 1.0));
          if (md < moonSize) {
            vec3 right = normalize(cross(moonDir, vec3(0, 1, 0)));
            vec3 up = cross(right, moonDir);
            vec2 local = vec2(dot(d, right), dot(d, up)) / moonSize;
            float crater = fbm(local * 3.0 + 7.0);
            c = mix(cMoon, cMoonDark, smoothstep(0.45, 0.62, crater));
          } else {
            c += cMoon * 0.18 * smoothstep(moonSize * 3.0, moonSize, md);
          }

          // Banded clouds, lit from the sun side.
          if (h > 0.0) {
            vec2 cp = d.xz / (h + 0.12) * 1.3 + vec2(time * cloudSpeed, 0.0);
            float n = fbm(cp * 1.4) + 0.35 * fbm(cp * 4.0 + 3.0);
            float cover = smoothstep(0.62, 0.72, n) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.7, h));
            float lit = clamp(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))) * 0.5 + 0.5, 0.0, 1.0);
            vec3 cloud = mix(cCloudDark, cCloudLit, pow(lit, 3.0) * smoothstep(0.66, 0.8, n));
            c = mix(c, cloud, cover);
          }

          c = mix(c, vec3(0.02, 0.02, 0.035), darken);
          gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        }
      `,
    });
    this.mesh = new Mesh(new SphereGeometry(500, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  /** `darken` fades the sky out underground. */
  update(camPos: Vector3, time: number, darken: number): void {
    this.mesh.position.copy(camPos);
    this.mat.uniforms.time.value = time;
    this.mat.uniforms.darken.value = darken;
  }

  /**
   * Time of day: `sunHeight` is sin(elevation) over a day (0 = sunrise … 0.25 noon, 0.75 midnight
   * as `dayTime`); blends the three palettes by `mix`.
   */
  setTimeOfDay(dayTime: number, mix: SkyMix): void {
    const u = this.mat.uniforms;
    const a = dayTime * Math.PI * 2;
    // The sun rises in the east, arcs across the south and sets in the west.
    const az = SKY.SUN_AZIMUTH * DEG;
    const ex = Math.sin(az), ez = Math.cos(az);
    const sx = -ex * Math.cos(a), sz = -ez * Math.cos(a);
    const sy = Math.sin(a);
    this.sunDir.set(sx + ez * 0.35 * sy, sy * 0.94, sz - ex * 0.35 * sy).normalize();
    (u.moonDir.value as Vector3).set(-this.sunDir.x + 0.25, Math.max(-this.sunDir.y, -0.3) + 0.12, -this.sunDir.z).normalize();
    const sum = mix.day + mix.dusk + mix.night || 1;
    const wd = mix.day / sum, wk = mix.dusk / sum, wn = mix.night / sum;
    for (const k of Object.keys(DUSK) as SkyKey[]) {
      const out = u[k].value as number[];
      for (let i = 0; i < 3; i++) out[i] = DAY[k][i] * wd + DUSK[k][i] * wk + NIGHT[k][i] * wn;
    }
    u.stars.value = Math.min(1, wn * 1.4 + wk * 0.35);
    u.sunGlow.value = 1 - wn * 0.9;
  }
}
