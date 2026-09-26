import { WORLD } from '../config';
import { Block, SOLID } from './blocks';
import { COL_VOLUME, CS, WORLD_H, colIndex } from './chunk';
import { computeColumnLight } from './lighting';
import { mulberry32, Simplex } from './noise';

export interface ColumnData {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  light: Uint8Array;
}

const SEA = WORLD.SEA_LEVEL;
/** Noise is sampled every STEP blocks and trilinearly interpolated (caves). */
const STEP = 4;
const GX = CS / STEP + 1;
const GY = WORLD_H / STEP + 1;

function hash2(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Procedural terrain for the Verdant Surface and Hollow Caves: heightmap hills and ridged
 * mountains, 3D-noise caves (big "cheese" caverns + winding tunnels), lakes, ore veins,
 * trees and small ruins. Deterministic per seed; runs in a worker.
 */
export class WorldGen {
  private readonly continent: Simplex;
  private readonly hills: Simplex;
  private readonly mountains: Simplex;
  private readonly ridges: Simplex;
  private readonly caveA: Simplex;
  private readonly caveB: Simplex;
  private readonly caveC: Simplex;
  private readonly forest: Simplex;

  constructor(readonly seed: number) {
    this.continent = new Simplex(seed);
    this.hills = new Simplex(seed + 1);
    this.mountains = new Simplex(seed + 2);
    this.ridges = new Simplex(seed + 3);
    this.caveA = new Simplex(seed + 10);
    this.caveB = new Simplex(seed + 11);
    this.caveC = new Simplex(seed + 12);
    this.forest = new Simplex(seed + 20);
  }

  /** Terrain surface height (top solid block y) at world x, z. */
  height(x: number, z: number): number {
    const c = this.continent.fbm2(x / 700, z / 700, 3);
    const h = this.hills.fbm2(x / 150, z / 150, 4);
    const mMask = smoothstep(0.12, 0.5, this.mountains.fbm2(x / 480, z / 480, 2));
    const r = 1 - Math.abs(this.ridges.fbm2(x / 240, z / 240, 3));
    const height = 66 + c * 16 + h * 9 + mMask * (r * r * 58 + h * 10);
    return Math.max(8, Math.min(WORLD_H - 16, Math.floor(height)));
  }

  generate(cx: number, cz: number, edits?: ArrayLike<number>): ColumnData {
    const blocks = new Uint16Array(COL_VOLUME);
    const light = new Uint8Array(COL_VOLUME);
    const x0 = cx * CS, z0 = cz * CS;
    const heights = new Int32Array(CS * CS);
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) heights[x + z * CS] = this.height(x0 + x, z0 + z);

    const caves = this.caveField(x0, z0);
    const rng = mulberry32(hash2(cx, cz, this.seed));

    // --- Terrain, water, caves ---
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const h = heights[x + z * CS];
        const top = Math.max(h, SEA);
        let surface: number = Block.GRASS;
        let under: number = Block.DIRT;
        if (h >= 134) { surface = Block.SNOW; under = Block.STONE; }
        else if (h >= 118) { surface = Block.STONE; under = Block.STONE; }
        else if (h < SEA - 4) { surface = Block.GRAVEL; under = Block.GRAVEL; }
        else if (h <= SEA + 1) { surface = Block.SAND; under = Block.SAND; }
        // Caves may break the surface only on dry land.
        const surfaceCaves = h > SEA + 3;

        for (let y = 0; y <= top; y++) {
          const i = colIndex(x, y, z);
          if (y === 0 || (y <= 2 && (hash2(x0 + x, z0 + z, y + this.seed) & 3) === 0)) {
            blocks[i] = Block.BEDROCK;
            continue;
          }
          if (y > h) {
            blocks[i] = Block.WATER;
            continue;
          }
          const depth = h - y;
          if (y > 4 && (surfaceCaves || depth > 6) && this.isCave(caves, x, y, z, depth)) continue;
          if (depth === 0) blocks[i] = surface;
          else if (depth < 4) blocks[i] = under;
          else blocks[i] = y < 24 ? Block.DEEPSTONE : Block.STONE;
        }
      }

    // --- Ores ---
    this.veins(blocks, rng, Block.COAL_ORE, 18, 12, 120, 8);
    this.veins(blocks, rng, Block.COPPER_ORE, 12, 16, 90, 7);
    this.veins(blocks, rng, Block.IRON_ORE, 8, 5, 60, 6);

    // --- Surface features (kept inside the column so neighbors never need to agree) ---
    this.trees(blocks, heights, x0, z0, rng);
    if (rng() < 0.035) this.ruin(blocks, heights, rng);

    if (edits) for (let k = 0; k + 1 < edits.length; k += 2) blocks[edits[k]] = edits[k + 1];

    computeColumnLight(blocks, light);
    return { cx, cz, blocks, light };
  }

  /** Cave noise sampled on a coarse grid: [cheese, tunnelA, tunnelB] per point. */
  private caveField(x0: number, z0: number): Float32Array {
    const f = new Float32Array(GX * GX * GY * 3);
    let o = 0;
    for (let gy = 0; gy < GY; gy++)
      for (let gz = 0; gz < GX; gz++)
        for (let gx = 0; gx < GX; gx++) {
          const x = x0 + gx * STEP, y = gy * STEP, z = z0 + gz * STEP;
          f[o++] = this.caveA.noise3(x / 56, y / 32, z / 56);
          f[o++] = this.caveB.noise3(x / 72, y / 44, z / 72);
          f[o++] = this.caveC.noise3(x / 72, y / 44, z / 72);
        }
    return f;
  }

  private isCave(f: Float32Array, x: number, y: number, z: number, depth: number): boolean {
    const fx = x / STEP, fy = y / STEP, fz = z / STEP;
    const ix = Math.min(GX - 2, Math.floor(fx)), iy = Math.min(GY - 2, Math.floor(fy)), iz = Math.min(GX - 2, Math.floor(fz));
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const sample = (k: number) => {
      const at = (dx: number, dy: number, dz: number) => f[(((iy + dy) * GX + iz + dz) * GX + ix + dx) * 3 + k];
      const c00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * tx;
      const c10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * tx;
      const c01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * tx;
      const c11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * tx;
      const c0 = c00 + (c10 - c00) * ty;
      const c1 = c01 + (c11 - c01) * ty;
      return c0 + (c1 - c0) * tz;
    };
    // Winding tunnels: where two noise fields both cross zero.
    const a = sample(1), b = sample(2);
    if (Math.abs(a) + Math.abs(b) < 0.085) return true;
    // Big caverns, more common deeper (the Hollow Caves layer).
    if (depth < 8) return false;
    const threshold = 0.5 + smoothstep(20, 70, y) * 0.2;
    return sample(0) > threshold;
  }

  private veins(blocks: Uint16Array, rng: () => number, ore: number, count: number, yMin: number, yMax: number, size: number): void {
    for (let v = 0; v < count; v++) {
      let x = 1 + Math.floor(rng() * (CS - 2));
      let y = yMin + Math.floor(rng() * (yMax - yMin));
      let z = 1 + Math.floor(rng() * (CS - 2));
      const n = Math.floor(size * (0.5 + rng()));
      for (let k = 0; k < n; k++) {
        const i = colIndex(x, y, z);
        if (blocks[i] === Block.STONE || blocks[i] === Block.DEEPSTONE) blocks[i] = ore;
        x = Math.max(0, Math.min(CS - 1, x + Math.floor(rng() * 3) - 1));
        y = Math.max(1, Math.min(WORLD_H - 1, y + Math.floor(rng() * 3) - 1));
        z = Math.max(0, Math.min(CS - 1, z + Math.floor(rng() * 3) - 1));
      }
    }
  }

  private trees(blocks: Uint16Array, heights: Int32Array, x0: number, z0: number, rng: () => number): void {
    const density = this.forest.fbm2(x0 / 220, z0 / 220, 2);
    const count = Math.max(0, Math.round((density + 0.2) * 6 + rng() * 1.5 - 0.5));
    for (let t = 0; t < count; t++) {
      const x = 2 + Math.floor(rng() * (CS - 4));
      const z = 2 + Math.floor(rng() * (CS - 4));
      const h = heights[x + z * CS];
      if (blocks[colIndex(x, h, z)] !== Block.GRASS || h + 9 >= WORLD_H) continue;
      const trunk = 4 + Math.floor(rng() * 3);
      const topY = h + trunk;
      for (let y = h + 1; y <= topY; y++) blocks[colIndex(x, y, z)] = Block.LOG;
      blocks[colIndex(x, h, z)] = Block.DIRT;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy >= 0 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 1 || rng() < 0.5)) continue; // round the corners
            const i = colIndex(x + dx, topY + dy, z + dz);
            if (blocks[i] === 0) blocks[i] = Block.LEAVES;
          }
      }
      blocks[colIndex(x, topY + 2, z)] = Block.LEAVES;
    }
  }

  /** A small broken shrine: cobble floor, crumbling brick walls, a pillar with a torch. */
  private ruin(blocks: Uint16Array, heights: Int32Array, rng: () => number): void {
    const cx = 5 + Math.floor(rng() * 6), cz = 5 + Math.floor(rng() * 6);
    const base = heights[cx + cz * CS];
    if (base <= SEA + 1 || base > 115) return;
    const R = 3;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx, z = cz + dz;
        // Foundation down to the ground, floor at `base`, clear the space above.
        for (let y = base; y >= base - 4; y--) {
          const i = colIndex(x, y, z);
          if (y < base && SOLID[blocks[i]]) break;
          blocks[i] = Block.COBBLE;
        }
        for (let y = base + 1; y <= base + 6; y++) blocks[colIndex(x, y, z)] = 0;
        const edge = Math.abs(dx) === R || Math.abs(dz) === R;
        if (!edge) continue;
        const wallH = 1 + Math.floor(rng() * 4);
        for (let y = base + 1; y <= base + wallH; y++) {
          if (rng() < 0.15) continue; // gaps
          blocks[colIndex(x, y, z)] = rng() < 0.35 ? Block.MOSSY_BRICK : Block.STONE_BRICK;
        }
      }
    for (let y = base + 1; y <= base + 3; y++) blocks[colIndex(cx, y, cz)] = Block.STONE_BRICK;
    blocks[colIndex(cx, base + 4, cz)] = Block.TORCH;
  }
}
