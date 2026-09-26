import type { Stack } from '../items/inventory';

export const SAVE_FORMAT = 1;

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  inventory: (Stack | null)[];
  selected: number;
  spawn: [number, number, number];
  // --- Phase 6 (optional so older saves still load) ---
  armor?: (Stack | null)[];
  trinkets?: (Stack | null)[];
  food?: number;
  bodyTemp?: number;
  /** Bed the player sleeps in / respawns at. */
  bed?: [number, number, number] | null;
  /** Time of day (0..1) and day count. */
  time?: number;
  day?: number;
  /** Memory orb left at the last death. */
  memory?: { x: number; y: number; z: number; coins: number } | null;
}

export interface SaveData {
  format: number;
  id: string;
  name: string;
  seed: number;
  createdAt: number;
  updatedAt: number;
  /** Seconds played. */
  playTime: number;
  player: PlayerSave | null;
  /** Player block edits per column: flat [colIndex, blockId, ...] pairs. */
  edits: { key: number; data: Int32Array }[];
}

export type SaveMeta = Pick<SaveData, 'id' | 'name' | 'seed' | 'createdAt' | 'updatedAt' | 'playTime'> & { edits: number };

export function newSave(name: string, seed: number): SaveData {
  const now = Date.now();
  return {
    format: SAVE_FORMAT,
    id: `w${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: name.trim() || 'New World',
    seed,
    createdAt: now,
    updatedAt: now,
    playTime: 0,
    player: null,
    edits: [],
  };
}

export function editsToSave(edits: Map<number, Map<number, number>>): { key: number; data: Int32Array }[] {
  const out: { key: number; data: Int32Array }[] = [];
  for (const [key, m] of edits) {
    if (m.size === 0) continue;
    const data = new Int32Array(m.size * 2);
    let k = 0;
    for (const [i, id] of m) {
      data[k++] = i;
      data[k++] = id;
    }
    out.push({ key, data });
  }
  return out;
}

export function editsFromSave(saved: { key: number; data: Int32Array | number[] }[]): Map<number, Map<number, number>> {
  const edits = new Map<number, Map<number, number>>();
  for (const { key, data } of saved) {
    const m = new Map<number, number>();
    for (let k = 0; k + 1 < data.length; k += 2) m.set(data[k], data[k + 1]);
    edits.set(key, m);
  }
  return edits;
}

export function metaOf(s: SaveData): SaveMeta {
  let edits = 0;
  for (const e of s.edits) edits += e.data.length / 2;
  return { id: s.id, name: s.name, seed: s.seed, createdAt: s.createdAt, updatedAt: s.updatedAt, playTime: s.playTime, edits };
}
