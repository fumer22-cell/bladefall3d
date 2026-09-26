import { Block, EMISSION, FRICTION, LIGHT_ATTEN, SOLID } from './blocks';
import { CHUNKS_Y, CS, Column, WORLD_H, chunkId, colIndex, colKey } from './chunk';
import { BLK, SKY, computeColumnLight, decrease, getCh, increase, setCh, type LightAccess } from './lighting';

/** Read-only voxel queries used by collision and movement. */
export interface VoxelQuery {
  getBlock(x: number, y: number, z: number): number;
  isSolid(x: number, y: number, z: number): boolean;
}

const FULL_SKY = 0xf0;

export class World implements VoxelQuery {
  readonly columns = new Map<number, Column>();
  /** Chunk ids whose mesh must be rebuilt. */
  readonly dirty = new Set<number>();
  /** Player edits per column (colIndex → block id), reapplied when a column is regenerated. */
  readonly edits = new Map<number, Map<number, number>>();
  /** Record edits made through setBlock (on for streamed worlds). */
  recordEdits = false;

  private lastKey = NaN;
  private lastCol: Column | undefined;

  /** Light access over lit, loaded columns; light never spreads into unloaded/unlit ones. */
  readonly lightAccess: LightAccess = {
    block: (x, y, z) => {
      if (y < 0 || y >= WORLD_H) return -1;
      const c = this.columnAt(x, z);
      if (!c || !c.lit) return -1;
      return c.blocks[colIndex(x & 15, y, z & 15)];
    },
    light: (x, y, z) => this.getLight(x, y, z),
    setLight: (x, y, z, v) => this.setLight(x, y, z, v),
  };

  column(cx: number, cz: number): Column | undefined {
    const key = colKey(cx, cz);
    if (key === this.lastKey) return this.lastCol;
    const c = this.columns.get(key);
    this.lastKey = key;
    this.lastCol = c;
    return c;
  }

  columnAt(x: number, z: number): Column | undefined {
    return this.column(x >> 4, z >> 4);
  }

  isLoaded(x: number, z: number): boolean {
    return this.columnAt(x, z) !== undefined;
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return Block.BEDROCK;
    if (y >= WORLD_H) return 0;
    const c = this.columnAt(x, z);
    return c ? c.blocks[colIndex(x & 15, y, z & 15)] : 0;
  }

  /** Unloaded space and the world floor count as solid, so nothing falls out of the world while it streams in. */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (y >= WORLD_H) return false;
    const c = this.columnAt(x, z);
    return c ? SOLID[c.blocks[colIndex(x & 15, y, z & 15)]] === 1 : true;
  }

  friction(x: number, y: number, z: number): number {
    return FRICTION[this.getBlock(x, y, z)];
  }

  /** Packed light (sky << 4 | block). Unloaded or above the world: full sky. */
  getLight(x: number, y: number, z: number): number {
    if (y >= WORLD_H) return FULL_SKY;
    if (y < 0) return 0;
    const c = this.columnAt(x, z);
    return c ? c.light[colIndex(x & 15, y, z & 15)] : FULL_SKY;
  }

  private setLight(x: number, y: number, z: number, v: number): void {
    const c = this.columnAt(x, z);
    if (!c) return;
    const i = colIndex(x & 15, y, z & 15);
    if (c.light[i] === v) return;
    c.light[i] = v;
    this.markDirtyAround(x, y, z);
  }

  addColumn(c: Column): void {
    this.columns.set(colKey(c.cx, c.cz), c);
    this.lastKey = NaN;
    for (let cy = 0; cy < CHUNKS_Y; cy++) if (c.counts[cy] > 0) this.dirty.add(chunkId(c.cx, cy, c.cz));
    if (c.lit) this.stitchLight(c.cx, c.cz);
  }

  removeColumn(cx: number, cz: number): void {
    this.columns.delete(colKey(cx, cz));
    this.lastKey = NaN;
    for (let cy = 0; cy < CHUNKS_Y; cy++) this.dirty.delete(chunkId(cx, cy, cz));
  }

  /** Are this column and all 8 neighbors loaded (so its meshes can be built with correct borders)? */
  neighborhoodLoaded(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.column(cx + dx, cz + dz)) return false;
    return true;
  }

  /** Was the block here placed by the player (vs. generated)? */
  isPlayerPlaced(x: number, y: number, z: number): boolean {
    if (y < 0 || y >= WORLD_H) return false;
    const e = this.edits.get(colKey(x >> 4, z >> 4));
    if (!e) return false;
    const id = e.get(colIndex(x & 15, y, z & 15));
    return id !== undefined && id !== 0 && id === this.getBlock(x, y, z);
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_H) return;
    let c = this.columnAt(x, z);
    if (!c) {
      if (id === 0) return;
      c = new Column(x >> 4, z >> 4);
      this.columns.set(colKey(c.cx, c.cz), c);
      this.lastKey = NaN;
    }
    const lx = x & 15, lz = z & 15;
    const i = colIndex(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return;
    c.blocks[i] = id;
    const cy = y >> 4;
    if (old === 0) c.counts[cy]++;
    else if (id === 0) c.counts[cy]--;
    this.markDirtyAround(x, y, z);
    if (this.recordEdits) {
      const key = colKey(c.cx, c.cz);
      let e = this.edits.get(key);
      if (!e) this.edits.set(key, (e = new Map()));
      e.set(i, id);
    }
    if (c.lit) this.relightAfterEdit(x, y, z, old, id);
  }

  /** Fill an inclusive box of blocks. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.setBlock(x, y, z, id);
  }

  /** Light every column from scratch (for hand-built worlds like the test arena). */
  lightAll(): void {
    for (const c of this.columns.values()) {
      computeColumnLight(c.blocks, c.light);
      c.lit = true;
    }
    for (const c of this.columns.values()) this.stitchLight(c.cx, c.cz);
    for (const c of this.columns.values())
      for (let cy = 0; cy < CHUNKS_Y; cy++) if (c.counts[cy] > 0) this.dirty.add(chunkId(c.cx, cy, c.cz));
  }

  /** Let light flow across the borders between a newly lit column and its lit neighbors. */
  stitchLight(cx: number, cz: number): void {
    const skyQ: number[] = [];
    const blkQ: number[] = [];
    const x0 = cx * CS, z0 = cz * CS;
    // Only pairs whose light differs by more than one step can flow; most border cells already match.
    const pair = (ax: number, az: number, bx: number, bz: number, y: number) => {
      const la = this.getLight(ax, y, az), lb = this.getLight(bx, y, bz);
      const sa = la >> 4, sb = lb >> 4;
      if (sa > sb + 1) skyQ.push(ax, y, az);
      else if (sb > sa + 1) skyQ.push(bx, y, bz);
      const ba = la & 15, bb = lb & 15;
      if (ba > bb + 1) blkQ.push(ax, y, az);
      else if (bb > ba + 1) blkQ.push(bx, y, bz);
    };
    const sides: [number, number, number, number][] = [
      // [neighbor dx, dz, inside edge offset, outside edge offset]
      [-1, 0, 0, -1], [1, 0, CS - 1, CS], [0, -1, 0, -1], [0, 1, CS - 1, CS],
    ];
    for (const [dx, dz, inner, outer] of sides) {
      const n = this.column(cx + dx, cz + dz);
      if (!n || !n.lit) continue;
      for (let y = 0; y < WORLD_H; y++)
        for (let k = 0; k < CS; k++) {
          if (dx !== 0) pair(x0 + inner, z0 + k, x0 + outer, z0 + k, y);
          else pair(x0 + k, z0 + inner, x0 + k, z0 + outer, y);
        }
    }
    increase(this.lightAccess, skyQ, SKY);
    increase(this.lightAccess, blkQ, BLK);
  }

  private relightAfterEdit(x: number, y: number, z: number, oldId: number, newId: number): void {
    const a = this.lightAccess;
    const oldAtt = LIGHT_ATTEN[oldId], newAtt = LIGHT_ATTEN[newId];
    const oldEm = EMISSION[oldId], newEm = EMISSION[newId];
    const l = this.getLight(x, y, z);

    for (const ch of [SKY, BLK] as const) {
      const lvl = getCh(l, ch);
      const lostEmitter = ch === BLK && oldEm > 0 && newEm < oldEm;
      if ((newAtt > oldAtt || lostEmitter) && lvl > 0) {
        // Darker than before: remove light that flowed through this cell, then refill.
        this.setLight(x, y, z, setCh(this.getLight(x, y, z), ch, 0));
        decrease(a, [x, y, z, lvl], ch);
      } else if (newAtt < oldAtt) {
        // Opened up: neighbors flow into this cell.
        const q: number[] = [];
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          if (getCh(this.getLight(x + dx, y + dy, z + dz), ch) > 1) q.push(x + dx, y + dy, z + dz);
        }
        increase(a, q, ch);
      }
    }
    if (newEm > 0) {
      const cur = this.getLight(x, y, z);
      if ((cur & 15) < newEm) {
        this.setLight(x, y, z, setCh(cur, BLK, newEm));
        increase(a, [x, y, z], BLK);
      }
    }
  }

  private markDirtyAround(x: number, y: number, z: number): void {
    const cx = x >> 4, cy = y >> 4, cz = z >> 4;
    const lx = x & 15, ly = y & 15, lz = z & 15;
    this.dirty.add(chunkId(cx, cy, cz));
    // Meshes include a 1-block border from neighbors (faces, AO, light).
    const xs = lx === 0 ? -1 : lx === CS - 1 ? 1 : 0;
    const ys = ly === 0 ? -1 : ly === CS - 1 ? 1 : 0;
    const zs = lz === 0 ? -1 : lz === CS - 1 ? 1 : 0;
    if (xs === 0 && ys === 0 && zs === 0) return;
    for (let dx = Math.min(0, xs); dx <= Math.max(0, xs); dx++)
      for (let dy = Math.min(0, ys); dy <= Math.max(0, ys); dy++)
        for (let dz = Math.min(0, zs); dz <= Math.max(0, zs); dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const ny = cy + dy;
          if (ny < 0 || ny >= CHUNKS_Y) continue;
          const n = this.column(cx + dx, cz + dz);
          if (n && n.counts[ny] > 0) this.dirty.add(chunkId(cx + dx, ny, cz + dz));
        }
  }

  /**
   * Copy a chunk plus a 1-block border into (CS+2)³ block and light arrays,
   * so the mesher (in a worker) needs no world access.
   */
  buildPadded(
    cx: number,
    cy: number,
    cz: number,
    blocks = new Uint16Array((CS + 2) ** 3),
    light = new Uint8Array((CS + 2) ** 3),
  ): { blocks: Uint16Array; light: Uint8Array } {
    const P = CS + 2;
    const bx = cx * CS - 1, by = cy * CS - 1, bz = cz * CS - 1;
    for (let z = 0; z < P; z++)
      for (let x = 0; x < P; x++) {
        const wx = bx + x, wz = bz + z;
        const c = this.columnAt(wx, wz);
        const lx = wx & 15, lz = wz & 15;
        for (let y = 0; y < P; y++) {
          const wy = by + y;
          const o = x + z * P + y * P * P;
          if (!c || wy >= WORLD_H) {
            blocks[o] = 0;
            light[o] = FULL_SKY;
          } else if (wy < 0) {
            blocks[o] = Block.BEDROCK;
            light[o] = 0;
          } else {
            const i = colIndex(lx, wy, lz);
            blocks[o] = c.blocks[i];
            light[o] = c.light[i];
          }
        }
      }
    return { blocks, light };
  }
}
