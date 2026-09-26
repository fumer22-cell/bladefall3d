import { ShaderMaterial, type Texture } from 'three';
import { LIGHT, WORLD } from '../config';
import { ATLAS_TILES, TILE_PX } from '../world/tiles';

function hexToVec(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/**
 * Voxel material: pixel-exact atlas textures (fading to each tile's average color in the
 * distance so they don't shimmer), baked sky + block light with a warm torch tint, ambient
 * occlusion, directional face shading and exp² fog. Colors are written as raw sRGB.
 */
export function createVoxelMaterial(atlas: Texture, atlasAvg: Texture, water = false): ShaderMaterial {
  return new ShaderMaterial({
    transparent: water,
    depthWrite: !water,
    uniforms: {
      atlas: { value: atlas },
      atlasAvg: { value: atlasAvg },
      fogColor: { value: hexToVec(WORLD.SKY_COLOR) },
      fogDensity: { value: WORLD.FOG_DENSITY },
      daylight: { value: LIGHT.DAYLIGHT },
      minBright: { value: LIGHT.MIN_BRIGHTNESS },
      falloff: { value: LIGHT.FALLOFF },
      torchTint: { value: LIGHT.TORCH_TINT },
      skyTint: { value: LIGHT.SKY_TINT },
      aoLevels: { value: LIGHT.AO },
      alpha: { value: water ? 0.8 : 1 },
      faceShade: { value: WORLD.FACE_SHADE },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec2 aLight;
      attribute float aAO;
      attribute vec2 aUV;
      attribute float aTile;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec2 vLight;
      varying float vAO;
      varying vec2 vUV;
      varying float vTile;
      varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormal = normal;
        vColor = aColor;
        vLight = aLight;
        vAO = aAO;
        vUV = aUV;
        vTile = aTile;
        vec4 mv = viewMatrix * wp;
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D atlas;
      uniform sampler2D atlasAvg;
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform float daylight;
      uniform float minBright;
      uniform float falloff;
      uniform vec3 torchTint;
      uniform vec3 skyTint;
      uniform float aoLevels[4];
      uniform float alpha;
      uniform float faceShade[4];
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec2 vLight;
      varying float vAO;
      varying vec2 vUV;
      varying float vTile;
      varying float vDist;

      const float TILES = ${ATLAS_TILES.toFixed(1)};
      const float TPX = ${TILE_PX.toFixed(1)};

      float bright(float level) {
        return level <= 0.0 ? 0.0 : pow(falloff, 15.0 - level * 15.0);
      }

      void main() {
        vec3 base = vColor;
        if (vTile >= 0.0) {
          float t = floor(vTile + 0.5);
          vec2 tileXY = vec2(mod(t, TILES), floor(t / TILES));
          vec2 texel = floor(fract(vUV) * TPX);
          vec4 s = texture2D(atlas, (tileXY * TPX + texel + 0.5) / (TILES * TPX));
          if (s.a < 0.5) discard;
          vec4 avg = texture2D(atlasAvg, (tileXY + 0.5) / TILES);
          // When a texel covers less than a screen pixel, blend to the tile's average color.
          float footprint = max(length(dFdx(vUV)), length(dFdy(vUV))) * TPX;
          base = mix(s.rgb, avg.rgb, clamp(footprint - 0.8, 0.0, 1.0) * avg.a);
        }

        vec3 n = vNormal;
        float shade = n.y > 0.5 ? faceShade[0] : (n.y < -0.5 ? faceShade[1] : (abs(n.x) > 0.5 ? faceShade[2] : faceShade[3]));
        float sky = bright(vLight.x) * daylight;
        float blk = bright(vLight.y);
        vec3 light = max(skyTint * sky, torchTint * blk);
        light = max(light, vec3(minBright));
        float a = clamp(vAO, 0.0, 3.0);
        float ao = a < 1.0 ? mix(aoLevels[0], aoLevels[1], a)
          : a < 2.0 ? mix(aoLevels[1], aoLevels[2], a - 1.0)
          : mix(aoLevels[2], aoLevels[3], a - 2.0);

        vec3 col = base * shade * light * ao;
        float fog = 1.0 - exp(-fogDensity * fogDensity * vDist * vDist);
        vec3 outc = mix(col, fogColor, fog);
        // Work in sRGB, output linear (the pixel pipeline's target is linear).
        gl_FragColor = vec4(pow(max(outc, vec3(0.0)), vec3(2.2)), alpha);
      }
    `,
  });
}

/** Set fog color from raw sRGB components (the shader writes sRGB directly). */
export function setFogColor(mats: ShaderMaterial[], r: number, g: number, b: number): void {
  for (const m of mats) m.uniforms.fogColor.value = [r, g, b];
}
