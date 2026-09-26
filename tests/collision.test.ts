import { describe, expect, it } from 'vitest';
import { Block } from '../src/world/blocks';
import { moveBox, type AABB } from '../src/world/collision';
import { flatWorld } from './helpers';

const box = (x: number, y: number, z: number): AABB => ({
  minX: x - 0.3, minY: y, minZ: z - 0.3, maxX: x + 0.3, maxY: y + 1.8, maxZ: z + 0.3,
});

describe('moveBox', () => {
  it('lands exactly on the floor', () => {
    const w = flatWorld();
    const b = box(10.5, 6, 10.5);
    const r = moveBox(w, b, 0, -5, 0);
    expect(r.hitY).toBe(true);
    expect(b.minY).toBeCloseTo(4, 6);
  });

  it('does not tunnel through a 1-block wall at high speed', () => {
    const w = flatWorld();
    w.fill(20, 4, 0, 20, 8, 63, Block.STONE);
    const b = box(15.5, 4, 10.5);
    const r = moveBox(w, b, 30, 0, 0);
    expect(r.hitX).toBe(true);
    expect(b.maxX).toBeCloseTo(20, 6);
  });

  it('slides along a wall on the free axis', () => {
    const w = flatWorld();
    w.fill(20, 4, 0, 20, 8, 63, Block.STONE);
    const b = box(19.5, 4, 10.5);
    const r = moveBox(w, b, 1, 0, 2);
    expect(r.hitX).toBe(true);
    expect(r.hitZ).toBe(false);
    expect(b.minZ).toBeCloseTo(12.2, 6);
  });

  it('can walk along a floor while touching it', () => {
    const w = flatWorld();
    const b = box(10.5, 4, 10.5);
    const r = moveBox(w, b, 3, 0, 3);
    expect(r.hitX || r.hitZ).toBe(false);
  });

  it('stops at a ceiling', () => {
    const w = flatWorld();
    w.fill(0, 7, 0, 63, 7, 63, Block.STONE);
    const b = box(10.5, 4, 10.5);
    moveBox(w, b, 0, 5, 0);
    expect(b.maxY).toBeCloseTo(7, 6);
  });
});
