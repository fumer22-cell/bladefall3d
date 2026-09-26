import { BUILD } from '../config';
import { BLOCKS, Block, SHAPE } from '../world/blocks';
import { boxOverlapsSolid, type AABB } from '../world/collision';
import { raycastVoxel, type VoxelHit } from '../world/raycast';
import type { World } from '../world/world';

/** Blocks you can place in build mode (until Phase 4 brings a real inventory). */
export const BUILD_PALETTE: number[] = [
  Block.PLANKS, Block.COBBLE, Block.STONE_BRICK, Block.DIRT, Block.LOG,
  Block.TORCH, Block.BRICK, Block.SAND, Block.ICE,
];

export interface BuildIntent {
  mineHeld: boolean;
  placeHeld: boolean;
  placePressed: boolean;
}

export type BuildEvent =
  | { type: 'broken'; x: number; y: number; z: number; id: number }
  | { type: 'placed'; x: number; y: number; z: number; id: number }
  | { type: 'mineTick' };

const targetable = (id: number) => id !== 0 && SHAPE[id] !== 'water';

/** Build mode: hold to mine the targeted block, place the selected palette block against faces. */
export class Builder {
  enabled = false;
  selected = 0;
  target: VoxelHit | null = null;
  /** Mining progress 0..1 on the current target. */
  progress = 0;
  private placeCooldown = 0;
  private mineSound = 0;
  events: BuildEvent[] = [];

  get selectedBlock(): number {
    return BUILD_PALETTE[this.selected];
  }

  select(i: number): void {
    this.selected = ((i % BUILD_PALETTE.length) + BUILD_PALETTE.length) % BUILD_PALETTE.length;
  }

  /** Update the looked-at block (every frame, for the highlight). */
  aim(world: World, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void {
    const hit = raycastVoxel(world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, BUILD.REACH, targetable);
    const t = this.target;
    if (!hit || !t || hit.x !== t.x || hit.y !== t.y || hit.z !== t.z) this.progress = 0;
    this.target = hit;
  }

  /** `blockers` are boxes a placed block must not overlap (player, enemies). */
  update(dt: number, input: BuildIntent, world: World, blockers: AABB[]): void {
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    const t = this.target;
    if (!this.enabled || !t) {
      this.progress = 0;
      return;
    }

    if (input.mineHeld) {
      const hardness = BLOCKS[t.id].hardness;
      if (Number.isFinite(hardness)) {
        this.progress += hardness <= 0 ? 1 : (dt * BUILD.MINE_SPEED) / hardness;
        this.mineSound -= dt;
        if (this.mineSound <= 0) {
          this.mineSound = 0.22;
          this.events.push({ type: 'mineTick' });
        }
        if (this.progress >= 1) {
          world.setBlock(t.x, t.y, t.z, 0);
          this.events.push({ type: 'broken', x: t.x, y: t.y, z: t.z, id: t.id });
          this.progress = 0;
          this.target = null;
        }
      }
    } else {
      this.progress = 0;
    }

    if ((input.placePressed || (input.placeHeld && this.placeCooldown <= 0)) && this.target) {
      const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
      const cur = world.getBlock(x, y, z);
      if (cur !== 0 && SHAPE[cur] !== 'water') return;
      const cell: AABB = { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
      const id = this.selectedBlock;
      const solid = SHAPE[id] === 'cube';
      if (solid && blockers.some((b) => overlaps(b, cell))) return;
      // Torches need something to stand on or lean against.
      if (SHAPE[id] === 'torch' && !boxOverlapsSolid(world, { ...cell, minX: x - 0.5, maxX: x + 1.5, minZ: z - 0.5, maxZ: z + 1.5, minY: y - 0.5, maxY: y + 0.5 })) return;
      world.setBlock(x, y, z, id);
      this.placeCooldown = BUILD.PLACE_REPEAT;
      this.events.push({ type: 'placed', x, y, z, id });
    }
  }
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
