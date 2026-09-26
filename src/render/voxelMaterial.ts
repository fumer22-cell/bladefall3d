import { ShaderMaterial } from 'three';
import { WORLD } from '../config';

function hexToVec(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/**
 * Flat-color voxel material: per-face directional shading, subtle per-block brightness jitter,
 * anti-aliased block grid lines (so greedy-merged quads still read as blocks), exp² fog.
 */
export function createVoxelMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      fogColor: { value: hexToVec(WORLD.SKY_COLOR) },
      fogDensity: { value: WORLD.FOG_DENSITY },
      gridStrength: { value: WORLD.GRID_LINE_STRENGTH },
      jitter: { value: WORLD.BLOCK_COLOR_JITTER },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normal;
        vColor = aColor;
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
      varying vec3 vColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDist;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      void main() {
        vec3 n = vNormal;
        vec3 cell = floor(vWorld - n * 0.5);
        float j = (hash(cell) - 0.5) * 2.0 * jitter;
        float shade = n.y > 0.5 ? 1.0 : (n.y < -0.5 ? 0.55 : (abs(n.x) > 0.5 ? 0.82 : 0.68));
        vec2 uv = abs(n.x) > 0.5 ? vWorld.yz : (abs(n.y) > 0.5 ? vWorld.xz : vWorld.xy);
        vec2 g = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec3 col = vColor * shade * (1.0 + j) * (1.0 - line * gridStrength);
        float fog = 1.0 - exp(-fogDensity * fogDensity * vDist * vDist);
        gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
      }
    `,
  });
}
