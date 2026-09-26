import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';
import { mulberry32 } from '../world/noise';
import { ATLAS_TILES, TILE, TILE_PX, type TileName } from '../world/tiles';
import { RAMPS, hexToRgb, type RampName } from './palette';

const N = TILE_PX;
type RGB = [number, number, number];

/** One 16×16 tile being painted. y = 0 is the top row. */
class Tile {
  readonly px = new Uint8ClampedArray(N * N * 4);
  constructor(readonly rng: () => number) {}

  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = a;
  }

  alpha(x: number, y: number): number {
    return this.px[(y * N + x) * 4 + 3];
  }

  /** Fill with ramp shades chosen from [lo, hi] using clumpy value noise. */
  noise(ramp: RampName, lo: number, hi: number, scale = 4): void {
    const r = shades(ramp);
    const grid = new Float32Array((scale + 1) * (scale + 1)).map(() => this.rng());
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const gx = (x / N) * scale, gy = (y / N) * scale;
        const ix = Math.floor(gx), iy = Math.floor(gy);
        const tx = gx - ix, ty = gy - iy;
        const g = (a: number, b: number) => grid[(iy + b) * (scale + 1) + ix + a];
        const v = (g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - ty) + (g(0, 1) * (1 - tx) + g(1, 1) * tx) * ty;
        const jitter = (this.rng() - 0.5) * 0.5;
        const k = Math.round(lo + Math.max(0, Math.min(1, v + jitter)) * (hi - lo));
        this.set(x, y, r[k]);
      }
  }

  speckle(ramp: RampName, idx: number, count: number): void {
    const c = shades(ramp)[idx];
    for (let k = 0; k < count; k++) this.set(Math.floor(this.rng() * N), Math.floor(this.rng() * N), c);
  }
}

const shadeCache = new Map<RampName, RGB[]>();
function shades(r: RampName): RGB[] {
  let s = shadeCache.get(r);
  if (!s) shadeCache.set(r, (s = (RAMPS[r] as readonly string[]).map(hexToRgb)));
  return s;
}
const C = (r: RampName, i: number) => shades(r)[Math.max(0, Math.min(shades(r).length - 1, i))];

// ---------------------------------------------------------------- painters

function grassTop(t: Tile, ramp: RampName): void {
  t.noise(ramp, 2, 4);
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(t.rng() * N), y = Math.floor(t.rng() * N);
    t.set(x, y, C(ramp, 5));
    t.set(x, y + 1, C(ramp, 3));
  }
  t.speckle(ramp, 1, 10);
}

function grassSide(t: Tile, ramp: RampName, soil: RampName = 'dirt'): void {
  dirt(t, soil);
  for (let x = 0; x < N; x++) {
    const len = 3 + Math.floor(t.rng() * 3) + (x % 3 === 0 ? 1 : 0);
    for (let y = 0; y < len; y++) t.set(x, y, C(ramp, y === 0 ? 4 : len - y > 1 ? 3 : 2));
    t.set(x, len, C(ramp, 1));
  }
}

function dirt(t: Tile, ramp: RampName = 'dirt'): void {
  t.noise(ramp, 1, 3);
  t.speckle(ramp, 0, 12);
  t.speckle(ramp, 4, 6);
  t.speckle('stone', 3, 3);
}

function stone(t: Tile, ramp: RampName = 'stone', lo = 2, hi = 4): void {
  t.noise(ramp, lo, hi, 3);
  // Cracks.
  for (let c = 0; c < 3; c++) {
    let x = Math.floor(t.rng() * N), y = Math.floor(t.rng() * N);
    for (let k = 0; k < 4 + t.rng() * 4; k++) {
      t.set(x, y, C(ramp, lo - 1));
      t.set(x + 1, y, C(ramp, hi + 1));
      x += t.rng() < 0.5 ? 1 : 0;
      y += t.rng() < 0.7 ? 1 : 0;
    }
  }
}

/** Voronoi stones with dark mortar. */
function cobble(t: Tile, ramp: RampName = 'stone', cells = 7, mortar: RGB = C('ink', 2)): void {
  const pts = Array.from({ length: cells }, () => [t.rng() * N, t.rng() * N, 2 + Math.floor(t.rng() * 3)]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let k = 0; k < pts.length; k++) {
        // Wrap so the tile repeats seamlessly.
        let dx = Math.abs(x - pts[k][0]), dy = Math.abs(y - pts[k][1]);
        dx = Math.min(dx, N - dx);
        dy = Math.min(dy, N - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
      }
      if (Math.sqrt(d2) - Math.sqrt(d1) < 1.1) t.set(x, y, mortar);
      else t.set(x, y, C(ramp, pts[best][2] + (Math.sqrt(d1) < 1.5 ? 1 : 0)));
    }
}

function bricks(t: Tile, ramp: RampName, bw: number, bh: number, mortar: RGB): void {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const row = Math.floor(y / bh);
      const off = row % 2 ? bw / 2 : 0;
      const bx = (x + off) % bw, by = y % bh;
      if (by === bh - 1 || bx === bw - 1) t.set(x, y, mortar);
      else {
        const brick = Math.floor((x + off) / bw) + row * 7;
        const base = 2 + ((brick * 2654435761) >>> 0) % 2;
        t.set(x, y, C(ramp, by === 0 ? base + 1 : base + (t.rng() < 0.15 ? -1 : 0)));
      }
    }
}

function planks(t: Tile, ramp: RampName = 'wood'): void {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const p = Math.floor(y / 4), py = y % 4;
      const base = 2 + (p % 2);
      let c = C(ramp, base);
      if (py === 0) c = C(ramp, base + 1);
      if (py === 3) c = C(ramp, 0);
      if (py !== 3 && t.rng() < 0.12) c = C(ramp, base - 1);
      t.set(x, y, c);
    }
  for (let p = 0; p < 4; p++) {
    const x = (p * 5 + 3) % N;
    t.set(x, p * 4 + 1, C('ink', 1));
  }
}

function logSide(t: Tile, ramp: RampName): void {
  for (let x = 0; x < N; x++) {
    const base = 1 + ((x * 7) % 3 === 0 ? 1 : x % 4 === 1 ? 2 : 0);
    for (let y = 0; y < N; y++) t.set(x, y, C(ramp, base + (t.rng() < 0.1 ? 1 : 0)));
  }
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(t.rng() * N), y0 = Math.floor(t.rng() * N);
    for (let y = y0; y < y0 + 4; y++) t.set(x, y % N, C(ramp, 0));
  }
}

function paleLogSide(t: Tile): void {
  t.noise('pale', 3, 4, 2);
  for (let k = 0; k < 6; k++) {
    const y = Math.floor(t.rng() * N), x0 = Math.floor(t.rng() * N), len = 2 + Math.floor(t.rng() * 4);
    for (let x = x0; x < x0 + len; x++) t.set(x % N, y, C('ink', 2));
  }
  for (let y = 0; y < N; y++) {
    t.set(0, y, C('pale', 1));
    t.set(N - 1, y, C('pale', 2));
  }
}

function logTop(t: Tile, ramp: RampName, bark: RampName): void {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7) t.set(x, y, C(bark, 1));
      else t.set(x, y, C(ramp, Math.floor(d) % 3 === 0 ? 2 : 3));
    }
}

function leaves(t: Tile, ramp: RampName): void {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, C(ramp, 1));
  for (let k = 0; k < 14; k++) {
    const cx = Math.floor(t.rng() * N), cy = Math.floor(t.rng() * N), r = 1 + Math.floor(t.rng() * 2);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const shade = dy < 0 || dx < 0 ? 4 : 3;
        t.set((cx + dx + N) % N, (cy + dy + N) % N, C(ramp, shade));
      }
    t.set(cx, cy, C(ramp, 5));
  }
  t.speckle('ink', 1, 8);
}

function ore(t: Tile, ramp: RampName, hi: number, clusters = 4): void {
  stone(t);
  for (let k = 0; k < clusters; k++) {
    const cx = 2 + Math.floor(t.rng() * (N - 4)), cy = 2 + Math.floor(t.rng() * (N - 4));
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) {
      if (t.rng() < 0.25) continue;
      t.set(cx + dx, cy + dy, C(ramp, dx + dy <= 0 ? hi : hi - 1));
    }
    t.set(cx + 1, cy + 1, C(ramp, Math.max(0, hi - 2)));
  }
}

/** Transparent-background plant (cross sprite). */
function plant(t: Tile, draw: (t: Tile) => void): void {
  t.px.fill(0);
  draw(t);
}

function blades(t: Tile, ramp: RampName, count: number, maxH: number): void {
  for (let k = 0; k < count; k++) {
    let x = 1 + Math.floor(t.rng() * (N - 2));
    const h = 5 + Math.floor(t.rng() * maxH);
    const lean = t.rng() < 0.5 ? -1 : 1;
    for (let i = 0; i < h; i++) {
      if (i > h / 2 && t.rng() < 0.35) x += lean;
      t.set(x, N - 1 - i, C(ramp, i > h - 3 ? 5 : i < 3 ? 2 : 3 + (k % 2)));
    }
  }
}

function flower(t: Tile, petals: RampName, stem: RampName = 'moss'): void {
  blades(t, stem, 3, 4);
  for (let k = 0; k < 2; k++) {
    const x = 4 + Math.floor(t.rng() * 8), y = 3 + Math.floor(t.rng() * 4);
    for (let i = y + 2; i < N; i++) t.set(x, i, C(stem, 3));
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) t.set(x + dx, y + dy, C(petals, 4));
    t.set(x, y, C('gold', 6));
  }
}

/** Vertical basalt-like columns with dark seams: tall rock faces read as cliffs, not cubes. */
function cliff(t: Tile, ramp: RampName, moss = false): void {
  const widths: number[] = [];
  for (let w = 0; w < N; ) {
    const cw = 2 + Math.floor(t.rng() * 3);
    widths.push(Math.min(cw, N - w));
    w += cw;
  }
  let x0 = 0;
  const top = shades(ramp).length - 2;
  widths.forEach((w, k) => {
    const base = 2 + (k % 2);
    const breakY = Math.floor(t.rng() * N);
    for (let x = x0; x < x0 + w; x++)
      for (let y = 0; y < N; y++) {
        let c = C(ramp, base);
        if (x === x0) c = C(ramp, base - 1); // seam
        else if (x === x0 + 1) c = C(ramp, Math.min(top, base + 1)); // lit edge
        if (y === breakY && x !== x0) c = C(ramp, base - 1);
        if (t.rng() < 0.06) c = C(ramp, base - 1);
        t.set(x, y, c);
      }
    x0 += w;
  });
  if (moss)
    for (let k = 0; k < 7; k++) {
      let x = Math.floor(t.rng() * N);
      const len = 3 + Math.floor(t.rng() * 9);
      for (let y = 0; y < len; y++) {
        t.set(x, y, C('moss', y < 2 ? 4 : 3));
        if (t.rng() < 0.2) x = (x + 1) % N;
      }
    }
}

const PAINTERS: Record<TileName, (t: Tile) => void> = {
  cliff: (t) => cliff(t, 'stone'),
  cliff_moss: (t) => cliff(t, 'stone', true),
  deep_cliff: (t) => cliff(t, 'deep'),
  grass_top: (t) => grassTop(t, 'moss'),
  grass_side: (t) => grassSide(t, 'moss'),
  dirt: (t) => dirt(t),
  stone: (t) => stone(t),
  cobble: (t) => cobble(t),
  planks: (t) => planks(t),
  log_side: (t) => logSide(t, 'wood'),
  log_top: (t) => logTop(t, 'wood', 'wood'),
  leaves: (t) => leaves(t, 'moss'),
  sand: (t) => {
    t.noise('sand', 2, 4, 5);
    t.speckle('sand', 0, 10);
    t.speckle('sand', 4, 8);
  },
  gravel: (t) => cobble(t, 'stone', 12, C('dirt', 0)),
  snow: (t) => {
    t.noise('snow', 2, 3, 3);
    t.speckle('snow', 1, 8);
  },
  snow_side: (t) => grassSide(t, 'snow', 'stone'),
  ice: (t) => {
    t.noise('ice', 1, 2, 2);
    for (let k = 0; k < 4; k++) {
      const x0 = Math.floor(t.rng() * N), y0 = Math.floor(t.rng() * N);
      for (let i = 0; i < 5; i++) t.set((x0 + i) % N, (y0 + i) % N, C('ice', 3));
    }
  },
  water: (t) => {
    t.noise('water', 2, 3, 2);
    for (let k = 0; k < 7; k++) {
      const y = Math.floor(t.rng() * N), x0 = Math.floor(t.rng() * N);
      for (let i = 0; i < 4; i++) t.set((x0 + i) % N, y, C('water', 4));
    }
  },
  bedrock: (t) => {
    t.noise('ink', 0, 3, 6);
    t.speckle('deep', 2, 20);
  },
  deepstone: (t) => stone(t, 'deep', 1, 2),
  coal_ore: (t) => ore(t, 'ink', 1),
  copper_ore: (t) => ore(t, 'copper', 3),
  iron_ore: (t) => ore(t, 'iron', 3),
  stone_brick: (t) => bricks(t, 'stone', 8, 4, C('ink', 3)),
  mossy_brick: (t) => {
    bricks(t, 'stone', 8, 4, C('ink', 3));
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(t.rng() * N), y = Math.floor(t.rng() * t.rng() * N);
      t.set(x, y, C('moss', 3 + Math.floor(t.rng() * 2)));
    }
  },
  brick: (t) => bricks(t, 'brick', 4, 3, C('pale', 1)),
  workbench_top: (t) => {
    planks(t);
    for (let i = 2; i < 14; i++) {
      t.set(i, 2, C('ink', 2));
      t.set(i, 13, C('ink', 2));
      t.set(2, i, C('ink', 2));
      t.set(13, i, C('ink', 2));
    }
  },
  workbench_side: (t) => {
    planks(t);
    for (let y = 4; y < N; y++) {
      t.set(1, y, C('wood', 0));
      t.set(14, y, C('wood', 0));
    }
    for (let x = 4; x < 12; x++) t.set(x, 7, C('iron', 1));
    for (let y = 5; y < 10; y++) t.set(6, y, C('wood', 4));
  },
  forge_side: (t) => {
    cobble(t);
    for (let y = 8; y < 14; y++)
      for (let x = 4; x < 12; x++) {
        const edge = y === 8 || x === 4 || x === 11;
        t.set(x, y, edge ? C('ink', 0) : C('ember', 4 - Math.floor((y - 9) / 2)));
      }
  },
  forge_top: (t) => {
    cobble(t);
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, C('ember', (x + y) % 2 ? 3 : 2));
  },
  anvil: (t) => {
    t.noise('deep', 1, 2, 2);
    for (let x = 2; x < 14; x++) {
      t.set(x, 4, C('iron', 1));
      t.set(x, 5, C('stone', 4));
    }
    for (let y = 6; y < 12; y++) for (let x = 6; x < 10; x++) t.set(x, y, C('stone', 3));
    for (let x = 4; x < 12; x++) t.set(x, 12, C('stone', 3));
  },
  gold_grass_top: (t) => grassTop(t, 'gold'),
  gold_grass_side: (t) => grassSide(t, 'gold'),
  teal_grass_top: (t) => grassTop(t, 'teal'),
  teal_grass_side: (t) => grassSide(t, 'teal'),
  heather_top: (t) => {
    grassTop(t, 'heather');
    t.speckle('rose', 4, 10);
  },
  heather_side: (t) => grassSide(t, 'heather'),
  gold_leaves: (t) => leaves(t, 'gold'),
  teal_leaves: (t) => leaves(t, 'teal'),
  rose_leaves: (t) => leaves(t, 'rose'),
  pale_log_side: (t) => paleLogSide(t),
  pale_log_top: (t) => logTop(t, 'pale', 'pale'),
  moss_stone: (t) => {
    stone(t);
    for (let x = 0; x < N; x++) {
      const d = 1 + Math.floor(t.rng() * 4);
      for (let y = 0; y < d; y++) t.set(x, y, C('moss', 3 + (y === 0 ? 1 : 0)));
    }
    t.speckle('moss', 3, 10);
  },
  crystal: (t) => {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const band = Math.floor((x + y) / 4) % 3;
        t.set(x, y, C('crystal', 2 + band));
      }
    for (let i = 0; i < N; i++) {
      t.set(i, i, C('crystal', 5));
      t.set((i + 8) % N, i, C('crystal', 1));
    }
  },
  tall_grass: (t) => plant(t, (t) => blades(t, 'moss', 7, 8)),
  gold_tuft: (t) => plant(t, (t) => blades(t, 'gold', 7, 7)),
  fern: (t) =>
    plant(t, (t) => {
      for (let k = 0; k < 3; k++) {
        const x0 = 3 + k * 4;
        for (let i = 0; i < 11; i++) {
          const x = x0 + Math.round(Math.sin(i / 3) * 1.5);
          t.set(x, N - 1 - i, C('teal', 3));
          if (i % 2 === 0 && i > 2) {
            t.set(x - 1, N - 1 - i, C('teal', 4));
            t.set(x + 1, N - 1 - i, C('teal', 5));
          }
        }
      }
    }),
  flower_rose: (t) => plant(t, (t) => flower(t, 'rose')),
  flower_gold: (t) => plant(t, (t) => flower(t, 'gold')),
  flower_blue: (t) => plant(t, (t) => flower(t, 'glow', 'teal')),
  glowshroom: (t) =>
    plant(t, (t) => {
      for (const [cx, h, r] of [[5, 8, 3], [11, 5, 2]]) {
        for (let y = N - h; y < N; y++) t.set(cx, y, C('pale', 4));
        for (let dy = 0; dy <= r; dy++)
          for (let dx = -r + dy; dx <= r - dy; dx++) t.set(cx + dx, N - h - r + dy, C('glow', dy === 0 ? 4 : 3 - (dy > 1 ? 1 : 0)));
      }
    }),
  vines: (t) =>
    plant(t, (t) => {
      for (let k = 0; k < 5; k++) {
        const x = 1 + k * 3 + Math.floor(t.rng() * 2);
        const len = 8 + Math.floor(t.rng() * 8);
        for (let y = 0; y < len; y++) t.set(x, y, C('teal', y % 3 === 0 ? 5 : 3));
      }
    }),
  roots: (t) => {
    dirt(t);
    for (let k = 0; k < 4; k++) {
      let x = Math.floor(t.rng() * N);
      for (let y = 0; y < N; y++) {
        t.set(x, y, C('wood', 1));
        if (t.rng() < 0.3) x = (x + (t.rng() < 0.5 ? 1 : N - 1)) % N;
      }
    }
  },
  lantern: (t) => {
    for (let y = 2; y < 14; y++) for (let x = 4; x < 12; x++) t.set(x, y, C('ember', 4 - Math.floor(Math.abs(y - 8) / 3)));
    for (let i = 3; i < 13; i++) {
      t.set(i, 2, C('ink', 2));
      t.set(i, 13, C('ink', 2));
    }
    for (let y = 2; y < 14; y++) {
      t.set(4, y, C('ink', 2));
      t.set(11, y, C('ink', 2));
    }
  },
  bed_top: (t) => {
    // Quilt with a pale pillow at the head.
    t.noise('rose', 2, 3, 3);
    for (let y = 0; y < N; y += 4) for (let x = 0; x < N; x++) t.set(x, y, C('rose', 1));
    for (let x = 0; x < N; x += 4) for (let y = 0; y < N; y++) if (y % 4 !== 0) t.set(x, y, C('rose', 4));
    for (let y = 1; y < 5; y++) for (let x = 2; x < 14; x++) t.set(x, y, C('pale', y === 1 ? 4 : 3));
    for (let i = 0; i < N; i++) {
      t.set(i, 0, C('wood', 1));
      t.set(0, i, C('wood', 1));
      t.set(N - 1, i, C('wood', 1));
      t.set(i, N - 1, C('wood', 1));
    }
  },
  bed_side: (t) => {
    planks(t);
    for (let y = 0; y < 7; y++) for (let x = 0; x < N; x++) t.set(x, y, C('rose', y === 6 ? 1 : 3 - (x % 5 === 0 ? 1 : 0)));
    for (let y = 7; y < N; y++) {
      t.set(0, y, C('wood', 0));
      t.set(1, y, C('wood', 1));
      t.set(N - 1, y, C('wood', 0));
      t.set(N - 2, y, C('wood', 1));
    }
  },
  campfire: (t) =>
    plant(t, (t) => {
      // Crossed logs with a flame licking up between them.
      for (let x = 1; x < 15; x++) {
        t.set(x, 14, C('wood', 1));
        t.set(x, 15, C('wood', 0));
      }
      for (let x = 2; x < 14; x += 3) t.set(x, 14, C('wood', 3));
      const h = [0, 3, 6, 9, 11, 12, 11, 12, 10, 8, 5, 2, 0];
      for (let i = 0; i < h.length; i++)
        for (let y = 0; y < h[i]; y++) {
          const x = 2 + i;
          const f = y / Math.max(1, h[i]);
          t.set(x, 13 - y, C('ember', f < 0.3 ? 4 : f < 0.6 ? 3 : f < 0.85 ? 2 : 1));
        }
      for (let k = 0; k < 4; k++) t.set(4 + Math.floor(t.rng() * 8), Math.floor(t.rng() * 3), C('ember', 4));
    }),
  berry_bush: (t) =>
    plant(t, (t) => {
      for (let k = 0; k < 60; k++) {
        const a = t.rng() * Math.PI, r = Math.sqrt(t.rng()) * 7;
        t.set(8 + Math.round(Math.cos(a) * r), 15 - Math.round(Math.sin(a) * r * 1.1), C('moss', 2 + Math.floor(t.rng() * 3)));
      }
      for (let k = 0; k < 9; k++) {
        const a = t.rng() * Math.PI, r = 1 + t.rng() * 5;
        const x = 8 + Math.round(Math.cos(a) * r), y = 14 - Math.round(Math.sin(a) * r);
        t.set(x, y, C('rose', 4));
        t.set(x + 1, y, C('rose', 2));
      }
    }),
  marker_red: (t) => t.noise('rose', 3, 4),
  marker_yellow: (t) => t.noise('gold', 4, 5),
  marker_blue: (t) => t.noise('glow', 1, 2),
  marker_white: (t) => t.noise('pale', 3, 4),
};

export interface Atlas {
  texture: DataTexture;
  /** Average color per tile (distance LOD), as a tiny 16×16 texture. */
  average: DataTexture;
}

/** Paint every tile into a 256×256 atlas. Row 0 of each tile image is written at the top. */
export function buildAtlas(): Atlas {
  const W = ATLAS_TILES * N;
  const data = new Uint8Array(W * W * 4);
  const avg = new Uint8Array(ATLAS_TILES * ATLAS_TILES * 4);
  (Object.keys(PAINTERS) as TileName[]).forEach((name) => {
    const index = TILE[name];
    const t = new Tile(mulberry32(index * 7919 + 17));
    PAINTERS[name](t);
    const col = index % ATLAS_TILES, row = Math.floor(index / ATLAS_TILES);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const s = (y * N + x) * 4;
        // Texture v grows upward, so flip the tile vertically.
        const d = ((row * N + (N - 1 - y)) * W + col * N + x) * 4;
        for (let k = 0; k < 4; k++) data[d + k] = t.px[s + k];
        if (t.px[s + 3] > 127) {
          r += t.px[s];
          g += t.px[s + 1];
          b += t.px[s + 2];
          n++;
        }
      }
    const a = (row * ATLAS_TILES + col) * 4;
    avg[a] = r / Math.max(1, n);
    avg[a + 1] = g / Math.max(1, n);
    avg[a + 2] = b / Math.max(1, n);
    avg[a + 3] = n > N * N * 0.5 ? 255 : 0;
  });
  const make = (arr: Uint8Array, size: number) => {
    const tex = new DataTexture(arr, size, size, RGBAFormat, UnsignedByteType);
    tex.magFilter = tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };
  return { texture: make(data, W), average: make(avg, ATLAS_TILES) };
}
