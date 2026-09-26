import { WORLD } from '../config';
import { CS, Column, colKey } from './chunk';
import type { WorkerPool } from './workerPool';
import type { ColumnData } from './worldgen';
import type { World } from './world';

/** Loads columns around the player (nearest first, in workers) and unloads far ones. */
export class WorldStreamer {
  private readonly inFlight = new Set<number>();
  private readonly ready: ColumnData[] = [];
  /** Square ring offsets sorted by distance, precomputed once. */
  private readonly offsets: [number, number][] = [];

  constructor(
    private readonly world: World,
    private readonly pool: WorkerPool,
    readonly seed: number,
    private readonly radius: number = WORLD.RENDER_DISTANCE,
  ) {
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dz * dz <= (radius + 0.5) ** 2) this.offsets.push([dx, dz]);
    this.offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
  }

  /** Columns still waiting on generation or integration. */
  get busy(): number {
    return this.inFlight.size + this.ready.length;
  }

  update(px: number, pz: number): void {
    const ccx = Math.floor(px / CS), ccz = Math.floor(pz / CS);
    const keep = this.radius + WORLD.UNLOAD_MARGIN;

    // Integrate finished columns (light stitching happens here, so it's budgeted).
    this.ready.sort((a, b) => (a.cx - ccx) ** 2 + (a.cz - ccz) ** 2 - ((b.cx - ccx) ** 2 + (b.cz - ccz) ** 2));
    for (let n = 0; n < WORLD.COLUMNS_PER_FRAME && this.ready.length > 0; n++) {
      const d = this.ready.shift()!;
      if (Math.max(Math.abs(d.cx - ccx), Math.abs(d.cz - ccz)) > keep) continue;
      if (this.world.column(d.cx, d.cz)) continue;
      const col = new Column(d.cx, d.cz, d.blocks, d.light);
      col.lit = true;
      this.world.addColumn(col);
    }

    // Unload far columns.
    for (const c of [...this.world.columns.values()]) {
      if (Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz)) > keep) this.world.removeColumn(c.cx, c.cz);
    }

    // Request missing columns, nearest first.
    for (const [dx, dz] of this.offsets) {
      if (this.inFlight.size >= WORLD.MAX_GEN_IN_FLIGHT) break;
      const cx = ccx + dx, cz = ccz + dz;
      const key = colKey(cx, cz);
      if (this.inFlight.has(key) || this.world.column(cx, cz) || this.ready.some((r) => r.cx === cx && r.cz === cz)) continue;
      this.inFlight.add(key);
      const e = this.world.edits.get(key);
      const edits = e ? Int32Array.from([...e].flat()) : null;
      void this.pool
        .run<ColumnData>({ type: 'gen', seed: this.seed, cx, cz, edits }, edits ? [edits.buffer] : [])
        .then((d) => {
          this.inFlight.delete(key);
          this.ready.push(d);
        });
    }
  }
}
