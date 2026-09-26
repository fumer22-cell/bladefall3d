export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential approach: move `current` toward `target` at `rate` (1/s). */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/** Move a 2D vector toward a target vector by at most maxDelta (length). Mutates and returns `out`. */
export function moveToward2(
  out: { x: number; z: number },
  tx: number,
  tz: number,
  maxDelta: number,
): { x: number; z: number } {
  const dx = tx - out.x;
  const dz = tz - out.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d === 0) {
    out.x = tx;
    out.z = tz;
  } else {
    out.x += (dx / d) * maxDelta;
    out.z += (dz / d) * maxDelta;
  }
  return out;
}

/** Cheap deterministic 3D integer hash → [0, 1). */
export function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
