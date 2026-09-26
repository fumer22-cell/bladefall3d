import { BLOCK_TILES, COLOR, EMISSION, OPAQUE, SHAPE } from '../world/blocks';
import { CS } from '../world/chunk';

export interface MeshData {
  /** Chunk-local vertex positions. */
  positions: Float32Array;
  normals: Float32Array;
  /** Per-vertex RGB in [0, 1] (sRGB). */
  colors: Float32Array;
  /** Per-vertex (sky, block) light in [0, 1]. */
  light: Float32Array;
  /** Per-vertex ambient-occlusion level 0–3 (number of occluding neighbors). */
  ao: Float32Array;
  /** Texture coordinates in block units (the shader wraps them per tile). */
  uv: Float32Array;
  /** Atlas tile per vertex (−1 = flat vertex color). */
  tile: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshes {
  opaque: MeshData;
  water: MeshData;
}

const P = CS + 2;
const WATER_SURFACE_DROP = 0.12;

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  light: number[] = [];
  ao: number[] = [];
  uv: number[] = [];
  tile: number[] = [];
  indices: number[] = [];

  /**
   * Add a quad with corners v0..v3 (counter-clockwise seen from the front).
   * Textured quads (tile ≥ 0) get UVs from their positions (side faces keep v = world up)
   * unless `uvs` is given; untextured ones use `color`.
   */
  quad(v: number[], n: [number, number, number], color: number, sky: number, blk: number, ao: number[], tile = -1, uvs?: number[]): void {
    const vi = this.positions.length / 3;
    this.positions.push(...v);
    const textured = tile >= 0;
    const r = textured ? 1 : ((color >> 16) & 255) / 255;
    const g = textured ? 1 : ((color >> 8) & 255) / 255;
    const b = textured ? 1 : (color & 255) / 255;
    for (let k = 0; k < 4; k++) {
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(r, g, b);
      this.light.push(sky / 15, blk / 15);
      this.ao.push(ao[k]);
      this.tile.push(tile);
      if (uvs) this.uv.push(uvs[k * 2], uvs[k * 2 + 1]);
      else {
        const x = v[k * 3], y = v[k * 3 + 1], z = v[k * 3 + 2];
        if (n[0] !== 0) this.uv.push(n[0] > 0 ? -z : z, y);
        else if (n[2] !== 0) this.uv.push(n[2] > 0 ? x : -x, y);
        else this.uv.push(x, n[1] > 0 ? -z : z);
      }
    }
    // Split along the diagonal with less AO contrast so gradients don't look creased.
    if (ao[0] + ao[2] < ao[1] + ao[3]) this.indices.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
    else this.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  /** Axis-aligned box with every face lit uniformly (small models like torches). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, sky: number, blk: number): void {
    const z = [0, 0, 0, 0];
    this.quad([x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1], [1, 0, 0], color, sky, blk, z);
    this.quad([x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0], [-1, 0, 0], color, sky, blk, z);
    this.quad([x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0], [0, 1, 0], color, sky, blk, z);
    this.quad([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], [0, -1, 0], color, sky, blk, z);
    this.quad([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 0, 1], color, sky, blk, z);
    this.quad([x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], [0, 0, -1], color, sky, blk, z);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors),
      light: new Float32Array(this.light),
      ao: new Float32Array(this.ao),
      uv: new Float32Array(this.uv),
      tile: new Float32Array(this.tile),
      indices: new Uint32Array(this.indices),
    };
  }
}

/**
 * Greedy mesher. Input is a chunk padded with a 1-block border ((CS+2)³ blocks + packed light,
 * see World.buildPadded). Coplanar faces with the same block, light and AO are merged into
 * single quads. Pure function with no world access so it runs in a worker.
 */
export function greedyMesh(blocks: Uint16Array, light: Uint8Array): ChunkMeshes {
  const idx = (x: number, y: number, z: number) => x + 1 + (z + 1) * P + (y + 1) * P * P;
  const opaque = new Builder();
  const water = new Builder();

  meshPass(blocks, light, idx, opaque, false);
  meshPass(blocks, light, idx, water, true);

  // Torches and plants: small non-greedy models.
  for (let y = 0; y < CS; y++)
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const i = idx(x, y, z);
        const id = blocks[i];
        const shape = SHAPE[id];
        if (shape === 'torch') {
          const l = light[i];
          opaque.box(x + 0.44, y, z + 0.44, x + 0.56, y + 0.55, z + 0.56, 0x523318, l >> 4, l & 15);
          opaque.box(x + 0.41, y + 0.55, z + 0.41, x + 0.59, y + 0.72, z + 0.59, COLOR[id], 15, 15);
        } else if (shape === 'plant') {
          const l = light[i];
          const tile = BLOCK_TILES[id * 3 + 1];
          // Hash-jitter plants a little so fields of them don't look gridded.
          const h = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
          const ox = ((h & 15) / 15 - 0.5) * 0.3, oz = (((h >> 4) & 15) / 15 - 0.5) * 0.3;
          const x0 = x + 0.12 + ox, x1 = x + 0.88 + ox, z0 = z + 0.12 + oz, z1 = z + 0.88 + oz, y1 = y + 1;
          const uv = [0, 0, 1, 0, 1, 1, 0, 1];
          const up: [number, number, number] = [0, 1, 0];
          const flat = [0, 0, 0, 0];
          // Two crossed quads, each emitted with both windings (visible from both sides).
          for (const q of [
            [x0, y, z0, x1, y, z1, x1, y1, z1, x0, y1, z0],
            [x1, y, z1, x0, y, z0, x0, y1, z0, x1, y1, z1],
            [x0, y, z1, x1, y, z0, x1, y1, z0, x0, y1, z1],
            [x1, y, z0, x0, y, z1, x0, y1, z1, x1, y1, z0],
          ]) opaque.quad(q, up, 0, l >> 4, EMISSION[id] > 0 ? 15 : l & 15, flat, tile, uv);
        }
      }

  return { opaque: opaque.build(), water: water.build() };
}

function meshPass(
  blocks: Uint16Array,
  light: Uint8Array,
  idx: (x: number, y: number, z: number) => number,
  out: Builder,
  waterPass: boolean,
): void {
  const maskKey = new Uint32Array(CS * CS);
  const maskDir = new Int8Array(CS * CS);
  const maskId = new Uint16Array(CS * CS);
  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const f = [0, 0, 0];

  // Does a block of this id show a face toward a neighbor of id `nb`?
  const shows = (id: number, nb: number): boolean => {
    if (waterPass) return SHAPE[id] === 'water' && SHAPE[nb] !== 'water' && OPAQUE[nb] === 0;
    return OPAQUE[id] === 1 && OPAQUE[nb] === 0;
  };
  const occ = (px: number, py: number, pz: number) => OPAQUE[blocks[idx(px, py, pz)]];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    q[0] = q[1] = q[2] = 0;
    q[d] = 1;

    for (x[d] = -1; x[d] < CS; ) {
      let n = 0;
      for (x[v] = 0; x[v] < CS; x[v]++) {
        for (x[u] = 0; x[u] < CS; x[u]++, n++) {
          const a = blocks[idx(x[0], x[1], x[2])];
          const b = blocks[idx(x[0] + q[0], x[1] + q[1], x[2] + q[2])];
          let dir = 0;
          let id = 0;
          // Face of `a` pointing +d (ours if `a` is inside this chunk); face of `b` pointing -d.
          if (x[d] >= 0 && shows(a, b)) { dir = 1; id = a; }
          else if (x[d] < CS - 1 && shows(b, a)) { dir = -1; id = b; }
          maskDir[n] = dir;
          if (dir === 0) continue;

          // The cell in front of the face supplies light and AO.
          f[0] = x[0]; f[1] = x[1]; f[2] = x[2];
          if (dir > 0) f[d] += 1;
          const l = light[idx(f[0], f[1], f[2])];
          let aoPack = 0;
          if (!waterPass) {
            const o = (du: number, dv: number) => {
              const c = [f[0], f[1], f[2]];
              c[u] += du;
              c[v] += dv;
              return occ(c[0], c[1], c[2]);
            };
            const s0 = o(-1, 0), s1 = o(1, 0), t0 = o(0, -1), t1 = o(0, 1);
            const corner = (su: number, sv: number, cu: number, cv: number) =>
              su && sv ? 3 : su + sv + o(cu, cv);
            // Vertex order: (0,0), (1,0), (1,1), (0,1) in (u, v).
            aoPack =
              corner(s0, t0, -1, -1) | (corner(s1, t0, 1, -1) << 2) | (corner(s1, t1, 1, 1) << 4) | (corner(s0, t1, -1, 1) << 6);
          }
          maskKey[n] = (l | (aoPack << 8)) >>> 0;
          maskId[n] = id;
        }
      }
      x[d]++;

      n = 0;
      for (let j = 0; j < CS; j++) {
        for (let i = 0; i < CS; ) {
          const dir = maskDir[n];
          if (dir === 0) {
            i++;
            n++;
            continue;
          }
          const key = maskKey[n], id = maskId[n];
          const same = (m: number) => maskDir[m] === dir && maskKey[m] === key && maskId[m] === id;
          let w = 1;
          while (i + w < CS && same(n + w)) w++;
          let h = 1;
          outer: for (; j + h < CS; h++) {
            for (let k = 0; k < w; k++) if (!same(n + k + h * CS)) break outer;
          }

          const base = [0, 0, 0];
          base[d] = x[d];
          base[u] = i;
          base[v] = j;
          if (waterPass && d === 1 && dir > 0) base[1] -= WATER_SURFACE_DROP;
          const du = [0, 0, 0];
          du[u] = w;
          const dv = [0, 0, 0];
          dv[v] = h;
          const verts = [
            base[0], base[1], base[2],
            base[0] + du[0], base[1] + du[1], base[2] + du[2],
            base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2],
            base[0] + dv[0], base[1] + dv[1], base[2] + dv[2],
          ];
          const normal: [number, number, number] = [0, 0, 0];
          normal[d] = dir;
          const ao = [key >> 8 & 3, key >> 10 & 3, key >> 12 & 3, key >> 14 & 3];
          const l = key & 255;
          const tile = BLOCK_TILES[id * 3 + (d === 1 ? (dir > 0 ? 0 : 2) : 1)];
          // Glowing blocks are drawn fully lit by their own light.
          const blk = EMISSION[id] > 0 ? 15 : l & 15;
          if (dir > 0) out.quad(verts, normal, COLOR[id], l >> 4, blk, ao, tile);
          else {
            // Reverse winding for faces pointing -d (and keep AO attached to the same corners).
            out.quad(
              [verts[0], verts[1], verts[2], verts[9], verts[10], verts[11], verts[6], verts[7], verts[8], verts[3], verts[4], verts[5]],
              normal, COLOR[id], l >> 4, blk, [ao[0], ao[3], ao[2], ao[1]], tile,
            );
          }

          for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) maskDir[n + k + hh * CS] = 0;
          i += w;
          n += w;
        }
      }
    }
  }
}
