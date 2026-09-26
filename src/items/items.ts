import { INVENTORY, TIERS } from '../config';
import { BLOCKS, Block } from '../world/blocks';

export type ItemKind = 'block' | 'tool' | 'weapon' | 'material';

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

// --- Materials ---
add({ id: 'stick', name: 'Stick', kind: 'material', color: 0x8a6a42, abbr: '/' });
add({ id: 'coal', name: 'Coal', kind: 'material', color: 0x26262a, abbr: 'C' });
add({ id: 'raw_copper', name: 'Raw Copper', kind: 'material', color: 0xc07a4a, abbr: 'rCu' });
add({ id: 'raw_iron', name: 'Raw Iron', kind: 'material', color: 0xc9a88a, abbr: 'rFe' });
add({ id: 'copper_ingot', name: 'Copper Ingot', kind: 'material', color: 0xe08a50, abbr: 'Cu' });
add({ id: 'iron_ingot', name: 'Iron Ingot', kind: 'material', color: 0xd8d8dc, abbr: 'Fe' });
add({ id: 'bone', name: 'Husk Bone', kind: 'material', color: 0xc9bfa7, abbr: 'Bn' });
add({ id: 'feather', name: 'Crow Feather', kind: 'material', color: 0x2b2437, abbr: 'Fr' });

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
      return Math.random() < 0.12 ? 'stick' : null;
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
