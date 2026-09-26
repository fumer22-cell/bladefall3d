import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import { Column, WORLD_H, colIndex } from '../src/world/chunk';
import { computeColumnLight } from '../src/world/lighting';
import { World } from '../src/world/world';

const sky = (w: World, x: number, y: number, z: number) => w.getLight(x, y, z) >> 4;
const blk = (w: World, x: number, y: number, z: number) => w.getLight(x, y, z) & 15;

/** 3×3 columns (x,z in [0,48)) with a stone floor at y ≤ 10, lit. */
function litWorld(build?: (w: World) => void): World {
  const w = new World();
  for (let cz = 0; cz < 3; cz++) for (let cx = 0; cx < 3; cx++) w.addColumn(new Column(cx, cz));
  w.fill(0, 0, 0, 47, 10, 47, Block.STONE);
  build?.(w);
  w.lightAll();
  return w;
}

describe('computeColumnLight', () => {
  it('fills an empty column with full sunlight', () => {
    const blocks = new Uint16Array(16 * 16 * WORLD_H);
    const light = new Uint8Array(blocks.length);
    computeColumnLight(blocks, light);
    expect(light[colIndex(3, 0, 3)] >> 4).toBe(15);
  });

  it('is dark under a full roof and lit by an emitter', () => {
    const blocks = new Uint16Array(16 * 16 * WORLD_H);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[colIndex(x, 100, z)] = Block.STONE;
    blocks[colIndex(8, 50, 8)] = Block.TORCH;
    const light = new Uint8Array(blocks.length);
    computeColumnLight(blocks, light);
    expect(light[colIndex(8, 99, 8)] >> 4).toBe(0);
    expect(light[colIndex(8, 50, 8)] & 15).toBe(14);
    expect(light[colIndex(8, 52, 8)] & 15).toBe(12);
  });

  it('dims sunlight through leaves and water', () => {
    const blocks = new Uint16Array(16 * 16 * WORLD_H);
    blocks[colIndex(5, 60, 5)] = Block.LEAVES;
    const light = new Uint8Array(blocks.length);
    computeColumnLight(blocks, light);
    expect(light[colIndex(5, 59, 5)] >> 4).toBeLessThan(15);
  });
});

describe('World lighting', () => {
  it('spreads skylight sideways under an overhang, across column borders', () => {
    // Roof over x < 20 at y = 14; open sky beyond.
    const w = litWorld((w) => w.fill(0, 14, 0, 19, 14, 47, Block.STONE));
    expect(sky(w, 25, 11, 20)).toBe(15);
    expect(sky(w, 19, 11, 20)).toBe(14); // just under the edge
    expect(sky(w, 12, 11, 20)).toBe(7);
    expect(sky(w, 2, 11, 20)).toBe(0);
  });

  it('placing a torch lights the area; removing it darkens it again', () => {
    const w = litWorld((w) => w.fill(0, 14, 0, 47, 14, 47, Block.STONE));
    expect(blk(w, 20, 11, 20)).toBe(0);
    w.setBlock(20, 11, 20, Block.TORCH);
    expect(blk(w, 20, 11, 20)).toBe(14);
    expect(blk(w, 23, 11, 20)).toBe(11);
    expect(blk(w, 16, 11, 20)).toBe(10); // crosses the column border at x = 16
    w.setBlock(20, 11, 20, 0);
    expect(blk(w, 20, 11, 20)).toBe(0);
    expect(blk(w, 16, 11, 20)).toBe(0);
  });

  it('breaking a roof lets sunlight pour down; closing it darkens the shaft', () => {
    const w = litWorld((w) => w.fill(0, 14, 0, 47, 20, 47, Block.STONE));
    expect(sky(w, 24, 11, 24)).toBe(0);
    for (let y = 14; y <= 20; y++) w.setBlock(24, y, 24, 0);
    expect(sky(w, 24, 11, 24)).toBe(15);
    expect(sky(w, 25, 11, 24)).toBe(14);
    w.setBlock(24, 20, 24, Block.STONE);
    expect(sky(w, 24, 11, 24)).toBe(0);
    expect(sky(w, 25, 11, 24)).toBe(0);
  });

  it('marks meshes around a light change dirty', () => {
    const w = litWorld((w) => w.fill(0, 14, 0, 47, 14, 47, Block.STONE));
    w.dirty.clear();
    w.setBlock(20, 11, 20, Block.TORCH);
    expect(w.dirty.size).toBeGreaterThan(1);
  });
});
