import { describe, expect, it } from 'vitest';
import { greedyMesh } from '../src/render/mesher';
import { Block } from '../src/world/blocks';
import { World } from '../src/world/world';

const quads = (w: World, cx = 0, cy = 0, cz = 0) => greedyMesh(w.buildPadded(cx, cy, cz)).indices.length / 6;

describe('greedyMesh', () => {
  it('meshes a single block as 6 quads', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.STONE);
    expect(quads(w)).toBe(6);
  });

  it('merges a row of identical blocks into 6 quads', () => {
    const w = new World();
    w.fill(2, 5, 5, 9, 5, 5, Block.STONE);
    expect(quads(w)).toBe(6);
  });

  it('merges a full slab into 6 quads', () => {
    const w = new World();
    w.fill(0, 0, 0, 15, 0, 15, Block.STONE);
    expect(quads(w)).toBe(6);
  });

  it('does not merge different block types', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.STONE);
    w.setBlock(6, 5, 5, Block.DIRT);
    // 4 side faces each + 1 end each, not merged: 10.
    expect(quads(w)).toBe(10);
  });

  it('assigns faces across a chunk border to exactly one chunk each', () => {
    const w = new World();
    w.setBlock(15, 5, 5, Block.STONE); // chunk 0
    w.setBlock(16, 5, 5, Block.STONE); // chunk 1
    // Shared face is hidden; each chunk emits 5 faces.
    expect(quads(w, 0)).toBe(5);
    expect(quads(w, 1)).toBe(5);
  });

  it('emits outward-facing normals with correct winding', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.STONE);
    const m = greedyMesh(w.buildPadded(0, 0, 0));
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((i) => [
        m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2],
      ]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const i = m.indices[t] * 3;
      const dot = cross[0] * m.normals[i] + cross[1] * m.normals[i + 1] + cross[2] * m.normals[i + 2];
      expect(dot).toBeGreaterThan(0);
    }
  });
});
