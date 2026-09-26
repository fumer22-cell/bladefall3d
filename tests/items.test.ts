import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { RECIPES, canCraft, craft, nearbyStations, type Station } from '../src/items/crafting';
import { Drops } from '../src/items/drops';
import { Inventory } from '../src/items/inventory';
import { ITEMS, blockDrop } from '../src/items/items';
import { Builder } from '../src/player/builder';
import { editsFromSave, editsToSave, newSave } from '../src/save/serialize';
import { Block } from '../src/world/blocks';
import { Vector3 } from 'three';
import { DT, flatWorld } from './helpers';

const recipe = (out: string) => RECIPES.find((r) => r.output.item === out)!;
const at = (...s: Station[]) => new Set<Station>(['hand', ...s]);

describe('Inventory', () => {
  it('stacks up to the max and spills into new slots', () => {
    const inv = new Inventory();
    expect(inv.add('cobblestone', 100)).toBe(0);
    expect(inv.slots[0]).toEqual({ item: 'cobblestone', count: INVENTORY.MAX_STACK });
    expect(inv.slots[1]).toEqual({ item: 'cobblestone', count: 100 - INVENTORY.MAX_STACK });
    expect(inv.count('cobblestone')).toBe(100);
  });

  it('never stacks tools and weapons', () => {
    const inv = new Inventory();
    inv.add('iron_sword', 2);
    expect(inv.slots[0]!.count).toBe(1);
    expect(inv.slots[1]!.count).toBe(1);
  });

  it('reports what does not fit', () => {
    const inv = new Inventory(2);
    expect(inv.add('dirt', 200)).toBe(200 - 2 * INVENTORY.MAX_STACK);
  });

  it('removes from the backpack before the hotbar', () => {
    const inv = new Inventory();
    inv.add('dirt', 10);
    inv.slots[20] = { item: 'dirt', count: 5 };
    expect(inv.remove('dirt', 7)).toBe(7);
    expect(inv.slots[20]).toBeNull();
    expect(inv.slots[0]!.count).toBe(8);
  });

  it('click picks up, places, merges, swaps and splits', () => {
    const inv = new Inventory();
    inv.slots[0] = { item: 'dirt', count: 10 };
    inv.slots[1] = { item: 'sand', count: 3 };
    let cursor = inv.click(0, null); // pick up dirt
    expect(cursor).toEqual({ item: 'dirt', count: 10 });
    cursor = inv.click(1, cursor); // swap with sand
    expect(cursor).toEqual({ item: 'sand', count: 3 });
    expect(inv.slots[1]).toEqual({ item: 'dirt', count: 10 });
    cursor = inv.click(5, cursor, true); // put one down
    expect(inv.slots[5]).toEqual({ item: 'sand', count: 1 });
    expect(cursor!.count).toBe(2);
    cursor = inv.click(5, cursor); // merge
    expect(cursor).toBeNull();
    expect(inv.slots[5]!.count).toBe(3);
    cursor = inv.click(1, null, true); // take half
    expect(cursor!.count).toBe(5);
  });

  it('shift-click moves between hotbar and backpack', () => {
    const inv = new Inventory();
    inv.slots[20] = { item: 'coal', count: 4 };
    inv.quickMove(20);
    expect(inv.slots[20]).toBeNull();
    expect(inv.slots[0]).toEqual({ item: 'coal', count: 4 });
  });

  it('round-trips through serialize/load and drops unknown items', () => {
    const inv = new Inventory();
    inv.add('torch', 5);
    const data = inv.serialize();
    data[3] = { item: 'not_a_real_item', count: 1 };
    const b = new Inventory();
    b.load(data, 2);
    expect(b.count('torch')).toBe(5);
    expect(b.slots[3]).toBeNull();
    expect(b.selected).toBe(2);
  });
});

describe('Crafting', () => {
  it('has only valid items in recipes', () => {
    for (const r of RECIPES) {
      expect(ITEMS[r.output.item], r.id).toBeDefined();
      for (const i of r.inputs) expect(ITEMS[i.item], `${r.id} input ${i.item}`).toBeDefined();
    }
  });

  it('crafts planks by hand and consumes inputs', () => {
    const inv = new Inventory();
    inv.add('log', 2);
    expect(craft(inv, recipe('planks'), at())).toBe(true);
    expect(inv.count('log')).toBe(1);
    expect(inv.count('planks')).toBe(4);
  });

  it('needs the right station', () => {
    const inv = new Inventory();
    inv.add('planks', 3);
    inv.add('stick', 2);
    expect(canCraft(inv, recipe('wooden_pickaxe'), at())).toBe(false);
    expect(craft(inv, recipe('wooden_pickaxe'), at('workbench'))).toBe(true);
    expect(inv.count('wooden_pickaxe')).toBe(1);
  });

  it('follows the full chain: workbench → forge → anvil → iron sword', () => {
    const inv = new Inventory();
    inv.add('raw_iron', 7);
    inv.add('coal', 7);
    inv.add('stick', 1);
    const s = at('workbench', 'forge');
    for (let i = 0; i < 7; i++) expect(craft(inv, recipe('iron_ingot'), s)).toBe(true);
    expect(craft(inv, recipe('anvil'), s)).toBe(true);
    expect(craft(inv, RECIPES.find((r) => r.output.item === 'iron_sword')!, at('anvil'))).toBe(true);
    expect(inv.count('iron_sword')).toBe(1);
    expect(inv.count('iron_ingot')).toBe(0);
  });

  it('does nothing when the output would not fit', () => {
    const inv = new Inventory(1);
    inv.add('log', 1);
    expect(craft(inv, recipe('planks'), at())).toBe(true); // log slot frees up for planks
    const blocked = new Inventory(1);
    blocked.slots[0] = { item: 'coal', count: 64 };
    expect(craft(blocked, recipe('workbench'), at())).toBe(false);
    expect(blocked.slots[0]).toEqual({ item: 'coal', count: 64 });
  });

  it('finds nearby stations', () => {
    const w = flatWorld();
    w.setBlock(12, 4, 10, Block.WORKBENCH);
    expect(nearbyStations(w, 10.5, 5, 10.5).has('workbench')).toBe(true);
    expect(nearbyStations(w, 30.5, 5, 30.5).has('workbench')).toBe(false);
  });
});

describe('Mining', () => {
  const mineFor = (b: Builder, w: ReturnType<typeof flatWorld>, inv: Inventory, seconds: number) => {
    for (let t = 0; t < seconds; t += DT) b.update(DT, { mineHeld: true, placeHeld: false, placePressed: false }, w, [], inv);
  };

  it('drops the right items', () => {
    expect(blockDrop(Block.STONE)).toBe('cobblestone');
    expect(blockDrop(Block.GRASS)).toBe('dirt');
    expect(blockDrop(Block.IRON_ORE)).toBe('raw_iron');
    expect(blockDrop(Block.PLANKS)).toBe('planks');
    expect(blockDrop(Block.BEDROCK)).toBeNull();
  });

  it('bare hands cannot mine stone; a wooden pickaxe can', () => {
    const w = flatWorld(); // stone floor
    const inv = new Inventory();
    const b = new Builder();
    b.enabled = true;
    b.aim(w, { x: 10.5, y: 6, z: 10.5 }, { x: 0, y: -1, z: 0 });
    mineFor(b, w, inv, 3);
    expect(w.getBlock(10, 3, 10)).toBe(Block.STONE);
    expect(b.events.some((e) => e.type === 'tooWeak')).toBe(true);

    inv.add('wooden_pickaxe', 1);
    b.events.length = 0;
    mineFor(b, w, inv, 1);
    expect(w.getBlock(10, 3, 10)).toBe(0);
    const broken = b.events.find((e) => e.type === 'broken');
    expect(broken && broken.type === 'broken' && broken.drop).toBe('cobblestone');
  });

  it('iron ore needs a copper pickaxe', () => {
    const w = flatWorld();
    w.setBlock(10, 3, 10, Block.IRON_ORE);
    const inv = new Inventory();
    inv.add('wooden_pickaxe', 1);
    const b = new Builder();
    b.enabled = true;
    b.aim(w, { x: 10.5, y: 6, z: 10.5 }, { x: 0, y: -1, z: 0 });
    mineFor(b, w, inv, 3);
    expect(w.getBlock(10, 3, 10)).toBe(Block.IRON_ORE);
    inv.slots[0] = { item: 'copper_pickaxe', count: 1 };
    mineFor(b, w, inv, 3);
    expect(w.getBlock(10, 3, 10)).toBe(0);
  });

  it('placing uses up the held block', () => {
    const w = flatWorld();
    const inv = new Inventory();
    inv.add('planks', 2);
    const b = new Builder();
    b.enabled = true;
    b.aim(w, { x: 10.5, y: 6, z: 10.5 }, { x: 0, y: -1, z: 0 });
    b.update(DT, { mineHeld: false, placeHeld: false, placePressed: true }, w, [], inv);
    expect(w.getBlock(10, 4, 10)).toBe(Block.PLANKS);
    expect(inv.count('planks')).toBe(1);
  });
});

describe('Drops', () => {
  it('fall, then fly to a nearby player and get picked up', () => {
    const w = flatWorld();
    const drops = new Drops();
    const inv = new Inventory();
    drops.spawn(10.5, 6, 10.5, 'coal', 2);
    const far = new Vector3(40, 5, 40);
    for (let i = 0; i < 60; i++) drops.update(DT, w, far, inv);
    expect(drops.list.length).toBe(1);
    expect(drops.list[0].pos.y).toBeLessThan(4.5); // resting on the floor (top at y = 4)
    const near = new Vector3(12, 5, 11);
    let picked = 0;
    for (let i = 0; i < 60; i++) picked += drops.update(DT, w, near, inv).length;
    expect(picked).toBe(1);
    expect(inv.count('coal')).toBe(2);
    expect(drops.list.length).toBe(0);
  });
});

describe('Save format', () => {
  it('round-trips block edits', () => {
    const edits = new Map([[123, new Map([[5, 7], [900, 0]])], [77, new Map<number, number>()]]);
    const back = editsFromSave(editsToSave(edits));
    expect(back.get(123)).toEqual(new Map([[5, 7], [900, 0]]));
    expect(back.has(77)).toBe(false);
  });

  it('creates new saves with ids and names', () => {
    const a = newSave('  ', 5);
    expect(a.name).toBe('New World');
    expect(a.seed).toBe(5);
    expect(a.id).not.toBe(newSave('x', 5).id);
  });
});
