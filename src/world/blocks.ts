export type BlockShape = 'none' | 'cube' | 'water' | 'torch';

export interface BlockDef {
  id: number;
  name: string;
  /** Base color (0xRRGGBB). Placeholder art: flat colors. */
  color: number;
  /** Blocks movement. */
  solid: boolean;
  shape: BlockShape;
  /** Light lost passing through (15 = blocks light). */
  lightAtten: number;
  /** Light emitted (0–15). */
  emission: number;
  /** Ground friction multiplier: 1 = normal, lower = slippery. */
  friction: number;
  /** Seconds to mine at speed 1 (bare hands). Infinity = unbreakable. */
  hardness: number;
  /** Pickaxe tier needed to mine it (0 = hands). */
  tier: number;
}

const defs: BlockDef[] = [];

type Opts = Partial<Omit<BlockDef, 'id' | 'name' | 'color'>>;

function define(name: string, color: number, opts: Opts = {}): number {
  const id = defs.length;
  defs.push({ id, name, color, solid: true, shape: 'cube', lightAtten: 15, emission: 0, friction: 1, hardness: 0.8, tier: 0, ...opts });
  return id;
}

const AIRLIKE: Opts = { solid: false, shape: 'none', lightAtten: 1, hardness: 0 };

export const Block = {
  AIR: define('air', 0x000000, AIRLIKE),
  STONE: define('stone', 0x7d7f86, { hardness: 0.9, tier: 1 }),
  DIRT: define('dirt', 0x7a5536, { hardness: 0.35 }),
  GRASS: define('grass', 0x5c9e3f, { hardness: 0.4 }),
  GRASS_ALT: define('grass_alt', 0x4f8c37, { hardness: 0.4 }),
  PLANKS: define('planks', 0xb08952, { hardness: 0.6 }),
  LOG: define('log', 0x6b4a2b, { hardness: 0.7 }),
  BRICK: define('brick', 0x9a4d3c, { hardness: 1.0, tier: 1 }),
  ICE: define('ice', 0xa9d8f0, { friction: 0.08, hardness: 0.4 }),
  MARKER_RED: define('marker_red', 0xd04040),
  MARKER_YELLOW: define('marker_yellow', 0xe0c040),
  MARKER_BLUE: define('marker_blue', 0x4060d0),
  MARKER_WHITE: define('marker_white', 0xe8e8e8),
  SAND: define('sand', 0xd9c98f, { hardness: 0.3 }),
  GRAVEL: define('gravel', 0x8a8580, { hardness: 0.4 }),
  LEAVES: define('leaves', 0x3f7a2e, { lightAtten: 2, hardness: 0.12 }),
  WATER: define('water', 0x2f6fb5, { solid: false, shape: 'water', lightAtten: 2, hardness: Infinity }),
  TORCH: define('torch', 0xffc75a, { solid: false, shape: 'torch', lightAtten: 1, emission: 14, hardness: 0.05 }),
  BEDROCK: define('bedrock', 0x2b2b30, { hardness: Infinity }),
  DEEPSTONE: define('deepstone', 0x4e4f58, { hardness: 1.3, tier: 1 }),
  COAL_ORE: define('coal_ore', 0x3c3c40, { hardness: 1.1, tier: 1 }),
  COPPER_ORE: define('copper_ore', 0xc07a4a, { hardness: 1.3, tier: 1 }),
  IRON_ORE: define('iron_ore', 0xc9a88a, { hardness: 1.6, tier: 2 }),
  STONE_BRICK: define('stone_brick', 0x8e8f96, { hardness: 1.1, tier: 1 }),
  MOSSY_BRICK: define('mossy_brick', 0x6f8a5e, { hardness: 1.1, tier: 1 }),
  SNOW: define('snow', 0xf2f5f8, { hardness: 0.3 }),
  COBBLE: define('cobblestone', 0x6c6e74, { hardness: 1.0, tier: 1 }),
  WORKBENCH: define('workbench', 0x9c6b3a, { hardness: 0.8 }),
  FORGE: define('forge', 0x5a4a44, { hardness: 1.4, tier: 1, emission: 11, lightAtten: 15 }),
  ANVIL: define('anvil', 0x3a3d44, { hardness: 1.8, tier: 1 }),
} as const;

export const BLOCKS: readonly BlockDef[] = defs;

/** Lookup tables for hot paths (mesher, collision, lighting). */
export const SOLID = new Uint8Array(defs.map((d) => (d.solid ? 1 : 0)));
/** Rendered as a full opaque cube (hides neighbor faces). */
export const OPAQUE = new Uint8Array(defs.map((d) => (d.shape === 'cube' ? 1 : 0)));
export const COLOR = new Uint32Array(defs.map((d) => d.color));
export const FRICTION = new Float32Array(defs.map((d) => d.friction));
export const LIGHT_ATTEN = new Uint8Array(defs.map((d) => d.lightAtten));
export const EMISSION = new Uint8Array(defs.map((d) => d.emission));
export const SHAPE: readonly BlockShape[] = defs.map((d) => d.shape);
