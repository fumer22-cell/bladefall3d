import { TEST_ARENA } from '../config';
import { Block } from './blocks';
import type { World } from './world';

/**
 * Phase 1 movement playground. Layout (top-down, spawn in the middle facing -Z / north):
 *  - Checkerboard floor (8×8 tiles) so speed is readable, enclosed by 14-high walls (wall-jump anywhere).
 *  - North: runway with distance stripes every 5 blocks (measure slide-jumps / dash-jumps).
 *  - East: wall-jump shaft (3 wide, 22 tall) and a 30-tall slam tower with stairs.
 *  - West: slide tunnel (1-block ceiling) and an ice rink.
 *  - South: pillar field and floating dash-gap platforms.
 */
export function buildTestArena(world: World): void {
  const S = TEST_ARENA.SIZE;
  const F = TEST_ARENA.FLOOR_TOP; // first air layer
  const top = F - 1;

  // Floor.
  world.fill(0, 0, 0, S - 1, top - 1, S - 1, Block.STONE);
  for (let z = 0; z < S; z++)
    for (let x = 0; x < S; x++)
      world.setBlock(x, top, z, ((x >> 3) + (z >> 3)) & 1 ? Block.GRASS : Block.GRASS_ALT);

  // Perimeter walls.
  const WALL_H = 14;
  world.fill(0, F, 0, S - 1, F + WALL_H - 1, 0, Block.BRICK);
  world.fill(0, F, S - 1, S - 1, F + WALL_H - 1, S - 1, Block.BRICK);
  world.fill(0, F, 0, 0, F + WALL_H - 1, S - 1, Block.BRICK);
  world.fill(S - 1, F, 0, S - 1, F + WALL_H - 1, S - 1, Block.BRICK);

  // --- North: runway with distance markers (starts at z=70, runs toward z=10). ---
  const runX0 = 70, runX1 = 90;
  world.fill(runX0, top, 10, runX1, top, 70, Block.STONE);
  for (let i = 0; i <= 60; i += 5) {
    const z = 70 - i;
    world.fill(runX0, top, z, runX1, top, z, i % 10 === 0 ? Block.MARKER_WHITE : Block.MARKER_YELLOW);
  }
  // Takeoff ledge and landing ramp for slide-jump distance tests.
  world.fill(runX0, F, 64, runX1, F, 70, Block.PLANKS);

  // --- East: wall-jump shaft. Two parallel walls 3 apart, platform on top. ---
  const shX = 130, shZ = 40;
  world.fill(shX, F, shZ, shX, F + 21, shZ + 8, Block.STONE);
  world.fill(shX + 4, F, shZ, shX + 4, F + 21, shZ + 8, Block.STONE);
  world.fill(shX, F + 22, shZ, shX + 4, F + 22, shZ + 8, Block.MARKER_BLUE);
  world.fill(shX + 1, F + 22, shZ + 2, shX + 3, F + 22, shZ + 6, 0); // hole to climb out of

  // Slam tower: 5×5, 30 tall, with a spiral-ish staircase up the outside.
  const tX = 120, tZ = 90, tH = 30;
  world.fill(tX, F, tZ, tX + 4, F + tH - 1, tZ + 4, Block.LOG);
  world.fill(tX, F + tH - 1, tZ, tX + 4, F + tH - 1, tZ + 4, Block.MARKER_RED);
  for (let h = 0; h < tH; h++) {
    // Walk around the tower perimeter one step per block of height.
    const p = h % 24;
    let x: number, z: number;
    if (p < 6) { x = tX - 1 + p; z = tZ - 1; }
    else if (p < 12) { x = tX + 5; z = tZ - 1 + (p - 6); }
    else if (p < 18) { x = tX + 5 - (p - 12); z = tZ + 5; }
    else { x = tX - 1; z = tZ + 5 - (p - 18); }
    world.setBlock(x, F + h, z, Block.PLANKS);
  }

  // Stepped staircase to a mid platform, with jump gaps.
  for (let i = 0; i < 8; i++) world.fill(100 + i * 2, F, 120, 101 + i * 2, F + i, 123, Block.PLANKS);
  world.fill(116, F, 118, 123, F + 7, 125, Block.STONE);

  // --- West: slide tunnel (only 1 block tall inside) ---
  const tunX0 = 20, tunX1 = 22, tunZ0 = 40, tunZ1 = 110;
  world.fill(tunX0 - 1, F, tunZ0, tunX1 + 1, F + 2, tunZ1, Block.STONE);
  world.fill(tunX0, F, tunZ0, tunX1, F, tunZ1, 0);
  // A taller entry/exit mouth so you can walk in before crouching.
  world.fill(tunX0, F, tunZ0, tunX1, F + 1, tunZ0 + 1, 0);
  world.fill(tunX0, F, tunZ1 - 1, tunX1, F + 1, tunZ1, 0);

  // Ice rink.
  world.fill(35, top, 40, 55, top, 110, Block.ICE);

  // --- South: pillar field. ---
  const heights = [2, 3, 4, 6, 8, 10, 5, 7];
  for (let i = 0; i < 16; i++) {
    const px = 30 + (i % 4) * 9;
    const pz = 125 + Math.floor(i / 4) * 8;
    world.fill(px, F, pz, px + 1, F + heights[i % heights.length] - 1, pz + 1, Block.STONE);
  }

  // Floating dash-gap platforms at increasing distances, 3 blocks up.
  let x = 70;
  for (let gap = 4; gap <= 16; gap += 3) {
    world.fill(x, F + 3, 135, x + 3, F + 3, 138, Block.MARKER_BLUE);
    x += 4 + gap;
  }
  world.fill(66, F, 135, 69, F + 2, 138, Block.PLANKS); // start step
}
