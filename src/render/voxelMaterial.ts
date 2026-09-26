import { ShaderMaterial } from 'three';
import { LIGHT, WORLD } from '../config';

function hexToVec(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/**
 * Voxel material: baked sky + block light (warm torch tint), ambient occlusion, per-face
 * directional shading, per-block brightness jitter, block grid lines, exp² fog.
 */
export function createVoxelMaterial(water = false): ShaderMaterial {
  return new ShaderMaterial({
    transparent: water,
    depthWrite: !water,
    uniforms: {
      fogColor: { value: hexToVec(WORLD.SKY_COLOR) },
      fogDensity: { value: WORLD.FOG_DENSITY },
      gridStrength: { value: water ? 0 : WORLD.GRID_LINE_STRENGTH },
      jitter: { value: water ? 0 : WORLD.BLOCK_COLOR_JITTER },
      daylight: { value: LIGHT.DAYLIGHT },
      minBright: { value: LIGHT.MIN_BRIGHTNESS },
      falloff: { value: LIGHT.FALLOFF },
      torchTint: { value: LIGHT.TORCH_TINT },
      aoLevels: { value: LIGHT.AO },
      alpha: { value: water ? 0.72 : 1 },
      faceShade: { value: WORLD.FACE_SHADE },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec2 aLight;
      attribute float aAO;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vLight;
      varying float vAO;
      varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normal;
        vColor = aColor;
        vLight = aLight;
        vAO = aAO;
        vec4 mv = viewMatrix * wp;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform float gridStrength;
      uniform float jitter;
      uniform float daylight;
      uniform float minBright;
      uniform float falloff;
      uniform vec3 torchTint;
      uniform float aoLevels[4];
      uniform float alpha;
      uniform float faceShade[4];
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vLight;
      varying float vAO;
      varying float vDist;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float bright(float level) {
        return level <= 0.0 ? 0.0 : pow(falloff, 15.0 - level * 15.0);
      }

      void main() {
        vec3 n = vNormal;
        vec3 cell = floor(vWorld - n * 0.5);
        float j = (hash(cell) - 0.5) * 2.0 * jitter;
        float shade = n.y > 0.5 ? faceShade[0] : (n.y < -0.5 ? faceShade[1] : (abs(n.x) > 0.5 ? faceShade[2] : faceShade[3]));
        vec2 uv = abs(n.x) > 0.5 ? vWorld.yz : (abs(n.y) > 0.5 ? vWorld.xz : vWorld.xy);
        vec2 g = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
        float line = 1.0 - min(min(g.x, g.y), 1.0);

        float sky = bright(vLight.x) * daylight;
        float blk = bright(vLight.y);
        vec3 light = max(vec3(sky), torchTint * blk);
        light = max(light, vec3(minBright));
        float a = clamp(vAO, 0.0, 3.0);
        float ao = a < 1.0 ? mix(aoLevels[0], aoLevels[1], a)
          : a < 2.0 ? mix(aoLevels[1], aoLevels[2], a - 1.0)
          : mix(aoLevels[2], aoLevels[3], a - 2.0);

        vec3 col = vColor * shade * (1.0 + j) * (1.0 - line * gridStrength) * light * ao;
        float fog = 1.0 - exp(-fogDensity * fogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(col, fogColor, fog), alpha);
      }
    `,
  });
}

/** Set fog color from raw sRGB components (the shader writes sRGB directly). */
export function setFogColor(mats: ShaderMaterial[], r: number, g: number, b: number): void {
  for (const m of mats) m.uniforms.fogColor.value = [r, g, b];
}
