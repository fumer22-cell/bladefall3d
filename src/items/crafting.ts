import { INVENTORY } from '../config';
import { Block } from '../world/blocks';
import type { VoxelQuery } from '../world/world';
import type { Inventory } from './inventory';
import { WEAPON_KINDS } from './items';

export type Station = 'hand' | 'workbench' | 'forge' | 'anvil';

export interface Recipe {
  id: string;
  station: Station;
  inputs: { item: string; count: number }[];
  output: { item: string; count: number };
}

export const STATION_BLOCKS: Record<Exclude<Station, 'hand'>, number> = {
  workbench: Block.WORKBENCH,
  forge: Block.FORGE,
  anvil: Block.ANVIL,
};

const r = (station: Station, out: string, n: number, ...inputs: [string, number][]): Recipe => ({
  id: `${out}@${station}`,
  station,
  inputs: inputs.map(([item, count]) => ({ item, count })),
  output: { item: out, count: n },
});

/** Weapon recipes: [ingots, sticks] per weapon kind. */
const WEAPON_COST: Record<(typeof WEAPON_KINDS)[number], [number, number]> = {
  sword: [2, 1],
  greatsword: [4, 2],
  daggers: [2, 2],
  spear: [1, 3],
  gauntlets: [3, 0],
};

export const RECIPES: Recipe[] = [
  // By hand
  r('hand', 'planks', 4, ['log', 1]),
  r('hand', 'stick', 4, ['planks', 2]),
  r('hand', 'torch', 4, ['stick', 1], ['coal', 1]),
  r('hand', 'workbench', 1, ['planks', 4]),
  // Workbench
  r('workbench', 'wooden_pickaxe', 1, ['planks', 3], ['stick', 2]),
  r('workbench', 'forge', 1, ['cobblestone', 8], ['coal', 2]),
  r('workbench', 'stone_brick', 4, ['cobblestone', 4]),
  // Forge: smelting and copper gear
  r('forge', 'copper_ingot', 1, ['raw_copper', 1], ['coal', 1]),
  r('forge', 'iron_ingot', 1, ['raw_iron', 1], ['coal', 1]),
  r('forge', 'copper_pickaxe', 1, ['copper_ingot', 3], ['stick', 2]),
  ...WEAPON_KINDS.map((k) => r('forge', `copper_${k}`, 1, ['copper_ingot', WEAPON_COST[k][0]], ['stick', WEAPON_COST[k][1]])),
  r('forge', 'anvil', 1, ['iron_ingot', 5]),
  // Anvil: iron gear
  r('anvil', 'iron_pickaxe', 1, ['iron_ingot', 3], ['stick', 2]),
  ...WEAPON_KINDS.map((k) => r('anvil', `iron_${k}`, 1, ['iron_ingot', WEAPON_COST[k][0]], ['stick', WEAPON_COST[k][1]])),
].map((rec) => ({ ...rec, inputs: rec.inputs.filter((i) => i.count > 0) }));

/** Which stations are within reach of a point (hands are always available). */
export function nearbyStations(world: VoxelQuery, x: number, y: number, z: number): Set<Station> {
  const out = new Set<Station>(['hand']);
  const R = INVENTORY.STATION_RADIUS;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (let dy = -R; dy <= R; dy++)
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const id = world.getBlock(bx + dx, by + dy, bz + dz);
        for (const [station, block] of Object.entries(STATION_BLOCKS)) if (id === block) out.add(station as Station);
      }
  return out;
}

export function canCraft(inv: Inventory, recipe: Recipe, stations: Set<Station>): boolean {
  if (!stations.has(recipe.station)) return false;
  return recipe.inputs.every((i) => inv.count(i.item) >= i.count);
}

/** Craft once. Returns false (and changes nothing) if it isn't possible or the output wouldn't fit. */
export function craft(inv: Inventory, recipe: Recipe, stations: Set<Station>): boolean {
  if (!canCraft(inv, recipe, stations)) return false;
  for (const i of recipe.inputs) inv.remove(i.item, i.count);
  const left = inv.add(recipe.output.item, recipe.output.count);
  if (left > 0) {
    // Roll back: give the inputs back and take away what did fit.
    inv.remove(recipe.output.item, recipe.output.count - left);
    for (const i of recipe.inputs) inv.add(i.item, i.count);
    return false;
  }
  return true;
}
