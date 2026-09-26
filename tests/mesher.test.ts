import { describe, expect, it } from 'vitest';
import { greedyMesh } from '../src/render/mesher';
import { Block } from '../src/world/blocks';
import { World } from '../src/world/world';

const mesh = (w: World, cx = 0, cy = 0, cz = 0) => {
  const { blocks, light } = w.buildPadded(cx, cy, cz);
  return greedyMesh(blocks, light);
};
const quads = (w: World, cx = 0, cy = 0, cz = 0) => mesh(w, cx, cy, cz).opaque.indices.length / 6;

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
    w.fill(0, 5, 0, 15, 5, 15, Block.STONE);
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
    const m = mesh(w).opaque;
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

describe('greedyMesh lighting, AO and special shapes', () => {
  it('bakes the light of the cell in front of each face', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.STONE);
    w.lightAll();
    const m = mesh(w).opaque;
    // Open sky around: full sunlight on top and sides; the cell underneath is shaded by the block (14).
    for (let v = 0; v < m.light.length / 2; v++) {
      const down = m.normals[v * 3 + 1] < 0;
      expect(m.light[v * 2]).toBeCloseTo(down ? 14 / 15 : 1, 5);
    }
  });

  it('adds ambient occlusion where a floor meets a wall', () => {
    const w = new World();
    w.fill(0, 5, 0, 15, 5, 15, Block.STONE);
    w.fill(8, 6, 0, 8, 8, 15, Block.STONE);
    const m = mesh(w).opaque;
    expect(Math.max(...m.ao)).toBeGreaterThan(0);
  });

  it('puts water in its own mesh and only draws water faces toward air', () => {
    const w = new World();
    w.fill(2, 5, 2, 4, 5, 4, Block.WATER);
    const { opaque, water } = mesh(w);
    expect(opaque.indices.length).toBe(0);
    expect(water.indices.length / 6).toBe(6); // one merged quad per side of the 3×1×3 pool
  });

  it('meshes torches as small models', () => {
    const w = new World();
    w.setBlock(5, 5, 5, Block.TORCH);
    expect(mesh(w).opaque.indices.length / 6).toBe(12);
  });
});
