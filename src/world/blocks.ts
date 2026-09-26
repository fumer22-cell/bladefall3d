import { TILE, type TileName } from './tiles';

export type BlockShape = 'none' | 'cube' | 'water' | 'torch' | 'plant';

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
  /** Texture tiles: [top, sides, bottom]. */
  tex: [TileName, TileName, TileName] | null;
}

const defs: BlockDef[] = [];

type Opts = Partial<Omit<BlockDef, 'id' | 'name' | 'color'>>;

/** `tex` is one tile for all faces, or [top, sides, bottom]. */
function define(name: string, color: number, tex: TileName | [TileName, TileName, TileName] | null, opts: Opts = {}): number {
  const id = defs.length;
  const t: [TileName, TileName, TileName] | null = tex === null ? null : typeof tex === 'string' ? [tex, tex, tex] : tex;
  defs.push({
    id, name, color, solid: true, shape: 'cube', lightAtten: 15, emission: 0, friction: 1, hardness: 0.8, tier: 0, tex: t, ...opts,
  });
  return id;
}

const AIRLIKE: Opts = { solid: false, shape: 'none', lightAtten: 1, hardness: 0 };
/** Cross-sprite decoration: walk-through, instantly broken. */
const PLANT: Opts = { solid: false, shape: 'plant', lightAtten: 1, hardness: 0 };

export const Block = {
  AIR: define('air', 0x000000, null, AIRLIKE),
  STONE: define('stone', 0x5e606f, ['stone', 'cliff', 'stone'], { hardness: 0.9, tier: 1 }),
  DIRT: define('dirt', 0x6b482c, 'dirt', { hardness: 0.35 }),
  GRASS: define('grass', 0x415e28, ['grass_top', 'grass_side', 'dirt'], { hardness: 0.4 }),
  GRASS_ALT: define('grass_alt', 0x2e461f, ['grass_top', 'grass_side', 'dirt'], { hardness: 0.4 }),
  PLANKS: define('planks', 0x8f5c30, 'planks', { hardness: 0.6 }),
  LOG: define('log', 0x704624, ['log_top', 'log_side', 'log_top'], { hardness: 0.7 }),
  BRICK: define('brick', 0x924b37, 'brick', { hardness: 1.0, tier: 1 }),
  ICE: define('ice', 0x8cb6cb, 'ice', { friction: 0.08, hardness: 0.4 }),
  MARKER_RED: define('marker_red', 0x9c3a41, 'marker_red'),
  MARKER_YELLOW: define('marker_yellow', 0xd6a434, 'marker_yellow'),
  MARKER_BLUE: define('marker_blue', 0x1b5877, 'marker_blue'),
  MARKER_WHITE: define('marker_white', 0xc9bfa7, 'marker_white'),
  SAND: define('sand', 0xc1aa78, 'sand', { hardness: 0.3 }),
  GRAVEL: define('gravel', 0x484957, 'gravel', { hardness: 0.4 }),
  LEAVES: define('leaves', 0x2e461f, 'leaves', { lightAtten: 2, hardness: 0.12 }),
  WATER: define('water', 0x1c3f61, 'water', { solid: false, shape: 'water', lightAtten: 2, hardness: Infinity }),
  TORCH: define('torch', 0xfdbe5d, null, { solid: false, shape: 'torch', lightAtten: 1, emission: 14, hardness: 0.05 }),
  BEDROCK: define('bedrock', 0x15121d, 'bedrock', { hardness: Infinity }),
  DEEPSTONE: define('deepstone', 0x303145, ['deepstone', 'deep_cliff', 'deepstone'], { hardness: 1.3, tier: 1 }),
  COAL_ORE: define('coal_ore', 0x1f1a29, 'coal_ore', { hardness: 1.1, tier: 1 }),
  COPPER_ORE: define('copper_ore', 0xb0602f, 'copper_ore', { hardness: 1.3, tier: 1 }),
  IRON_ORE: define('iron_ore', 0xbfae9d, 'iron_ore', { hardness: 1.6, tier: 2 }),
  STONE_BRICK: define('stone_brick', 0x5e606f, 'stone_brick', { hardness: 1.1, tier: 1 }),
  MOSSY_BRICK: define('mossy_brick', 0x415e28, 'mossy_brick', { hardness: 1.1, tier: 1 }),
  SNOW: define('snow', 0xcfd9e3, ['snow', 'snow_side', 'stone'], { hardness: 0.3 }),
  COBBLE: define('cobblestone', 0x484957, 'cobble', { hardness: 1.0, tier: 1 }),
  WORKBENCH: define('workbench', 0x8f5c30, ['workbench_top', 'workbench_side', 'planks'], { hardness: 0.8 }),
  FORGE: define('forge', 0xdc7629, ['forge_top', 'forge_side', 'cobble'], { hardness: 1.4, tier: 1, emission: 11, lightAtten: 15 }),
  ANVIL: define('anvil', 0x303145, 'anvil', { hardness: 1.8, tier: 1 }),
  // --- Dreamlike surface ---
  GOLD_GRASS: define('golden_grass', 0xb78021, ['gold_grass_top', 'gold_grass_side', 'dirt'], { hardness: 0.4 }),
  TEAL_GRASS: define('mist_grass', 0x285c55, ['teal_grass_top', 'teal_grass_side', 'dirt'], { hardness: 0.4 }),
  HEATHER: define('heather', 0x5e3864, ['heather_top', 'heather_side', 'dirt'], { hardness: 0.4 }),
  GOLD_LEAVES: define('golden_leaves', 0xd6a434, 'gold_leaves', { lightAtten: 2, hardness: 0.12 }),
  TEAL_LEAVES: define('mist_leaves', 0x38776c, 'teal_leaves', { lightAtten: 2, hardness: 0.12 }),
  ROSE_LEAVES: define('rose_leaves', 0x9c3a41, 'rose_leaves', { lightAtten: 2, hardness: 0.12 }),
  PALE_LOG: define('pale_log', 0xc9bfa7, ['pale_log_top', 'pale_log_side', 'pale_log_top'], { hardness: 0.7 }),
  MOSS_STONE: define('moss_stone', 0x415e28, ['moss_stone', 'cliff_moss', 'stone'], { hardness: 1.0, tier: 1 }),
  CRYSTAL: define('crystal', 0x8f5bcb, 'crystal', { hardness: 1.2, tier: 1, emission: 12 }),
  ROOTS: define('rooted_dirt', 0x523621, 'roots', { hardness: 0.4 }),
  LANTERN: define('lantern', 0xdc7629, 'lantern', { hardness: 0.3, emission: 14, lightAtten: 15 }),
  TALL_GRASS: define('tall_grass', 0x415e28, 'tall_grass', PLANT),
  GOLD_TUFT: define('golden_tuft', 0xd6a434, 'gold_tuft', PLANT),
  FERN: define('fern', 0x38776c, 'fern', PLANT),
  FLOWER_ROSE: define('rose', 0xbd5751, 'flower_rose', PLANT),
  FLOWER_GOLD: define('marigold', 0xecc865, 'flower_gold', PLANT),
  FLOWER_BLUE: define('bluebell', 0x66c1d6, 'flower_blue', PLANT),
  GLOWSHROOM: define('glowshroom', 0x66c1d6, 'glowshroom', { ...PLANT, emission: 11 }),
  VINES: define('vines', 0x38776c, 'vines', PLANT),
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

/**
 * Natural blocks are drawn as one continuous faceted surface (surface nets) instead of cubes:
 * rock, soil, sand, snow, ores, trunks and canopies. Built blocks stay crisp cubes.
 */
const SMOOTH_NAMES = new Set([
  'stone', 'dirt', 'grass', 'grass_alt', 'log', 'sand', 'gravel', 'leaves', 'bedrock', 'deepstone', 'coal_ore',
  'copper_ore', 'iron_ore', 'snow', 'golden_grass', 'mist_grass', 'heather', 'golden_leaves', 'mist_leaves', 'rose_leaves',
  'pale_log', 'moss_stone', 'rooted_dirt',
]);
export const SMOOTH = new Uint8Array(defs.map((d) => (SMOOTH_NAMES.has(d.name) ? 1 : 0)));
/** Texture tile per block face: [top, side, bottom] at id*3 (−1 = untextured). */
export const BLOCK_TILES = new Int16Array(defs.length * 3).fill(-1);
defs.forEach((d) => {
  if (d.tex) for (let k = 0; k < 3; k++) BLOCK_TILES[d.id * 3 + k] = TILE[d.tex[k]];
});
