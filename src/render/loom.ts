import { Vector3, Vector4, type Material, type Object3D } from 'three';
import { LOOM } from '../config';

/**
 * The looming warp, shared by every material that draws in the world.
 * uLoom = (boundary, softness, strength, height boost); uCam = camera position.
 */
export const loomUniforms = {
  uLoom: { value: new Vector4(LOOM.BOUNDARY, LOOM.SOFTNESS, LOOM.ENABLED ? 1 : 0, LOOM.HEIGHT_BOOST) },
  uCam: { value: new Vector3() },
};

/**
 * GLSL: declarations + `vec3 loomWarp(vec3 worldPos)`: horizontal distance compressed past the
 * boundary; above eye level, height stretched by up to 1 + boost as things get far.
 */
export const LOOM_GLSL = /* glsl */ `
  uniform vec4 uLoom;
  uniform vec3 uCam;
  float loomF(float r) {
    float D = uLoom.x, S = uLoom.y;
    if (r <= D) return r;
    return D + S * log(1.0 + (r - D) / S);
  }
  vec3 loomWarp(vec3 w) {
    vec2 off = w.xz - uCam.xz;
    float r = length(off);
    float k = r > 0.001 ? mix(1.0, loomF(r) / r, uLoom.z) : 1.0;
    // How deep into the warp (0 at the boundary → 1 far away): 1 − the compression's slope.
    float amt = r <= uLoom.x ? 0.0 : uLoom.z * (1.0 - uLoom.y / (uLoom.y + r - uLoom.x));
    float dy = w.y - uCam.y;
    // Above the eye: stretched upward so far cliffs tower. Below it: scaled with the horizontal
    // pull so everything keeps its true angle below the horizon and vistas aren't swallowed.
    float y = uCam.y + (dy > 0.0 ? dy * (1.0 + uLoom.w * amt) : dy * k);
    return vec3(uCam.x + off.x * k, y, uCam.z + off.y * k);
  }
`;

/** Same warp on the CPU (tests, HUD markers). */
export function loomWarpDistance(r: number, strength = loomUniforms.uLoom.value.z): number {
  const D = loomUniforms.uLoom.value.x, S = loomUniforms.uLoom.value.y;
  const f = r <= D ? r : D + S * Math.log(1 + (r - D) / S);
  return r + (f - r) * strength;
}

const PROJECT = /* glsl */ `
  vec4 loomW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    loomW = instanceMatrix * loomW;
  #endif
  loomW = modelMatrix * loomW;
  vec4 mvPosition = viewMatrix * vec4(loomWarp(loomW.xyz), 1.0);
  gl_Position = projectionMatrix * mvPosition;
`;

/** Patch a built-in three.js material so its vertices go through the warp. */
export function patchLoom(mat: Material): void {
  if (mat.userData.loom) return;
  mat.userData.loom = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, loomUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + LOOM_GLSL)
      .replace('#include <project_vertex>', PROJECT);
  };
  mat.needsUpdate = true;
}

/**
 * Patch every built-in material under `root` (entities, drops, particles...). Custom shader
 * materials handle the warp themselves. Warped objects can appear where the camera frustum
 * wouldn't expect them, so their frustum culling is turned off (they're few and small).
 */
export function patchTree(root: Object3D): void {
  root.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material;
    if (!m || o.userData.noLoom) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if ((mat as { isShaderMaterial?: boolean }).isShaderMaterial) continue;
      patchLoom(mat);
      o.frustumCulled = false;
    }
  });
}
