import type { VoxelQuery } from './world';

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** Face normal of the hit (the side you'd place against). */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
  id: number;
}

/** Walk voxels along a ray (Amanatides & Woo DDA) until `hits(id)` is true. */
export function raycastVoxel(
  world: VoxelQuery,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  hits: (id: number) => boolean,
): VoxelHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len; dy /= len; dz /= len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;

  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (hits(id)) return { x, y, z, nx, ny, nz, dist: t, id };
    if (tmx < tmy && tmx < tmz) {
      x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0;
    } else if (tmy < tmz) {
      y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0;
    } else {
      z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz;
    }
  }
  return null;
}
