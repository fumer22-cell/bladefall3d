import { EMISSION, LIGHT_ATTEN } from './blocks';
import { CS, WORLD_H, colIndex } from './chunk';

/** Voxel light access. `block` returns -1 outside the addressable area (light never enters it). */
export interface LightAccess {
  block(x: number, y: number, z: number): number;
  light(x: number, y: number, z: number): number;
  setLight(x: number, y: number, z: number, v: number): void;
}

export const SKY = 0;
export const BLK = 1;
export type Channel = typeof SKY | typeof BLK;

export const getCh = (l: number, ch: Channel) => (ch === SKY ? l >> 4 : l & 15);
export const setCh = (l: number, ch: Channel, v: number) => (ch === SKY ? (l & 0x0f) | (v << 4) : (l & 0xf0) | v);

const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0],
] as const;
const DOWN = 5;

/** Light arriving at a neighbor. Full sunlight travels straight down through clear blocks without fading. */
function passed(level: number, att: number, ch: Channel, dir: number): number {
  if (ch === SKY && dir === DOWN && level === 15 && att === 1) return 15;
  return level - att;
}

/** Flood light outward from queued cells (flat x,y,z triples whose levels are already set). */
export function increase(a: LightAccess, queue: number[], ch: Channel): void {
  for (let q = 0; q < queue.length; q += 3) {
    const x = queue[q], y = queue[q + 1], z = queue[q + 2];
    const level = getCh(a.light(x, y, z), ch);
    if (level <= 1) continue;
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      const b = a.block(nx, ny, nz);
      if (b < 0) continue;
      const att = LIGHT_ATTEN[b];
      if (att >= 15) continue;
      const nl = passed(level, att, ch, d);
      if (nl <= 0) continue;
      const cur = a.light(nx, ny, nz);
      if (getCh(cur, ch) >= nl) continue;
      a.setLight(nx, ny, nz, setCh(cur, ch, nl));
      queue.push(nx, ny, nz);
    }
  }
  queue.length = 0;
}

/**
 * Remove light that came from queued cells (flat x,y,z,oldLevel quads; the cells are already
 * zeroed), then re-flood from any brighter light found at the edge of the removed region.
 */
export function decrease(a: LightAccess, queue: number[], ch: Channel): void {
  const relight: number[] = [];
  for (let q = 0; q < queue.length; q += 4) {
    const x = queue[q], y = queue[q + 1], z = queue[q + 2], lvl = queue[q + 3];
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      const b = a.block(nx, ny, nz);
      if (b < 0) continue;
      const cur = a.light(nx, ny, nz);
      const nl = getCh(cur, ch);
      if (nl === 0) continue;
      const fromUs = nl < lvl || (ch === SKY && d === DOWN && lvl === 15 && nl === 15);
      if (fromUs) {
        const em = ch === BLK ? EMISSION[b] : 0;
        a.setLight(nx, ny, nz, setCh(cur, ch, em));
        queue.push(nx, ny, nz, nl);
        if (em > 0) relight.push(nx, ny, nz);
      } else {
        relight.push(nx, ny, nz);
      }
    }
  }
  queue.length = 0;
  increase(a, relight, ch);
}

/** Compute sky + block light for one column in isolation (no neighbors). */
export function computeColumnLight(blocks: Uint16Array, light: Uint8Array): void {
  light.fill(0);
  const access: LightAccess = {
    block: (x, y, z) => (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= WORLD_H ? -1 : blocks[colIndex(x, y, z)]),
    light: (x, y, z) => light[colIndex(x, y, z)],
    setLight: (x, y, z, v) => {
      light[colIndex(x, y, z)] = v;
    },
  };

  // Straight-down sunlight.
  for (let z = 0; z < CS; z++)
    for (let x = 0; x < CS; x++) {
      let level = 15;
      for (let y = WORLD_H - 1; y >= 0 && level > 0; y--) {
        const i = colIndex(x, y, z);
        const att = LIGHT_ATTEN[blocks[i]];
        if (att >= 15) break;
        if (y < WORLD_H - 1) level = passed(level, att, SKY, DOWN);
        if (level <= 0) break;
        light[i] = level << 4;
      }
    }

  // Emitters and sideways sky spread.
  const skyQ: number[] = [];
  const blkQ: number[] = [];
  for (let y = 0; y < WORLD_H; y++)
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const i = colIndex(x, y, z);
        const em = EMISSION[blocks[i]];
        if (em > 0) {
          light[i] = setCh(light[i], BLK, em);
          blkQ.push(x, y, z);
        }
        const s = light[i] >> 4;
        if (s <= 1) continue;
        // Only cells next to something darker need to spread.
        if (
          (x > 0 && light[i - 1] >> 4 < s - 1) || (x < CS - 1 && light[i + 1] >> 4 < s - 1) ||
          (z > 0 && light[i - CS] >> 4 < s - 1) || (z < CS - 1 && light[i + CS] >> 4 < s - 1) ||
          (y > 0 && light[i - CS * CS] >> 4 < s - 1)
        ) skyQ.push(x, y, z);
      }
  increase(access, skyQ, SKY);
  increase(access, blkQ, BLK);
}
