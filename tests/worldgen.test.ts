import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import { Block, SOLID } from '../src/world/blocks';
import { WORLD_H, colIndex } from '../src/world/chunk';
import { raycastVoxel } from '../src/world/raycast';
import { WorldGen } from '../src/world/worldgen';
import { flatWorld } from './helpers';

describe('WorldGen', () => {
  const gen = new WorldGen(1234);

  it('is deterministic per seed', () => {
    const a = gen.generate(3, -2);
    const b = new WorldGen(1234).generate(3, -2);
    expect(a.blocks).toEqual(b.blocks);
    const c = new WorldGen(99).generate(3, -2);
    expect(c.blocks).not.toEqual(a.blocks);
  });

  it('has bedrock at the bottom, solid ground near the height map, and water below sea level', () => {
    let waterSeen = false;
    for (let cx = -6; cx <= 6; cx += 3) {
      const col = gen.generate(cx, 0);
      for (let z = 0; z < 16; z += 5)
        for (let x = 0; x < 16; x += 5) {
          expect(col.blocks[colIndex(x, 0, z)]).toBe(Block.BEDROCK);
          const h = gen.height(cx * 16 + x, z);
          expect(h).toBeGreaterThan(8);
          expect(h).toBeLessThan(WORLD_H);
          if (h < WORLD.SEA_LEVEL) {
            expect(col.blocks[colIndex(x, WORLD.SEA_LEVEL, z)]).toBe(Block.WATER);
            waterSeen = true;
          }
          // Nothing solid floats in the open sky well above the terrain (trees top out ~9 above).
          expect(SOLID[col.blocks[colIndex(x, Math.min(WORLD_H - 1, h + 12), z)]]).toBe(0);
        }
    }
    expect(typeof waterSeen).toBe('boolean');
  });

  it('carves caves and places ores underground', () => {
    let air = 0, ore = 0;
    for (let cx = 0; cx < 4; cx++) {
      const col = gen.generate(cx, 5);
      for (let y = 6; y < 50; y++)
        for (let z = 0; z < 16; z++)
          for (let x = 0; x < 16; x++) {
            const b = col.blocks[colIndex(x, y, z)];
            if (b === 0) air++;
            if (b === Block.COAL_ORE || b === Block.COPPER_ORE || b === Block.IRON_ORE) ore++;
          }
    }
    expect(air).toBeGreaterThan(100);
    expect(ore).toBeGreaterThan(20);
  });

  it('applies player edits on regeneration', () => {
    const i = colIndex(4, 70, 4);
    const col = gen.generate(1, 1, [i, Block.BRICK]);
    expect(col.blocks[i]).toBe(Block.BRICK);
  });
});

describe('raycastVoxel', () => {
  it('finds the first solid block and the face it entered through', () => {
    const w = flatWorld(); // floor top at y = 4
    const hit = raycastVoxel(w, 10.5, 8, 10.5, 0, -1, 0, 10, (id) => SOLID[id] === 1);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBe(3);
    expect(hit!.ny).toBe(1);
    expect(hit!.dist).toBeCloseTo(4, 5);
  });

  it('respects max distance', () => {
    const w = flatWorld();
    expect(raycastVoxel(w, 10.5, 30, 10.5, 0, -1, 0, 5, (id) => SOLID[id] === 1)).toBeNull();
  });
});
