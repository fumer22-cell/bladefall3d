import { BUILD, TIERS } from '../config';
import type { Inventory } from '../items/inventory';
import { ITEMS, blockDrop, type ItemDef } from '../items/items';
import { BLOCKS, SHAPE } from '../world/blocks';
import { boxOverlapsSolid, type AABB } from '../world/collision';
import { raycastVoxel, type VoxelHit } from '../world/raycast';
import type { World } from '../world/world';

export interface BuildIntent {
  mineHeld: boolean;
  placeHeld: boolean;
  placePressed: boolean;
}

export type BuildEvent =
  | { type: 'broken'; x: number; y: number; z: number; id: number; drop: string | null }
  | { type: 'placed'; x: number; y: number; z: number; id: number }
  | { type: 'mineTick' }
  | { type: 'tooWeak'; needed: number };

const targetable = (id: number) => id !== 0 && SHAPE[id] !== 'water';

const TIER_NAMES = ['bare hands', 'a wooden pickaxe', 'a copper pickaxe', 'an iron pickaxe'];
export function tierName(tier: number): string {
  return TIER_NAMES[tier] ?? `a tier ${tier} pickaxe`;
}

/**
 * Mining and placing with whatever is in hand (anything but a weapon):
 * hold attack to mine the targeted block, block/place button places the held block item.
 */
export class Builder {
  /** Active when the held item isn't a weapon. */
  enabled = false;
  target: VoxelHit | null = null;
  /** Mining progress 0..1 on the current target. */
  progress = 0;
  private placeCooldown = 0;
  private mineSound = 0;
  private warned = false;
  events: BuildEvent[] = [];

  /** Update the looked-at block (every frame, for the highlight). */
  aim(world: World, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void {
    const hit = raycastVoxel(world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, BUILD.REACH, targetable);
    const t = this.target;
    if (!hit || !t || hit.x !== t.x || hit.y !== t.y || hit.z !== t.z) {
      this.progress = 0;
      this.warned = false;
    }
    this.target = hit;
  }

  /** `blockers` are boxes a placed block must not overlap (player, enemies). */
  update(dt: number, input: BuildIntent, world: World, blockers: AABB[], inv: Inventory): void {
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    const t = this.target;
    const held: ItemDef | null = inv.held ? ITEMS[inv.held.item] : null;
    if (!this.enabled || !t) {
      this.progress = 0;
      return;
    }

    if (input.mineHeld) this.mine(dt, world, t, held);
    else {
      this.progress = 0;
      this.warned = false;
    }

    if (held?.block !== undefined && (input.placePressed || (input.placeHeld && this.placeCooldown <= 0)) && this.target) {
      this.place(world, t, held.block, blockers, inv);
    }
  }

  private mine(dt: number, world: World, t: VoxelHit, held: ItemDef | null): void {
    const def = BLOCKS[t.id];
    if (!Number.isFinite(def.hardness)) return;
    const tool = held?.tool ?? TIERS.HAND;
    if (tool.tier < def.tier) {
      if (!this.warned) this.events.push({ type: 'tooWeak', needed: def.tier });
      this.warned = true;
      return;
    }
    const speed = BUILD.HAND_SPEED * tool.mineSpeed;
    this.progress += def.hardness <= 0 ? 1 : (dt * speed) / def.hardness;
    this.mineSound -= dt;
    if (this.mineSound <= 0) {
      this.mineSound = 0.22;
      this.events.push({ type: 'mineTick' });
    }
    if (this.progress >= 1) {
      world.setBlock(t.x, t.y, t.z, 0);
      this.events.push({ type: 'broken', x: t.x, y: t.y, z: t.z, id: t.id, drop: blockDrop(t.id) });
      this.progress = 0;
      this.target = null;
    }
  }

  private place(world: World, t: VoxelHit, id: number, blockers: AABB[], inv: Inventory): void {
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    const cur = world.getBlock(x, y, z);
    if (cur !== 0 && SHAPE[cur] !== 'water') return;
    const cell: AABB = { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
    if (SHAPE[id] === 'cube' && blockers.some((b) => overlaps(b, cell))) return;
    // Torches need something to stand on or lean against.
    if (
      SHAPE[id] === 'torch' &&
      !boxOverlapsSolid(world, { minX: x - 0.5, maxX: x + 1.5, minZ: z - 0.5, maxZ: z + 1.5, minY: y - 0.5, maxY: y + 0.5 })
    )
      return;
    world.setBlock(x, y, z, id);
    inv.consumeHeld();
    this.placeCooldown = BUILD.PLACE_REPEAT;
    this.events.push({ type: 'placed', x, y, z, id });
  }
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
