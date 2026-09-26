import type { VoxelQuery } from './world';

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

const EPS = 1e-5;
/** Largest per-axis move handled in one sweep; bigger moves are sub-stepped to avoid tunneling. */
const MAX_SUBSTEP = 0.45;

export function boxOverlapsSolid(world: VoxelQuery, b: AABB): boolean {
  const x0 = Math.floor(b.minX + EPS), x1 = Math.floor(b.maxX - EPS);
  const y0 = Math.floor(b.minY + EPS), y1 = Math.floor(b.maxY - EPS);
  const z0 = Math.floor(b.minZ + EPS), z1 = Math.floor(b.maxZ - EPS);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) if (world.isSolid(x, y, z)) return true;
  return false;
}

type Axis = 0 | 1 | 2;

function slabSolid(world: VoxelQuery, axis: Axis, c: number, b: AABB): boolean {
  // Check every voxel in layer `c` along `axis` that overlaps the box's cross-section.
  if (axis === 0) {
    const y0 = Math.floor(b.minY + EPS), y1 = Math.floor(b.maxY - EPS);
    const z0 = Math.floor(b.minZ + EPS), z1 = Math.floor(b.maxZ - EPS);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (world.isSolid(c, y, z)) return true;
  } else if (axis === 1) {
    const x0 = Math.floor(b.minX + EPS), x1 = Math.floor(b.maxX - EPS);
    const z0 = Math.floor(b.minZ + EPS), z1 = Math.floor(b.maxZ - EPS);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (world.isSolid(x, c, z)) return true;
  } else {
    const x0 = Math.floor(b.minX + EPS), x1 = Math.floor(b.maxX - EPS);
    const y0 = Math.floor(b.minY + EPS), y1 = Math.floor(b.maxY - EPS);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.isSolid(x, y, c)) return true;
  }
  return false;
}

function getMin(b: AABB, axis: Axis): number {
  return axis === 0 ? b.minX : axis === 1 ? b.minY : b.minZ;
}
function getMax(b: AABB, axis: Axis): number {
  return axis === 0 ? b.maxX : axis === 1 ? b.maxY : b.maxZ;
}
function shift(b: AABB, axis: Axis, d: number): void {
  if (axis === 0) { b.minX += d; b.maxX += d; }
  else if (axis === 1) { b.minY += d; b.maxY += d; }
  else { b.minZ += d; b.maxZ += d; }
}

/** Move `b` along one axis by up to `delta`, stopping at the first solid voxel. Returns the distance moved. */
export function sweepAxis(world: VoxelQuery, b: AABB, axis: Axis, delta: number): number {
  if (delta === 0) return 0;
  let allowed = delta;
  if (delta > 0) {
    const edge = getMax(b, axis);
    const start = Math.ceil(edge - EPS);
    const end = Math.floor(edge + delta - EPS);
    for (let c = start; c <= end; c++) {
      if (slabSolid(world, axis, c, b)) {
        allowed = Math.max(0, c - edge);
        break;
      }
    }
  } else {
    const edge = getMin(b, axis);
    const start = Math.floor(edge + EPS) - 1;
    const end = Math.floor(edge + delta + EPS);
    for (let c = start; c >= end; c--) {
      if (slabSolid(world, axis, c, b)) {
        allowed = Math.min(0, c + 1 - edge);
        break;
      }
    }
  }
  shift(b, axis, allowed);
  return allowed;
}

export interface MoveResult {
  hitX: boolean;
  hitY: boolean;
  hitZ: boolean;
}

/** Move a box through the voxel world, resolving Y first, then X, then Z. Mutates `b`. */
export function moveBox(world: VoxelQuery, b: AABB, dx: number, dy: number, dz: number): MoveResult {
  const res: MoveResult = { hitX: false, hitY: false, hitZ: false };
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / MAX_SUBSTEP));
  const sx = dx / n, sy = dy / n, sz = dz / n;
  for (let i = 0; i < n; i++) {
    if (!res.hitY && sy !== 0 && Math.abs(sweepAxis(world, b, 1, sy) - sy) > 1e-9) res.hitY = true;
    if (!res.hitX && sx !== 0 && Math.abs(sweepAxis(world, b, 0, sx) - sx) > 1e-9) res.hitX = true;
    if (!res.hitZ && sz !== 0 && Math.abs(sweepAxis(world, b, 2, sz) - sz) > 1e-9) res.hitZ = true;
  }
  return res;
}
