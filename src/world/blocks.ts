export interface BlockDef {
  id: number;
  name: string;
  /** Base color (0xRRGGBB). Placeholder art: flat colors. */
  color: number;
  solid: boolean;
  /** Ground friction multiplier: 1 = normal, lower = slippery. */
  friction: number;
}

const defs: BlockDef[] = [];

function define(name: string, color: number, opts: Partial<Omit<BlockDef, 'id' | 'name' | 'color'>> = {}): number {
  const id = defs.length;
  defs.push({ id, name, color, solid: true, friction: 1, ...opts });
  return id;
}

export const Block = {
  AIR: define('air', 0x000000, { solid: false }),
  STONE: define('stone', 0x7d7f86),
  DIRT: define('dirt', 0x7a5536),
  GRASS: define('grass', 0x5c9e3f),
  GRASS_ALT: define('grass_alt', 0x4f8c37),
  PLANKS: define('planks', 0xb08952),
  LOG: define('log', 0x6b4a2b),
  BRICK: define('brick', 0x9a4d3c),
  ICE: define('ice', 0xa9d8f0, { friction: 0.08 }),
  MARKER_RED: define('marker_red', 0xd04040),
  MARKER_YELLOW: define('marker_yellow', 0xe0c040),
  MARKER_BLUE: define('marker_blue', 0x4060d0),
  MARKER_WHITE: define('marker_white', 0xe8e8e8),
} as const;

export const BLOCKS: readonly BlockDef[] = defs;

/** Lookup tables for hot paths (mesher, collision). */
export const SOLID = new Uint8Array(defs.map((d) => (d.solid ? 1 : 0)));
export const COLOR = new Uint32Array(defs.map((d) => d.color));
export const FRICTION = new Float32Array(defs.map((d) => d.friction));
