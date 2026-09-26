import { WORLD } from '../config';

export const CS = WORLD.CHUNK_SIZE;
export const CS2 = CS * CS;
export const CS3 = CS * CS * CS;

export class Chunk {
  readonly blocks = new Uint16Array(CS3);
  /** Number of non-air blocks; empty chunks skip meshing. */
  count = 0;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
  ) {}

  static index(x: number, y: number, z: number): number {
    return x + z * CS + y * CS2;
  }

  get(x: number, y: number, z: number): number {
    return this.blocks[x + z * CS + y * CS2];
  }

  set(x: number, y: number, z: number, id: number): void {
    const i = x + z * CS + y * CS2;
    const old = this.blocks[i];
    if (old === id) return;
    if (old === 0) this.count++;
    else if (id === 0) this.count--;
    this.blocks[i] = id;
  }
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}
