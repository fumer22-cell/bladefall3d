import { SOLID, FRICTION } from './blocks';
import { Chunk, chunkKey, CS } from './chunk';

/** Read-only voxel queries used by collision and movement. */
export interface VoxelQuery {
  getBlock(x: number, y: number, z: number): number;
  isSolid(x: number, y: number, z: number): boolean;
}

export class World implements VoxelQuery {
  readonly chunks = new Map<string, Chunk>();
  /** Chunks whose mesh must be rebuilt. */
  readonly dirty = new Set<string>();

  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    const cx = Math.floor(x / CS);
    const cy = Math.floor(y / CS);
    const cz = Math.floor(z / CS);
    const c = this.chunks.get(chunkKey(cx, cy, cz));
    if (!c) return 0;
    return c.get(x - cx * CS, y - cy * CS, z - cz * CS);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return SOLID[this.getBlock(x, y, z)] === 1;
  }

  friction(x: number, y: number, z: number): number {
    return FRICTION[this.getBlock(x, y, z)];
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    const cx = Math.floor(x / CS);
    const cy = Math.floor(y / CS);
    const cz = Math.floor(z / CS);
    const key = chunkKey(cx, cy, cz);
    let c = this.chunks.get(key);
    if (!c) {
      if (id === 0) return;
      c = new Chunk(cx, cy, cz);
      this.chunks.set(key, c);
    }
    const lx = x - cx * CS;
    const ly = y - cy * CS;
    const lz = z - cz * CS;
    if (c.get(lx, ly, lz) === id) return;
    c.set(lx, ly, lz, id);
    this.dirty.add(key);
    // Faces on chunk borders belong to the neighbor too.
    if (lx === 0) this.markDirty(cx - 1, cy, cz);
    if (lx === CS - 1) this.markDirty(cx + 1, cy, cz);
    if (ly === 0) this.markDirty(cx, cy - 1, cz);
    if (ly === CS - 1) this.markDirty(cx, cy + 1, cz);
    if (lz === 0) this.markDirty(cx, cy, cz - 1);
    if (lz === CS - 1) this.markDirty(cx, cy, cz + 1);
  }

  /** Fill an inclusive box of blocks. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.setBlock(x, y, z, id);
  }

  private markDirty(cx: number, cy: number, cz: number): void {
    const key = chunkKey(cx, cy, cz);
    if (this.chunks.has(key)) this.dirty.add(key);
  }

  /**
   * Copy a chunk plus a 1-block border from its neighbors into an (CS+2)³ array,
   * so the mesher (later: in a worker) needs no world access.
   */
  buildPadded(cx: number, cy: number, cz: number, out = new Uint16Array((CS + 2) ** 3)): Uint16Array {
    const P = CS + 2;
    const bx = cx * CS - 1;
    const by = cy * CS - 1;
    const bz = cz * CS - 1;
    const center = this.getChunk(cx, cy, cz);
    for (let y = 0; y < P; y++)
      for (let z = 0; z < P; z++)
        for (let x = 0; x < P; x++) {
          const inside = x > 0 && x <= CS && y > 0 && y <= CS && z > 0 && z <= CS;
          out[x + z * P + y * P * P] =
            inside && center ? center.get(x - 1, y - 1, z - 1) : this.getBlock(bx + x, by + y, bz + z);
        }
    return out;
  }
}
