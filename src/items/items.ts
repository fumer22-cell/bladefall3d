import { INVENTORY, TIERS } from '../config';
import { BLOCKS, Block } from '../world/blocks';

export type ItemKind = 'block' | 'tool' | 'weapon' | 'material' | 'food' | 'armor';

export type ArmorSlot = 0 | 1 | 2;
export const ARMOR_SLOT_NAMES = ['Head', 'Body', 'Legs'] as const;

export interface ItemDef {
  /** Stable string id (used in saves). */
  id: string;
  name: string;
  kind: ItemKind;
  color: number;
  maxStack: number;
  /** Block placed by this item. */
  block?: number;
  /** Pickaxe stats. */
  tool?: { tier: number; mineSpeed: number };
  /** Index into WEAPONS + damage/posture multiplier for the material. */
  weapon?: { index: number; mult: number };
  /** Eating it: food points, health healed over time, and whether it warms you. */
  food?: { food: number; heal: number; warm?: boolean };
  /** Wearing it: slot, fraction of enemy damage absorbed, warmth in °C. */
  armor?: { slot: ArmorSlot; defense: number; warmth: number };
  /** Short label drawn on the icon. */
  abbr?: string;
}

export const ITEMS: Record<string, ItemDef> = {};

function add(def: Omit<ItemDef, 'maxStack'> & { maxStack?: number }): void {
  ITEMS[def.id] = { maxStack: INVENTORY.MAX_STACK, ...def };
}

function blockItem(id: string, block: number, name?: string): void {
  add({ id, name: name ?? titleCase(BLOCKS[block].name), kind: 'block', color: BLOCKS[block].color, block });
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Blocks ---
blockItem('dirt', Block.DIRT);
blockItem('sand', Block.SAND);
blockItem('gravel', Block.GRAVEL);
blockItem('cobblestone', Block.COBBLE);
blockItem('log', Block.LOG);
blockItem('planks', Block.PLANKS);
blockItem('stone_brick', Block.STONE_BRICK);
blockItem('mossy_brick', Block.MOSSY_BRICK);
blockItem('brick', Block.BRICK);
blockItem('snow', Block.SNOW);
blockItem('ice', Block.ICE);
blockItem('torch', Block.TORCH);
blockItem('workbench', Block.WORKBENCH);
blockItem('forge', Block.FORGE);
blockItem('anvil', Block.ANVIL);
blockItem('bed', Block.BED, 'Feather Bed');
blockItem('campfire', Block.CAMPFIRE);

// --- Materials ---
add({ id: 'stick', name: 'Stick', kind: 'material', color: 0x8a6a42, abbr: '/' });
add({ id: 'coal', name: 'Coal', kind: 'material', color: 0x26262a, abbr: 'C' });
add({ id: 'raw_copper', name: 'Raw Copper', kind: 'material', color: 0xc07a4a, abbr: 'rCu' });
add({ id: 'raw_iron', name: 'Raw Iron', kind: 'material', color: 0xc9a88a, abbr: 'rFe' });
add({ id: 'copper_ingot', name: 'Copper Ingot', kind: 'material', color: 0xe08a50, abbr: 'Cu' });
add({ id: 'iron_ingot', name: 'Iron Ingot', kind: 'material', color: 0xd8d8dc, abbr: 'Fe' });
add({ id: 'bone', name: 'Husk Bone', kind: 'material', color: 0xc9bfa7, abbr: 'Bn' });
add({ id: 'feather', name: 'Crow Feather', kind: 'material', color: 0x2b2437, abbr: 'Fr' });
add({ id: 'coin', name: 'Grave Coin', kind: 'material', color: 0xd6a434, abbr: 'Gc', maxStack: 999 });

// --- Food ---
add({ id: 'duskberries', name: 'Duskberries', kind: 'food', color: 0x9c3a41, abbr: 'Bry', food: { food: 9, heal: 2 } });
add({ id: 'glowcap', name: 'Glowcap', kind: 'food', color: 0x66c1d6, abbr: 'Cap', food: { food: 6, heal: 0 } });
add({ id: 'crow_meat', name: 'Raw Crow', kind: 'food', color: 0xbd5751, abbr: 'Raw', food: { food: 10, heal: 0 } });
add({ id: 'roast_crow', name: 'Roast Crow', kind: 'food', color: 0x7f5a32, abbr: 'Rst', food: { food: 32, heal: 14 } });
add({ id: 'berry_tart', name: 'Berry Tart', kind: 'food', color: 0xbd5751, abbr: 'Trt', food: { food: 26, heal: 10 } });
add({ id: 'glowcap_stew', name: 'Glowcap Stew', kind: 'food', color: 0x3f8475, abbr: 'Stw', maxStack: 8, food: { food: 42, heal: 24, warm: true } });

// --- Armor (head, body, legs) ---
add({ id: 'feather_hood', name: 'Feather Hood', kind: 'armor', color: 0x2b2437, abbr: 'Hd', maxStack: 1, armor: { slot: 0, defense: 0.03, warmth: 6 } });
add({ id: 'feather_mantle', name: 'Feather Mantle', kind: 'armor', color: 0x2b2437, abbr: 'Mt', maxStack: 1, armor: { slot: 1, defense: 0.05, warmth: 9 } });
for (const [mat, color, def, warm] of [
  ['copper', 0xe08a50, [0.05, 0.09, 0.06], 2],
  ['iron', 0xd8d8dc, [0.08, 0.14, 0.1], 1],
] as const) {
  (['helm', 'cuirass', 'greaves'] as const).forEach((piece, slot) => {
    add({
      id: `${mat}_${piece}`, name: titleCase(`${mat} ${piece}`), kind: 'armor', color, maxStack: 1,
      abbr: ['Hm', 'Cu', 'Gv'][slot], armor: { slot: slot as ArmorSlot, defense: def[slot], warmth: warm },
    });
  });
}

// --- Pickaxes ---
add({ id: 'wooden_pickaxe', name: 'Wooden Pickaxe', kind: 'tool', color: 0xb08952, maxStack: 1, tool: TIERS.WOOD, abbr: 'Pk' });
add({ id: 'copper_pickaxe', name: 'Copper Pickaxe', kind: 'tool', color: 0xe08a50, maxStack: 1, tool: TIERS.COPPER, abbr: 'Pk' });
add({ id: 'iron_pickaxe', name: 'Iron Pickaxe', kind: 'tool', color: 0xd8d8dc, maxStack: 1, tool: TIERS.IRON, abbr: 'Pk' });

// --- Weapons (index into WEAPONS: sword, greatsword, daggers, spear, gauntlets) ---
export const WEAPON_KINDS = ['sword', 'greatsword', 'daggers', 'spear', 'gauntlets'] as const;
const WEAPON_ABBR = ['Sw', 'GS', 'Dg', 'Sp', 'Gt'];
add({ id: 'rusty_sword', name: 'Rusty Sword', kind: 'weapon', color: 0x8a6d5a, maxStack: 1, weapon: { index: 0, mult: TIERS.WEAPON_MULT.RUSTY }, abbr: 'Sw' });
for (const [mat, color, mult] of [
  ['copper', 0xe08a50, TIERS.WEAPON_MULT.COPPER],
  ['iron', 0xd8d8dc, TIERS.WEAPON_MULT.IRON],
] as const) {
  WEAPON_KINDS.forEach((kind, index) => {
    add({ id: `${mat}_${kind}`, name: titleCase(`${mat} ${kind}`), kind: 'weapon', color, maxStack: 1, weapon: { index, mult }, abbr: WEAPON_ABBR[index] });
  });
}

/** What a mined block drops (null = nothing). */
export function blockDrop(block: number): string | null {
  switch (block) {
    case Block.GRASS:
    case Block.GRASS_ALT:
      return 'dirt';
    case Block.STONE:
    case Block.DEEPSTONE:
      return 'cobblestone';
    case Block.COAL_ORE:
      return 'coal';
    case Block.COPPER_ORE:
      return 'raw_copper';
    case Block.IRON_ORE:
      return 'raw_iron';
    case Block.LEAVES:
      return Math.random() < 0.12 ? 'stick' : Math.random() < 0.05 ? 'duskberries' : null;
    case Block.GOLD_LEAVES:
    case Block.TEAL_LEAVES:
    case Block.ROSE_LEAVES:
      return Math.random() < 0.1 ? 'stick' : Math.random() < 0.05 ? 'duskberries' : null;
    case Block.BERRY_BUSH:
      return 'duskberries';
    case Block.TALL_GRASS:
    case Block.FERN:
    case Block.GOLD_TUFT:
      return Math.random() < 0.08 ? 'duskberries' : null;
    case Block.GLOWSHROOM:
      return 'glowcap';
    case Block.WATER:
    case Block.BEDROCK:
      return null;
  }
  for (const def of Object.values(ITEMS)) if (def.block === block) return def.id;
  return null;
}

export function item(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Unknown item: ${id}`);
  return d;
}
