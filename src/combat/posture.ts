import { COMBAT } from '../config';

/** Sekiro-style posture: damage fills it; when full it breaks. Recovers after a short delay. */
export class Posture {
  value = 0;
  private sinceDamage = Infinity;

  constructor(public max: number) {}

  get fraction(): number {
    return this.value / this.max;
  }

  /** Add posture damage. Returns true if this broke posture. */
  damage(amount: number): boolean {
    if (amount <= 0) return false;
    this.sinceDamage = 0;
    const was = this.value;
    this.value = Math.min(this.max, this.value + amount);
    return was < this.max && this.value >= this.max;
  }

  /** Regenerate. `mult` scales the rate (guarding, aggression, low health…). */
  update(dt: number, mult = 1): void {
    this.sinceDamage += dt;
    if (this.sinceDamage < COMBAT.POSTURE_REGEN_DELAY) return;
    this.value = Math.max(0, this.value - this.max * COMBAT.POSTURE_REGEN_RATE * mult * dt);
  }

  reset(): void {
    this.value = 0;
    this.sinceDamage = Infinity;
  }
}
