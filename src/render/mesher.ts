import { COLOR, SOLID } from '../world/blocks';
import { CS } from '../world/chunk';

export interface MeshData {
  /** Chunk-local vertex positions. */
  positions: Float32Array;
  normals: Float32Array;
  /** Per-vertex RGB in [0, 1] (sRGB, written straight to the framebuffer). */
  colors: Float32Array;
  indices: Uint32Array;
}

const P = CS + 2;

/**
 * Greedy mesher. Input is a chunk padded with a 1-block border from its neighbors
 * ((CS+2)³, see World.buildPadded). Adjacent coplanar faces of the same block type are merged
 * into single quads. Pure function with no world access so it can move into a worker.
 */
export function greedyMesh(padded: Uint16Array): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const mask = new Int32Array(CS * CS);
  const x = [0, 0, 0];
  const q = [0, 0, 0];

  const get = (px: number, py: number, pz: number) => padded[px + 1 + (pz + 1) * P + (py + 1) * P * P];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    q[0] = q[1] = q[2] = 0;
    q[d] = 1;

    for (x[d] = -1; x[d] < CS; ) {
      // Build the face mask for the plane between layer x[d] and x[d]+1.
      let n = 0;
      for (x[v] = 0; x[v] < CS; x[v]++) {
        for (x[u] = 0; x[u] < CS; x[u]++, n++) {
          const a = get(x[0], x[1], x[2]);
          const b = get(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
          const sa = SOLID[a], sb = SOLID[b];
          if (sa === sb) mask[n] = 0;
          // Face of `a` pointing +d: only ours if `a` is inside this chunk.
          else if (sa) mask[n] = x[d] >= 0 ? a : 0;
          // Face of `b` pointing -d: only ours if `b` is inside this chunk.
          else mask[n] = x[d] < CS - 1 ? -b : 0;
        }
      }
      x[d]++;

      // Merge the mask into rectangles.
      n = 0;
      for (let j = 0; j < CS; j++) {
        for (let i = 0; i < CS; ) {
          const c = mask[n];
          if (c === 0) {
            i++;
            n++;
            continue;
          }
          let w = 1;
          while (i + w < CS && mask[n + w] === c) w++;
          let h = 1;
          outer: for (; j + h < CS; h++) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * CS] !== c) break outer;
          }

          const base = [0, 0, 0];
          base[d] = x[d];
          base[u] = i;
          base[v] = j;
          const du = [0, 0, 0];
          du[u] = w;
          const dv = [0, 0, 0];
          dv[v] = h;

          const vi = positions.length / 3;
          positions.push(
            base[0], base[1], base[2],
            base[0] + du[0], base[1] + du[1], base[2] + du[2],
            base[0] + du[0] + dv[0], base[1] + du[1] + dv[1], base[2] + du[2] + dv[2],
            base[0] + dv[0], base[1] + dv[1], base[2] + dv[2],
          );
          const sign = c > 0 ? 1 : -1;
          const nx = d === 0 ? sign : 0, ny = d === 1 ? sign : 0, nz = d === 2 ? sign : 0;
          const hex = COLOR[Math.abs(c)];
          const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, bl = (hex & 255) / 255;
          for (let k = 0; k < 4; k++) {
            normals.push(nx, ny, nz);
            colors.push(r, g, bl);
          }
          // u × v = +d, so (0,1,2) is counter-clockwise seen from +d.
          if (sign > 0) indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          else indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);

          for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[n + k + hh * CS] = 0;
          i += w;
          n += w;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
