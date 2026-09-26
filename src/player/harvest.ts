import { BUILD } from '../config';
import { BLOCKS, Block, SHAPE, SMOOTH } from '../world/blocks';
import type { World } from '../world/world';

export interface BlockAt {
  x: number;
  y: number;
  z: number;
  id: number;
}

const LOGS = new Set<number>([Block.LOG, Block.PALE_LOG]);
const LEAVES = new Set<number>([Block.LEAVES, Block.GOLD_LEAVES, Block.TEAL_LEAVES, Block.ROSE_LEAVES]);

export const isLog = (id: number) => LOGS.has(id);

/** Natural terrain that area-mining may take (never built blocks). */
export function isNatural(id: number): boolean {
  return (SMOOTH[id] === 1 && !LOGS.has(id)) || SHAPE[id] === 'plant';
}

/**
 * Blocks a pickaxe breaks alongside the one it hit: a (2r+1)² patch across the hit face, `depth`
 * deep into it. Only natural blocks the tool can mine, never player-placed ones.
 */
export function areaTargets(
  world: World,
  hit: { x: number; y: number; z: number; nx: number; ny: number; nz: number },
  tool: { tier: number; area: readonly [number, number] },
): BlockAt[] {
  const [r, depth] = tool.area;
  const out: BlockAt[] = [];
  const hitId = world.getBlock(hit.x, hit.y, hit.z);
  if (!isNatural(hitId) || (r === 0 && depth <= 1)) return out;
  // Two axes spanning the hit face, and the axis going into it.
  const n = [hit.nx, hit.ny, hit.nz];
  const u = n[0] !== 0 ? [0, 1, 0] : [1, 0, 0];
  const v = n[2] !== 0 ? [0, 1, 0] : n[1] !== 0 ? [0, 0, 1] : [0, 0, 1];
  for (let d = 0; d < depth; d++)
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++) {
        if (a === 0 && b === 0 && d === 0) continue;
        const x = hit.x + u[0] * a + v[0] * b - n[0] * d;
        const y = hit.y + u[1] * a + v[1] * b - n[1] * d;
        const z = hit.z + u[2] * a + v[2] * b - n[2] * d;
        const id = world.getBlock(x, y, z);
        if (id === 0 || !isNatural(id) || !Number.isFinite(BLOCKS[id].hardness)) continue;
        if (BLOCKS[id].tier > tool.tier || world.isPlayerPlaced(x, y, z)) continue;
        out.push({ x, y, z, id });
      }
  return out;
}

/**
 * The rest of a tree above a chopped log: connected natural logs (not below the cut) plus the
 * leaves around them. Empty if the log was player-placed.
 */
export function findTree(world: World, x: number, y: number, z: number): BlockAt[] {
  if (world.isPlayerPlaced(x, y, z)) return [];
  const logs: BlockAt[] = [];
  const seen = new Set<string>([`${x},${y},${z}`]);
  const queue: [number, number, number][] = [[x, y, z]];
  while (queue.length && logs.length < BUILD.TREE_MAX_LOGS) {
    const [cx, cy, cz] = queue.shift()!;
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (ny < y) continue; // only what's above the cut comes down
          const k = `${nx},${ny},${nz}`;
          if (seen.has(k)) continue;
          const id = world.getBlock(nx, ny, nz);
          if (!LOGS.has(id) || world.isPlayerPlaced(nx, ny, nz)) continue;
          seen.add(k);
          logs.push({ x: nx, y: ny, z: nz, id });
          queue.push([nx, ny, nz]);
        }
  }
  // Leaves: flood out from the trunk through leaves, up to TREE_LEAF_REACH steps.
  const leaves: BlockAt[] = [];
  const trunk = [{ x, y, z }, ...logs];
  let frontier: [number, number, number][] = trunk.map((b) => [b.x, b.y, b.z]);
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let step = 0; step < BUILD.TREE_LEAF_REACH && frontier.length; step++) {
    const next: [number, number, number][] = [];
    for (const [fx, fy, fz] of frontier)
      for (const [dx, dy, dz] of DIRS) {
        const nx = fx + dx, ny = fy + dy, nz = fz + dz;
        const k = `${nx},${ny},${nz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = world.getBlock(nx, ny, nz);
        if (!LEAVES.has(id) && id !== Block.VINES) continue;
        if (world.isPlayerPlaced(nx, ny, nz) || leaves.length >= BUILD.TREE_MAX_LEAVES) continue;
        leaves.push({ x: nx, y: ny, z: nz, id });
        next.push([nx, ny, nz]);
      }
    frontier = next;
  }
  // A lone leafless stump piece isn't a tree.
  if (logs.length === 0 && leaves.length === 0) return [];
  return [...logs, ...leaves];
}
