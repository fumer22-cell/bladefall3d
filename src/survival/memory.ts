import { SURVIVAL } from '../config';
import type { Inventory } from '../items/inventory';

export interface MemoryOrb {
  x: number;
  y: number;
  z: number;
  coins: number;
}

/**
 * Death: your Grave Coins stay behind in a glowing memory where you fell. Walk into it to take
 * them back. Die again first and that memory is gone for good.
 */
export class Memory {
  orb: MemoryOrb | null = null;

  /** Returns how many coins were lost with the previous memory. */
  onDeath(x: number, y: number, z: number, inv: Inventory): { lost: number; stored: number } {
    const lost = this.orb?.coins ?? 0;
    const coins = inv.takeAll('coin');
    this.orb = coins > 0 ? { x, y, z, coins } : null;
    return { lost, stored: coins };
  }

  /** Reclaim the memory if the player's body touches it. Returns coins recovered (0 if none). */
  update(px: number, py: number, pz: number, inv: Inventory): number {
    const o = this.orb;
    if (!o) return 0;
    if (Math.hypot(px - o.x, py + 0.9 - o.y, pz - o.z) > SURVIVAL.MEMORY_PICKUP_RADIUS) return 0;
    inv.add('coin', o.coins);
    this.orb = null;
    return o.coins;
  }
}
