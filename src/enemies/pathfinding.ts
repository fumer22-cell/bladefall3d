import { ENEMIES } from '../config';
import type { VoxelQuery } from '../world/world';

export interface PathNode {
  x: number;
  y: number;
  z: number;
}

/** A cell a 2-tall walker can stand in: two clear blocks with something solid underneath. */
export function standable(w: VoxelQuery, x: number, y: number, z: number): boolean {
  return !w.isSolid(x, y, z) && !w.isSolid(x, y + 1, z) && w.isSolid(x, y - 1, z);
}

/** Find the standable cell at or just below (x, y, z), dropping up to `maxDrop` blocks. */
export function groundBelow(w: VoxelQuery, x: number, y: number, z: number, maxDrop = 4): number | null {
  for (let d = 0; d <= maxDrop; d++) if (standable(w, x, y - d, z)) return y - d;
  return null;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

class MinHeap {
  private a: { f: number; k: string }[] = [];
  get size(): number {
    return this.a.length;
  }
  push(f: number, k: string): void {
    const a = this.a;
    a.push({ f, k });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): string {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.k;
  }
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * A* over the voxel grid for a 2-tall walker. Moves: 8-way walking (diagonals only if both
 * sides are clear), stepping/jumping up 1 block, dropping down up to 3, and jumping a 1-block
 * gap. Returns waypoints from start to goal (exclusive of start), or the path to the closest
 * reached node if the goal is unreachable within the node budget.
 */
export function findPath(w: VoxelQuery, start: PathNode, goal: PathNode, budget: number = ENEMIES.PATH_BUDGET): PathNode[] | null {
  if (!standable(w, start.x, start.y, start.z)) {
    const g = groundBelow(w, start.x, start.y, start.z, 2);
    if (g === null) return null;
    start = { x: start.x, y: g, z: start.z };
  }
  const h = (x: number, y: number, z: number) => Math.hypot(x - goal.x, (y - goal.y) * 1.5, z - goal.z);
  const open = new MinHeap();
  const g = new Map<string, number>();
  const came = new Map<string, string>();
  const nodes = new Map<string, PathNode>();
  const sk = key(start.x, start.y, start.z);
  g.set(sk, 0);
  nodes.set(sk, start);
  open.push(h(start.x, start.y, start.z), sk);
  let best = sk, bestH = h(start.x, start.y, start.z);
  let expanded = 0;

  while (open.size > 0 && expanded < budget) {
    const ck = open.pop();
    const c = nodes.get(ck)!;
    expanded++;
    const ch = h(c.x, c.y, c.z);
    if (ch < bestH) {
      bestH = ch;
      best = ck;
    }
    if (c.x === goal.x && c.z === goal.z && Math.abs(c.y - goal.y) <= 1) {
      best = ck;
      break;
    }
    const gc = g.get(ck)!;
    const tryNode = (x: number, y: number, z: number, cost: number) => {
      const k = key(x, y, z);
      const ng = gc + cost;
      if (ng >= (g.get(k) ?? Infinity)) return;
      g.set(k, ng);
      came.set(k, ck);
      nodes.set(k, { x, y, z });
      open.push(ng + h(x, y, z), k);
    };
    for (const [dx, dz] of DIRS) {
      const nx = c.x + dx, nz = c.z + dz;
      const diag = dx !== 0 && dz !== 0;
      if (diag && (!clear2(w, c.x + dx, c.y, c.z) || !clear2(w, c.x, c.y, c.z + dz))) continue;
      const step = diag ? 1.414 : 1;
      if (standable(w, nx, c.y, nz)) {
        tryNode(nx, c.y, nz, step);
        continue;
      }
      // Step/jump up one block (needs headroom above us).
      if (standable(w, nx, c.y + 1, nz) && !w.isSolid(c.x, c.y + 2, c.z)) {
        tryNode(nx, c.y + 1, nz, step + 0.8);
        continue;
      }
      // Drop down up to 3.
      if (clear2(w, nx, c.y, nz)) {
        const down = groundBelow(w, nx, c.y, nz, 3);
        if (down !== null) {
          tryNode(nx, down, nz, step + (c.y - down) * 0.3);
          continue;
        }
        // Jump a one-block gap (cardinal only).
        if (!diag && clear2(w, nx, c.y + 1, nz) && standable(w, nx + dx, c.y, nz + dz)) tryNode(nx + dx, c.y, nz + dz, 2.6);
      }
    }
  }

  if (best === sk) return null;
  const path: PathNode[] = [];
  for (let k: string | undefined = best; k && k !== sk; k = came.get(k)) path.push(nodes.get(k)!);
  return path.reverse();
}

function clear2(w: VoxelQuery, x: number, y: number, z: number): boolean {
  return !w.isSolid(x, y, z) && !w.isSolid(x, y + 1, z);
}
