import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../src/config';
import { Inventory } from '../src/items/inventory';
import { ITEMS } from '../src/items/items';
import { Builder } from '../src/player/builder';
import { areaTargets, findTree } from '../src/player/harvest';
import { Block } from '../src/world/blocks';
import { DT, flatWorld } from './helpers';

describe('area mining', () => {
  it('a wooden pickaxe takes a 3×3 patch of natural rock across the face it hits', () => {
    const w = flatWorld();
    // Top face of the ground at y = 3, hit from above.
    const hit = { x: 10, y: 3, z: 10, nx: 0, ny: 1, nz: 0 };
    const got = areaTargets(w, hit, ITEMS.wooden_pickaxe.tool!);
    expect(got.length).toBe(8);
    expect(got.every((b) => b.y === 3)).toBe(true);
    const iron = areaTargets(w, hit, ITEMS.iron_pickaxe.tool!);
    expect(iron.length).toBe(5 * 5 * 2 - 1);
  });

  it('never takes player-built blocks or blocks the tool is too weak for', () => {
    const w = flatWorld();
    w.recordEdits = true;
    w.setBlock(11, 3, 10, Block.STONE_BRICK); // built
    w.setBlock(9, 3, 10, Block.IRON_ORE); // natural but needs iron... placed via setBlock counts as built
    w.recordEdits = false;
    w.setBlock(10, 3, 11, Block.IRON_ORE); // generated
    const got = areaTargets(w, { x: 10, y: 3, z: 10, nx: 0, ny: 1, nz: 0 }, ITEMS.wooden_pickaxe.tool!);
    const at = (x: number, z: number) => got.some((b) => b.x === x && b.z === z);
    expect(at(11, 10)).toBe(false);
    expect(at(9, 10)).toBe(false);
    expect(at(10, 11)).toBe(false); // iron ore needs an iron pickaxe
    expect(got.length).toBe(5);
  });

  it('the builder breaks the whole patch in one go', () => {
    const w = flatWorld();
    const b = new Builder();
    b.enabled = true;
    const inv = new Inventory();
    inv.add('copper_pickaxe', 1);
    b.aim(w, { x: 20.5, y: 6, z: 20.5 }, { x: 0, y: -1, z: 0 });
    for (let i = 0; i < 600 && !b.events.some((e) => e.type === 'broken'); i++)
      b.update(DT, { mineHeld: true, placeHeld: false, placePressed: false }, w, [], inv);
    expect(b.events.filter((e) => e.type === 'broken').length).toBe(3 * 3 * 2);
    expect(w.getBlock(21, 2, 21)).toBe(0);
  });
});

describe('tree felling', () => {
  const tree = () => {
    const w = flatWorld();
    for (let y = 4; y < 10; y++) w.setBlock(30, y, 30, Block.LOG);
    for (let x = 28; x <= 32; x++) for (let z = 28; z <= 32; z++) for (let y = 9; y <= 11; y++) if (!w.getBlock(x, y, z)) w.setBlock(x, y, z, Block.LEAVES);
    return w;
  };

  it('finds the logs above the cut and the canopy', () => {
    const w = tree();
    const t = findTree(w, 30, 4, 30);
    expect(t.filter((b) => b.id === Block.LOG).length).toBe(5);
    expect(t.filter((b) => b.id === Block.LEAVES).length).toBeGreaterThan(50);
    // Chopping higher up only takes what's above.
    expect(findTree(w, 30, 7, 30).filter((b) => b.id === Block.LOG).length).toBe(2);
  });

  it('chopping one log fells the tree (but never player-built log walls)', () => {
    const w = tree();
    const b = new Builder();
    b.enabled = true;
    const inv = new Inventory();
    b.aim(w, { x: 32.5, y: 4.5, z: 30.5 }, { x: -1, y: 0, z: 0 });
    for (let i = 0; i < 600 && !b.events.some((e) => e.type === 'fell'); i++)
      b.update(DT, { mineHeld: true, placeHeld: false, placePressed: false }, w, [], inv);
    const fell = b.events.find((e) => e.type === 'fell');
    expect(fell).toBeDefined();
    expect(w.getBlock(30, 8, 30)).toBe(0);
    expect(w.getBlock(30, 10, 30)).toBe(0);

    const w2 = flatWorld();
    w2.recordEdits = true;
    for (let y = 4; y < 8; y++) w2.setBlock(40, y, 40, Block.LOG);
    expect(findTree(w2, 40, 4, 40)).toEqual([]);
  });
});

describe('trinkets', () => {
  it('start with the base kit and add up what is worn', () => {
    const inv = new Inventory();
    expect(inv.abilities()).toEqual(UPGRADES.BASE);
    inv.add('copper_band', 1);
    inv.add('grappling_hook', 1);
    inv.add('climbing_claws', 1);
    inv.add('feather_charm', 1);
    for (let i = 0; i < 4; i++) inv.quickMove(i);
    // Only three slots: the fourth swapped the first one back out.
    expect(inv.trinkets.every((t) => t)).toBe(true);
    const a = inv.abilities();
    expect(a.airJumps).toBe(1);
    expect(a.grapple).toBe(true);
    expect(a.wallRun).toBe(true);
    expect(inv.count('copper_band')).toBe(1);
    expect(inv.clickTrinket(0, { item: 'iron_helm', count: 1 })).toEqual({ item: 'iron_helm', count: 1 });
  });
});
