import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import { Block, SOLID } from '../src/world/blocks';
import { colIndex } from '../src/world/chunk';
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

  it('has bedrock at the bottom and water in low ground', () => {
    let low = 0, wet = 0;
    for (let cx = -12; cx <= 12; cx += 3)
      for (let cz = -12; cz <= 12; cz += 6) {
        const col = gen.generate(cx, cz);
        for (let z = 0; z < 16; z += 5)
          for (let x = 0; x < 16; x += 5) {
            expect(col.blocks[colIndex(x, 0, z)]).toBe(Block.BEDROCK);
            if (gen.height(cx * 16 + x, cz * 16 + z) < WORLD.SEA_LEVEL - 8) {
              low++;
              const b = col.blocks[colIndex(x, WORLD.SEA_LEVEL, z)];
              if (b === Block.WATER) wet++;
            }
          }
      }
    if (low > 0) expect(wet / low).toBeGreaterThan(0.6);
  });

  it('grows plants and has floating land and several moods', () => {
    let plants = 0, sky = 0;
    const moods = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const cx = k * 11 - 200, cz = (k % 7) * 13 - 40;
      moods.add(gen.mood(cx * 16, cz * 16));
      const col = gen.generate(cx, cz);
      for (let i = 0; i < col.blocks.length; i++) {
        const b = col.blocks[i];
        if (b === Block.TALL_GRASS || b === Block.GOLD_TUFT || b === Block.FERN) plants++;
        if (SOLID[b] && i >= colIndex(0, 125, 0) && i < colIndex(0, 190, 0)) sky++;
      }
    }
    expect(plants).toBeGreaterThan(100);
    expect(sky).toBeGreaterThan(0);
    expect(moods.size).toBeGreaterThanOrEqual(3);
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
