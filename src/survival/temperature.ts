import { SURVIVAL } from '../config';
import { Block, SHAPE } from '../world/blocks';
import type { VoxelQuery } from '../world/world';

export type TempState = 'freezing' | 'cold' | 'ok' | 'warm' | 'hot';

const HEAT_BLOCKS: [number, readonly [number, number]][] = [
  [Block.CAMPFIRE, SURVIVAL.HEAT.campfire],
  [Block.FORGE, SURVIVAL.HEAT.forge],
  [Block.LANTERN, SURVIVAL.HEAT.lantern],
  [Block.TORCH, SURVIVAL.HEAT.torch],
];
const SCAN = Math.ceil(Math.max(...HEAT_BLOCKS.map(([, [, r]]) => r)));

/** Warmth from fires and lights near a point (°C). */
export function heatAt(world: VoxelQuery, x: number, y: number, z: number): number {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  let best = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dz = -SCAN; dz <= SCAN; dz++)
      for (let dx = -SCAN; dx <= SCAN; dx++) {
        const id = world.getBlock(bx + dx, by + dy, bz + dz);
        if (id === 0) continue;
        for (const [b, [heat, radius]] of HEAT_BLOCKS) {
          if (id !== b) continue;
          const d = Math.hypot(dx, dy, dz);
          if (d <= radius) best = Math.max(best, heat * (1 - d / (radius + 1)));
        }
      }
  return best;
}

export interface Weather {
  /** Sky light at the player's head (0..15). */
  skyLight: number;
  /** 0 day → 1 night. */
  night: number;
  inWater: boolean;
  /** Warmth from worn armor and food buffs (°C). */
  insulation: number;
}

/** What the air feels like at a point, before your body adapts. */
export function ambientTemperature(world: VoxelQuery, x: number, y: number, z: number, w: Weather): { temp: number; fire: number } {
  let t = SURVIVAL.TEMP_BASE - Math.max(0, y - SURVIVAL.TEMP_ALTITUDE_START) * SURVIVAL.TEMP_PER_BLOCK;
  t += SURVIVAL.TEMP_NIGHT * w.night;
  // Sheltered from the sky (caves, huts), the air settles toward a mild constant.
  const exposure = Math.min(1, w.skyLight / 12);
  t = SURVIVAL.TEMP_SHELTER + (t - SURVIVAL.TEMP_SHELTER) * exposure;
  if (w.inWater) t += SURVIVAL.TEMP_WATER;
  const fire = heatAt(world, x, y + 1, z);
  // Clothing only matters when it's cold.
  const comfy = 18;
  if (t < comfy) t = Math.min(comfy, t + w.insulation);
  return { temp: t + fire, fire };
}

/** Body temperature: drifts toward the felt temperature. */
export class Temperature {
  body: number = SURVIVAL.TEMP_BASE;
  /** Last ambient reading. */
  ambient: number = SURVIVAL.TEMP_BASE;
  nearFire = false;
  private scanTimer = 0;
  private freezeTimer = 0;

  get state(): TempState {
    if (this.body < SURVIVAL.FREEZING_BELOW) return 'freezing';
    if (this.body < SURVIVAL.COLD_BELOW) return 'cold';
    if (this.body > SURVIVAL.HOT_ABOVE) return 'hot';
    if (this.nearFire) return 'warm';
    return 'ok';
  }

  /** Hunger drain multiplier from the cold. */
  foodMult(): number {
    return this.body < SURVIVAL.COLD_BELOW ? SURVIVAL.COLD_FOOD_MULT : 1;
  }

  moveMult(): number {
    return this.body < SURVIVAL.FREEZING_BELOW ? SURVIVAL.FREEZE_MOVE_MULT : 1;
  }

  /** Returns freeze damage to deal this step. */
  update(dt: number, world: VoxelQuery, x: number, y: number, z: number, w: Weather): number {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.5;
      const a = ambientTemperature(world, x, y, z, w);
      this.ambient = a.temp;
      this.nearFire = a.fire > 3;
    }
    // Warming up by a fire is quicker than cooling down.
    const rate = SURVIVAL.TEMP_ADAPT * (this.ambient > this.body && this.nearFire ? 3 : 1);
    this.body += (this.ambient - this.body) * Math.min(1, rate * dt);
    if (this.body < SURVIVAL.FREEZING_BELOW) {
      this.freezeTimer += dt;
      if (this.freezeTimer >= SURVIVAL.FREEZE_INTERVAL) {
        this.freezeTimer = 0;
        return SURVIVAL.FREEZE_DAMAGE;
      }
    } else this.freezeTimer = 0;
    return 0;
  }

  reset(): void {
    this.body = SURVIVAL.TEMP_BASE;
    this.scanTimer = 0;
    this.freezeTimer = 0;
  }
}

/** Blocks that are water (for "in water" checks). */
export const isWater = (id: number) => SHAPE[id] === 'water';
