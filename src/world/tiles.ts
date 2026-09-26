/**
 * Texture tile ids shared by the mesher (worker) and the texture painter (main thread).
 * The atlas is 16×16 tiles of 16×16 px; a tile's index is its position in this list.
 */
export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'planks', 'log_side', 'log_top',
  'leaves', 'sand', 'gravel', 'snow', 'ice', 'water', 'bedrock', 'deepstone',
  'coal_ore', 'copper_ore', 'iron_ore', 'stone_brick', 'mossy_brick', 'brick', 'workbench_top', 'workbench_side',
  'forge_side', 'forge_top', 'anvil', 'gold_grass_top', 'gold_grass_side', 'teal_grass_top', 'teal_grass_side', 'heather_top',
  'heather_side', 'gold_leaves', 'teal_leaves', 'rose_leaves', 'pale_log_side', 'pale_log_top', 'moss_stone', 'crystal',
  'tall_grass', 'gold_tuft', 'fern', 'flower_rose', 'flower_gold', 'flower_blue', 'glowshroom', 'vines',
  'marker_red', 'marker_yellow', 'marker_blue', 'marker_white', 'lantern', 'snow_side', 'roots', 'cliff', 'cliff_moss',
  'deep_cliff',
] as const;

export type TileName = (typeof TILE_NAMES)[number];

export const TILE: Record<TileName, number> = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i])) as Record<TileName, number>;

export const ATLAS_TILES = 16;
export const TILE_PX = 16;
