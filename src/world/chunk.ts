import { WORLD } from '../config';

/** Chunk edge length. */
export const CS = WORLD.CHUNK_SIZE;
export const WORLD_H = WORLD.HEIGHT;
export const CHUNKS_Y = WORLD_H / CS;
/** Cells in one 16×16×H column. Column arrays are indexed x + z*16 + y*256. */
export const COL_VOLUME = CS * CS * WORLD_H;
export const CHUNK_VOLUME = CS * CS * CS;

export function colIndex(lx: number, y: number, lz: number): number {
  return lx + lz * CS + y * CS * CS;
}

/** Numeric key for a column (fast Map lookups). */
export function colKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

export function colKeyXZ(key: number): [number, number] {
  return [Math.floor(key / 65536) - 32768, (key % 65536) - 32768];
}

export function chunkId(cx: number, cy: number, cz: number): number {
  return colKey(cx, cz) * CHUNKS_Y + cy;
}

export function decodeChunkId(id: number): [number, number, number] {
  const cy = id % CHUNKS_Y;
  const [cx, cz] = colKeyXZ((id - cy) / CHUNKS_Y);
  return [cx, cy, cz];
}

/** A full-height 16×16 column of blocks + packed light (sky in the high nibble, block light low). */
export class Column {
  /** Non-air block count per chunk; empty chunks skip meshing. */
  readonly counts = new Uint16Array(CHUNKS_Y);
  /** Light has been computed (edits then update it incrementally). */
  lit = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly blocks: Uint16Array = new Uint16Array(COL_VOLUME),
    readonly light: Uint8Array = new Uint8Array(COL_VOLUME),
  ) {
    this.recount();
  }

  recount(): void {
    this.counts.fill(0);
    const per = CS * CS * CS;
    for (let i = 0; i < COL_VOLUME; i++) if (this.blocks[i] !== 0) this.counts[(i / per) | 0]++;
  }
}
