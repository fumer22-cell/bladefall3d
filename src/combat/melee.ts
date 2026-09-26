import { COMBAT, type AttackDir } from '../config';
import { DEG } from '../core/math';
import type { AABB } from '../world/collision';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Pick a swing direction from mouse movement during windup (screen px; +x right, +y down). */
export function directionFromAim(dx: number, dy: number, fallback: AttackDir): AttackDir {
  if (Math.hypot(dx, dy) < COMBAT.AIM_DIR_THRESHOLD) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'slashR' : 'slashL';
  return dy < 0 ? 'overhead' : 'stab';
}

function closestPoint(b: AABB, p: Vec3Like): Vec3Like {
  return {
    x: Math.max(b.minX, Math.min(p.x, b.maxX)),
    y: Math.max(b.minY, Math.min(p.y, b.maxY)),
    z: Math.max(b.minZ, Math.min(p.z, b.maxZ)),
  };
}

/**
 * Does a melee swing from `eye` looking along (yaw, pitch) hit `box`?
 * Range is measured to the nearest point of the box; angles are measured to the box point
 * nearest the look ray, so big targets are easier to hit (as they should be).
 */
export function swingHits(eye: Vec3Like, yaw: number, pitch: number, dir: AttackDir, reach: number, box: AABB): boolean {
  const d = COMBAT.DIR[dir];
  const near = closestPoint(box, eye);
  const dist = Math.hypot(near.x - eye.x, near.y - eye.y, near.z - eye.z);
  if (dist > reach + d.reachBonus) return false;
  if (dist < 0.05) return true;

  // Aim point: the box point closest to a point `dist` along the look ray.
  const fx = -Math.sin(yaw) * Math.cos(pitch);
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * Math.cos(pitch);
  const aim = closestPoint(box, { x: eye.x + fx * dist, y: eye.y + fy * dist, z: eye.z + fz * dist });
  const tx = aim.x - eye.x, ty = aim.y - eye.y, tz = aim.z - eye.z;

  const targetYaw = Math.atan2(-tx, -tz);
  let dYaw = targetYaw - yaw;
  dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
  const targetPitch = Math.atan2(ty, Math.hypot(tx, tz));
  const dPitch = targetPitch - pitch;
  return Math.abs(dYaw) <= d.arcH * DEG && Math.abs(dPitch) <= d.arcV * DEG;
}

/** Is `target` within `reach` and inside the attacker's horizontal cone? */
export function inCone(
  from: Vec3Like,
  facingYaw: number,
  target: Vec3Like,
  reach: number,
  arcDeg: number,
): boolean {
  const dx = target.x - from.x, dz = target.z - from.z;
  if (Math.hypot(dx, dz) > reach) return false;
  let d = Math.atan2(-dx, -dz) - facingYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) <= arcDeg * DEG;
}
