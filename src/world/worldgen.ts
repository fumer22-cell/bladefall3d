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

/** Regional flavor of the Verdant Surface. */
export type Mood = 'glade' | 'golden' | 'mist' | 'moor';

const SEA = WORLD.SEA_LEVEL;
/** Density/caves are sampled every STEP blocks and trilinearly interpolated. */
const STEP = 4;
const GX = CS / STEP + 1;
const GY = WORLD_H / STEP + 1;
/** Floating islands live in this band. */
const ISLAND_MIN = 112;
const ISLAND_MAX = 196;

function hash2(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface MoodKit {
  grass: number;
  leaves: number;
  log: number;
  plants: [number, number][]; // [block, chance]
  trees: number; // tree density multiplier
  cliff: number; // overhang/warp strength
}

const MOODS: Record<Mood, MoodKit> = {
  glade: {
    grass: Block.GRASS, leaves: Block.LEAVES, log: Block.LOG, trees: 1, cliff: 0.45,
    plants: [[Block.TALL_GRASS, 0.3], [Block.FLOWER_ROSE, 0.03], [Block.FLOWER_BLUE, 0.02]],
  },
  golden: {
    grass: Block.GOLD_GRASS, leaves: Block.GOLD_LEAVES, log: Block.PALE_LOG, trees: 1.2, cliff: 0.6,
    plants: [[Block.GOLD_TUFT, 0.35], [Block.FLOWER_GOLD, 0.05]],
  },
  mist: {
    grass: Block.TEAL_GRASS, leaves: Block.TEAL_LEAVES, log: Block.LOG, trees: 0.9, cliff: 1.0,
    plants: [[Block.FERN, 0.3], [Block.FLOWER_BLUE, 0.05], [Block.GLOWSHROOM, 0.012]],
  },
  moor: {
    grass: Block.HEATHER, leaves: Block.ROSE_LEAVES, log: Block.LOG, trees: 0.25, cliff: 1.35,
    plants: [[Block.GOLD_TUFT, 0.1], [Block.FLOWER_ROSE, 0.02]],
  },
};

/**
 * Dreamlike terrain for the Verdant Surface and Hollow Caves: a 3D density field (so cliffs
 * overhang and arches form), stone spires, floating islands with hanging vines, four regional
 * moods with their own grass, trees and flowers, caves lit by glowshrooms and crystals, and ruins.
 * Deterministic per seed; runs in a worker.
 */
export class WorldGen {
  private readonly n: Record<string, Simplex>;

  constructor(readonly seed: number) {
    const names = ['cont', 'hills', 'mount', 'ridge', 'warm', 'wet', 'warp', 'detail', 'cliff', 'spire', 'spireH',
      'island', 'islandY', 'islandD', 'caveA', 'caveB', 'caveC', 'forest'];
    this.n = Object.fromEntries(names.map((k, i) => [k, new Simplex(seed + i * 101)]));
  }

  mood(x: number, z: number): Mood {
    const warm = this.n.warm.fbm2(x / 520, z / 520, 2);
    const wet = this.n.wet.fbm2(x / 440, z / 440, 2);
    if (warm > 0.12) return wet > 0.05 ? 'glade' : 'golden';
    if (warm < -0.12) return wet > -0.05 ? 'mist' : 'moor';
    return wet > 0.15 ? 'mist' : wet < -0.2 ? 'golden' : 'glade';
  }

  /** Base terrain height before 3D shaping (roughly where the ground is). */
  height(x: number, z: number): number {
    const n = this.n;
    const c = n.cont.fbm2(x / 700, z / 700, 3);
    const h = n.hills.fbm2(x / 150, z / 150, 4);
    const mMask = smoothstep(0.1, 0.5, n.mount.fbm2(x / 480, z / 480, 2));
    const r = 1 - Math.abs(n.ridge.fbm2(x / 240, z / 240, 3));
    let height = 68 + c * 16 + h * 10 + mMask * (r * r * 50 + h * 10);
    // Gentle terraces in places: dreamy stepped meadows.
    const terr = smoothstep(0.2, 0.5, n.warm.fbm2(x / 300 + 40, z / 300, 2));
    if (terr > 0) {
      const step = 5;
      const t = height / step;
      const stepped = (Math.floor(t) + smoothstep(0.7, 1, t - Math.floor(t))) * step;
      height += (stepped - height) * terr;
    }
    return Math.floor(Math.max(8, Math.min(WORLD_H - 40, height)));
  }

  /** Spire strength (0..1) at x, z. */
  private spire(x: number, z: number): number {
    const s = 1 - Math.abs(this.n.spire.noise2(x / 34, z / 34));
    const region = smoothstep(-0.1, 0.35, this.n.cliff.fbm2(x / 400, z / 400, 2));
    return smoothstep(0.955, 0.99, s) * region;
  }

  /** Density at a grid point: > 0 is solid. */
  private density(x: number, y: number, z: number, H: number, cliff: number, spire: number, spireTop: number, island: number, islandY: number): number {
    const n = this.n;
    let d = (H - y) / 10;
    // Warped 3D noise: overhangs, arches and dreamy lumps, stronger in cliffy regions.
    d += n.warp.noise3(x / 46, y / 30, z / 46) * (0.25 + cliff) + n.detail.noise3(x / 17, y / 13, z / 17) * 0.12;
    if (spire > 0.02 && y > H - 4 && y < spireTop) {
      const t = (y - H) / (spireTop - H);
      d = Math.max(d, spire * 1.6 * (1 - t * t) - 0.35);
    }
    if (island > 0.01 && y >= ISLAND_MIN && y <= ISLAND_MAX) {
      const dy = y - islandY;
      // Flat-ish tops, long tapering undersides.
      const vert = dy > 0 ? 1 - dy / (4 + 5 * island) : 1 + dy / (5 + 22 * island * island);
      d = Math.max(d, island * vert + n.islandD.noise3(x / 20, y / 14, z / 20) * 0.3 - 0.18);
    }
    return d;
  }

  generate(cx: number, cz: number, edits?: ArrayLike<number>): ColumnData {
    const blocks = new Uint16Array(COL_VOLUME);
    const light = new Uint8Array(COL_VOLUME);
    const x0 = cx * CS, z0 = cz * CS;
    const n = this.n;
    const rng = mulberry32(hash2(cx, cz, this.seed));

    // --- Coarse density + cave fields ---
    const dens = new Float32Array(GX * GX * GY);
    const caves = new Float32Array(GX * GX * GY * 3);
    for (let gz = 0; gz < GX; gz++)
      for (let gx = 0; gx < GX; gx++) {
        const x = x0 + gx * STEP, z = z0 + gz * STEP;
        const H = this.height(x, z);
        const kit = MOODS[this.mood(x, z)];
        const cliff = kit.cliff * (0.5 + 0.5 * smoothstep(-0.3, 0.4, n.cliff.fbm2(x / 180, z / 180, 2)));
        const spire = this.spire(x, z);
        const spireTop = H + 26 + 50 * (0.5 + 0.5 * n.spireH.noise2(x / 60, z / 60));
        const island = smoothstep(0.42, 0.78, n.island.fbm2(x / 150, z / 150, 3));
        const islandY = 148 + 20 * n.islandY.noise2(x / 230, z / 230);
        for (let gy = 0; gy < GY; gy++) {
          const y = gy * STEP;
          const o = (gy * GX + gz) * GX + gx;
          dens[o] = this.density(x, y, z, H, cliff, spire, spireTop, island, islandY);
          caves[o * 3] = n.caveA.noise3(x / 56, y / 32, z / 56);
          caves[o * 3 + 1] = n.caveB.noise3(x / 72, y / 44, z / 72);
          caves[o * 3 + 2] = n.caveC.noise3(x / 72, y / 44, z / 72);
        }
      }
    const sample = (f: Float32Array, stride: number, k: number, x: number, y: number, z: number) => {
      const fx = x / STEP, fy = y / STEP, fz = z / STEP;
      const ix = Math.min(GX - 2, Math.floor(fx)), iy = Math.min(GY - 2, Math.floor(fy)), iz = Math.min(GX - 2, Math.floor(fz));
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const at = (dx: number, dy: number, dz: number) => f[((((iy + dy) * GX + iz + dz) * GX + ix + dx) * stride) + k];
      const c00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * tx;
      const c10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * tx;
      const c01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * tx;
      const c11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * tx;
      const c0 = c00 + (c10 - c00) * ty;
      const c1 = c01 + (c11 - c01) * ty;
      return c0 + (c1 - c0) * tz;
    };

    // --- Solid rock ---
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++)
        for (let y = 0; y < WORLD_H - 1; y++) {
          if (y === 0 || (y <= 2 && (hash2(x0 + x, z0 + z, y + this.seed) & 3) === 0)) {
            blocks[colIndex(x, y, z)] = Block.BEDROCK;
            continue;
          }
          if (sample(dens, 1, 0, x, y, z) > 0) blocks[colIndex(x, y, z)] = y < 24 ? Block.DEEPSTONE : Block.STONE;
        }

    // --- Water: open air from sea level down to the first solid block ---
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++)
        for (let y = SEA; y > 0; y--) {
          const i = colIndex(x, y, z);
          if (blocks[i] !== 0) break;
          blocks[i] = Block.WATER;
        }

    // --- Surface materials and caves (top-down scan per column) ---
    const ground = new Int32Array(CS * CS).fill(-1);
    const moods: Mood[] = [];
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const wx = x0 + x, wz = z0 + z;
        const mood = this.mood(wx, wz);
        moods[x + z * CS] = mood;
        const kit = MOODS[mood];
        const rocky = this.spire(wx, wz) > 0.25;
        let depth = -1; // blocks since the last air going down (−1 = in air)
        for (let y = WORLD_H - 2; y > 0; y--) {
          const i = colIndex(x, y, z);
          const b = blocks[i];
          if (b === 0 || b === Block.WATER || b === Block.BEDROCK) {
            depth = -1;
            continue;
          }
          depth++;
          const underwater = y < SEA && blocks[colIndex(x, y + 1, z)] === Block.WATER;
          const beach = y <= SEA + 1 && y >= SEA - 3;
          const airBelow = blocks[colIndex(x, y - 1, z)] === 0 && y > ISLAND_MIN - 10;
          // Caves (tunnels may open at the surface on dry land; caverns stay deeper).
          if (y > 4 && depth > 1 && !underwater && y < SEA + 90) {
            const a = sample(caves, 3, 1, x, y, z), c = sample(caves, 3, 2, x, y, z);
            const tunnel = Math.abs(a) + Math.abs(c) < 0.085 && (depth > 5 || y > SEA + 3);
            const cavern = depth > 8 && sample(caves, 3, 0, x, y, z) > 0.5 + smoothstep(20, 70, y) * 0.2;
            if (tunnel || cavern) {
              blocks[i] = 0;
              continue;
            }
          }
          if (depth === 0) {
            if (y < ISLAND_MIN - 4 && ground[x + z * CS] < 0 && !underwater) ground[x + z * CS] = y;
            if (underwater) blocks[i] = y < SEA - 4 ? Block.GRAVEL : Block.SAND;
            else if (beach && mood !== 'moor') blocks[i] = Block.SAND;
            else if (rocky || y > 168) blocks[i] = y > 176 ? Block.SNOW : Block.MOSS_STONE;
            else blocks[i] = kit.grass;
          } else if (depth < 4 && !rocky) {
            blocks[i] = underwater || (beach && mood !== 'moor') ? Block.SAND : Block.DIRT;
          }
          // Undersides of floating land get roots.
          if (airBelow && depth > 0) blocks[i] = Block.ROOTS;
        }
      }

    // --- Ores ---
    this.veins(blocks, rng, Block.COAL_ORE, 18, 12, 120, 8);
    this.veins(blocks, rng, Block.COPPER_ORE, 12, 16, 90, 7);
    this.veins(blocks, rng, Block.IRON_ORE, 8, 5, 60, 6);

    // --- Decoration ---
    this.caveLife(blocks, rng, moods);
    this.trees(blocks, rng, moods, n.forest.fbm2(x0 / 220, z0 / 220, 2));
    this.plants(blocks, rng, moods);
    this.hangingVines(blocks, rng);
    const r = rng();
    if (r < 0.05) this.ruin(blocks, ground, rng, moods[8 + 8 * CS]);
    else if (moods[8 + 8 * CS] === 'moor' && r < 0.12) this.standingStones(blocks, ground, rng);

    if (edits) for (let k = 0; k + 1 < edits.length; k += 2) blocks[edits[k]] = edits[k + 1];

    computeColumnLight(blocks, light);
    return { cx, cz, blocks, light };
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

  /** Glowshrooms on cave floors and crystals on cave ceilings: the Hollow Caves glow faintly. */
  private caveLife(blocks: Uint16Array, rng: () => number, moods: Mood[]): void {
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const mist = moods[x + z * CS] === 'mist';
        for (let y = 6; y < SEA - 4; y++) {
          const i = colIndex(x, y, z);
          if (blocks[i] !== 0) continue;
          const below = blocks[colIndex(x, y - 1, z)], above = blocks[colIndex(x, y + 1, z)];
          if ((below === Block.STONE || below === Block.DEEPSTONE) && rng() < (mist ? 0.08 : 0.035)) blocks[i] = Block.GLOWSHROOM;
          else if ((above === Block.STONE || above === Block.DEEPSTONE) && rng() < 0.012) blocks[colIndex(x, y + 1, z)] = Block.CRYSTAL;
        }
      }
  }

  private isTop(blocks: Uint16Array, x: number, y: number, z: number): boolean {
    return y < WORLD_H - 12 && blocks[colIndex(x, y + 1, z)] === 0;
  }

  private plants(blocks: Uint16Array, rng: () => number, moods: Mood[]): void {
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const kit = MOODS[moods[x + z * CS]];
        for (let y = WORLD_H - 3; y > SEA; y--) {
          const b = blocks[colIndex(x, y, z)];
          if (b !== kit.grass && b !== Block.GRASS && b !== Block.MOSS_STONE) continue;
          if (!this.isTop(blocks, x, y, z)) continue;
          let r = rng();
          for (const [plant, chance] of kit.plants) {
            if (r < chance) {
              blocks[colIndex(x, y + 1, z)] = plant;
              break;
            }
            r -= chance;
          }
        }
      }
  }

  /** Vines dangle from the undersides of floating islands and overhangs. */
  private hangingVines(blocks: Uint16Array, rng: () => number): void {
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++)
        for (let y = ISLAND_MIN - 20; y < WORLD_H - 2; y++) {
          const b = blocks[colIndex(x, y, z)];
          if ((b !== Block.ROOTS && b !== Block.TEAL_LEAVES) || blocks[colIndex(x, y - 1, z)] !== 0 || rng() > 0.18) continue;
          const len = 2 + Math.floor(rng() * 6);
          for (let k = 1; k <= len && y - k > 0 && blocks[colIndex(x, y - k, z)] === 0; k++) blocks[colIndex(x, y - k, z)] = Block.VINES;
        }
  }

  // ------------------------------------------------------------------ trees

  private trees(blocks: Uint16Array, rng: () => number, moods: Mood[], forest: number): void {
    const attempts = Math.max(0, Math.round((forest + 0.25) * 7));
    for (let t = 0; t < attempts; t++) {
      const x = 3 + Math.floor(rng() * (CS - 6));
      const z = 3 + Math.floor(rng() * (CS - 6));
      const mood = moods[x + z * CS];
      const kit = MOODS[mood];
      if (rng() > kit.trees) continue;
      // Find the highest grassy top here (islands count too).
      let y = -1;
      for (let yy = WORLD_H - 20; yy > SEA + 1; yy--) {
        const b = blocks[colIndex(x, yy, z)];
        if (b === kit.grass && this.isTop(blocks, x, yy, z)) {
          y = yy;
          break;
        }
        if (SOLID[b]) break;
      }
      if (y < 0) continue;
      blocks[colIndex(x, y, z)] = Block.DIRT;
      if (mood === 'golden') this.paleTree(blocks, rng, x, y, z, kit);
      else if (mood === 'mist') this.willow(blocks, rng, x, y, z, kit);
      else if (mood === 'moor') this.deadTree(blocks, rng, x, y, z);
      else if (rng() < 0.15) this.roundTree(blocks, rng, x, y, z, Block.LOG, Block.ROSE_LEAVES);
      else this.roundTree(blocks, rng, x, y, z, kit.log, kit.leaves);
    }
  }

  private put(blocks: Uint16Array, x: number, y: number, z: number, id: number, overwrite = false): void {
    if (x < 0 || z < 0 || x >= CS || z >= CS || y <= 0 || y >= WORLD_H) return;
    const i = colIndex(x, y, z);
    if (overwrite || blocks[i] === 0 || blocks[i] === Block.VINES || blocks[i] === Block.TALL_GRASS) blocks[i] = id;
  }

  private blob(blocks: Uint16Array, rng: () => number, cx: number, cy: number, cz: number, rx: number, ry: number, id: number): void {
    for (let dy = -ry; dy <= ry; dy++)
      for (let dz = -rx; dz <= rx; dz++)
        for (let dx = -rx; dx <= rx; dx++) {
          const d = (dx * dx + dz * dz) / (rx * rx + 0.5) + (dy * dy) / (ry * ry + 0.5);
          if (d > 1 || (d > 0.7 && rng() < 0.35)) continue;
          this.put(blocks, cx + dx, cy + dy, cz + dz, id);
        }
  }

  private roundTree(blocks: Uint16Array, rng: () => number, x: number, y: number, z: number, log: number, leaves: number): void {
    const h = 5 + Math.floor(rng() * 4);
    for (let k = 1; k <= h; k++) this.put(blocks, x, y + k, z, log, true);
    this.blob(blocks, rng, x, y + h, z, 3, 2, leaves);
    this.put(blocks, x, y + h + 2, z, leaves);
  }

  /** Tall pale trunk with a leaning top and layered golden canopies. */
  private paleTree(blocks: Uint16Array, rng: () => number, x: number, y: number, z: number, kit: MoodKit): void {
    const h = 8 + Math.floor(rng() * 5);
    let tx = x, tz = z;
    for (let k = 1; k <= h; k++) {
      if (k > h * 0.6 && rng() < 0.3) {
        tx = Math.max(2, Math.min(CS - 3, tx + (rng() < 0.5 ? -1 : 1)));
      }
      this.put(blocks, tx, y + k, tz, kit.log, true);
    }
    this.blob(blocks, rng, tx, y + h, tz, 3, 1, kit.leaves);
    this.blob(blocks, rng, tx, y + h + 2, tz, 2, 1, kit.leaves);
    // A lower side tuft on a short branch.
    const bx = Math.max(1, Math.min(CS - 2, x + (rng() < 0.5 ? -2 : 2)));
    const by = y + Math.floor(h * 0.55);
    this.put(blocks, Math.round((x + bx) / 2), by, z, kit.log, true);
    this.blob(blocks, rng, bx, by + 1, z, 1, 1, kit.leaves);
  }

  /** Willow: short thick trunk, wide flat canopy, curtains of vines. */
  private willow(blocks: Uint16Array, rng: () => number, x: number, y: number, z: number, kit: MoodKit): void {
    const h = 5 + Math.floor(rng() * 3);
    for (let k = 1; k <= h; k++) this.put(blocks, x, y + k, z, kit.log, true);
    this.blob(blocks, rng, x, y + h, z, 3, 1, kit.leaves);
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dz * dz < 5 || rng() < 0.5) continue;
        const len = 2 + Math.floor(rng() * 4);
        for (let k = 1; k <= len; k++) this.put(blocks, x + dx, y + h - k + 1, z + dz, Block.VINES);
      }
  }

  private deadTree(blocks: Uint16Array, rng: () => number, x: number, y: number, z: number): void {
    const h = 4 + Math.floor(rng() * 4);
    for (let k = 1; k <= h; k++) this.put(blocks, x, y + k, z, Block.LOG, true);
    for (let b = 0; b < 3; b++) {
      const dx = rng() < 0.5 ? -1 : 1, dz = rng() < 0.5 ? -1 : 1;
      const by = y + 2 + Math.floor(rng() * (h - 2));
      this.put(blocks, x + dx, by, z, Block.LOG);
      this.put(blocks, x + dx * 2, by + 1, z + (rng() < 0.5 ? dz : 0), Block.LOG);
    }
    if (rng() < 0.4) this.blob(blocks, rng, x, y + h, z, 1, 1, Block.ROSE_LEAVES);
  }

  // ------------------------------------------------------------------ ruins

  private groundAt(ground: Int32Array, x: number, z: number): number {
    return ground[x + z * CS];
  }

  /** A ruined tower, an arch or a crumbling wall with a lantern; kept inside the column. */
  private ruin(blocks: Uint16Array, ground: Int32Array, rng: () => number, mood: Mood): void {
    const cx = 5 + Math.floor(rng() * 6), cz = 5 + Math.floor(rng() * 6);
    const base = this.groundAt(ground, cx, cz);
    if (base < SEA + 1 || base > ISLAND_MIN - 30) return;
    const brick = () => (rng() < (mood === 'mist' || mood === 'glade' ? 0.45 : 0.25) ? Block.MOSSY_BRICK : Block.STONE_BRICK);
    const foundation = (x: number, z: number) => {
      for (let y = base; y > base - 6; y--) {
        const i = colIndex(x, y, z);
        if (y < base && SOLID[blocks[i]]) break;
        blocks[i] = Block.COBBLE;
      }
    };
    const kind = rng();
    if (kind < 0.5) {
      // Round tower, broken open, lantern inside.
      const R = 3, H = 7 + Math.floor(rng() * 9);
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > R + 0.5) continue;
          foundation(cx + dx, cz + dz);
          for (let y = base + 1; y <= base + H + 2; y++) blocks[colIndex(cx + dx, y, cz + dz)] = 0;
          if (d < R - 0.5) continue;
          const top = base + H - Math.floor(rng() * rng() * H * 0.8) - (dx > 0 ? Math.floor(H / 3) : 0);
          for (let y = base + 1; y <= top; y++) {
            const window = (y - base) % 4 === 2 && (dx === 0 || dz === 0);
            const door = y <= base + 2 && dz === -R && dx === 0;
            if (!window && !door) blocks[colIndex(cx + dx, y, cz + dz)] = brick();
          }
        }
      blocks[colIndex(cx, base + 1, cz)] = Block.LANTERN;
    } else if (kind < 0.8) {
      // Arch: two pillars with a lintel.
      const span = 4 + Math.floor(rng() * 3), H = 6 + Math.floor(rng() * 4);
      const along = rng() < 0.5;
      const at = (k: number, w: number): [number, number] => (along ? [cx - 3 + k, cz + w] : [cx + w, cz - 3 + k]);
      for (const k of [0, span]) {
        for (let w = 0; w <= 1; w++) {
          const [x, z] = at(k, w);
          if (x < 0 || z < 0 || x >= CS || z >= CS) continue;
          foundation(x, z);
          for (let y = base + 1; y <= base + H; y++) blocks[colIndex(x, y, z)] = brick();
        }
      }
      for (let k = 0; k <= span; k++)
        for (let w = 0; w <= 1; w++) {
          const [x, z] = at(k, w);
          if (x < 0 || z < 0 || x >= CS || z >= CS || rng() < 0.12) continue;
          blocks[colIndex(x, base + H + 1, z)] = brick();
        }
      const [lx, lz] = at(0, 0);
      if (lx >= 0 && lz >= 0 && lx < CS && lz < CS) blocks[colIndex(lx, base + H + 2, lz)] = Block.LANTERN;
    } else {
      this.standingStones(blocks, ground, rng);
    }
  }

  /** A ring of mossy standing stones around a crystal. */
  private standingStones(blocks: Uint16Array, ground: Int32Array, rng: () => number): void {
    const cx = 8, cz = 8, R = 4;
    const count = 6 + Math.floor(rng() * 3);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rng() * 0.3;
      const x = Math.round(cx + Math.cos(a) * R), z = Math.round(cz + Math.sin(a) * R);
      const g = this.groundAt(ground, x, z);
      if (g < SEA) continue;
      const h = 2 + Math.floor(rng() * 3);
      for (let y = g + 1; y <= g + h; y++) blocks[colIndex(x, y, z)] = y === g + h ? Block.MOSS_STONE : Block.STONE;
    }
    const g = this.groundAt(ground, cx, cz);
    if (g >= SEA) blocks[colIndex(cx, g + 1, cz)] = Block.CRYSTAL;
  }
}
