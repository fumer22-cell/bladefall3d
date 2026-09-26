import { SURVIVAL } from '../config';

export type HungerState = 'fed' | 'ok' | 'hungry' | 'starving';

/**
 * Food meter. It drains slowly, faster when you exert yourself (dashes, swings) or are cold.
 * Eating adds food and fills a heal-over-time pool. Hungry slows dash regen; starving hurts.
 */
export class Hunger {
  food: number = SURVIVAL.FOOD_MAX;
  /** Health still to be healed from food. */
  healPool = 0;
  /** Eating progress 0..1 while RMB is held with food in hand. */
  eating = 0;
  private starveTimer = 0;

  get state(): HungerState {
    if (this.food <= 0) return 'starving';
    if (this.food < SURVIVAL.HUNGRY_BELOW) return 'hungry';
    if (this.food >= SURVIVAL.WELL_FED_ABOVE) return 'fed';
    return 'ok';
  }

  /** Dash-pip regen multiplier. */
  regenMult(): number {
    return this.food < SURVIVAL.HUNGRY_BELOW ? SURVIVAL.HUNGRY_REGEN_MULT : 1;
  }

  exert(amount: number): void {
    this.food = Math.max(0, this.food - amount);
  }

  /**
   * Advance one step. `drainMult` scales the base drain (cold). Returns health to add (healing,
   * positive) and damage to deal (starvation).
   */
  update(dt: number, drainMult = 1): { heal: number; damage: number } {
    this.food = Math.max(0, this.food - SURVIVAL.FOOD_DRAIN * drainMult * dt);
    let heal = 0;
    if (this.healPool > 0) {
      const h = Math.min(this.healPool, SURVIVAL.FOOD_HEAL_RATE * dt);
      this.healPool -= h;
      heal += h;
    }
    if (this.food >= SURVIVAL.WELL_FED_ABOVE) heal += SURVIVAL.WELL_FED_REGEN * dt;
    let damage = 0;
    if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= SURVIVAL.STARVE_INTERVAL) {
        this.starveTimer = 0;
        damage = SURVIVAL.STARVE_DAMAGE;
      }
    } else this.starveTimer = 0;
    return { heal, damage };
  }

  /** Whether eating this would do anything. */
  wants(food: { food: number; heal: number; warm?: boolean }, missingHealth: number): boolean {
    return this.food < SURVIVAL.FOOD_MAX - 0.5 || (food.heal > 0 && missingHealth > 0) || !!food.warm;
  }

  /** Hold-to-eat. Returns true on the step the food is eaten. */
  updateEating(dt: number, holding: boolean): boolean {
    if (!holding) {
      this.eating = 0;
      return false;
    }
    this.eating += dt / SURVIVAL.EAT_TIME;
    if (this.eating < 1) return false;
    this.eating = 0;
    return true;
  }

  eat(food: { food: number; heal: number }): void {
    this.food = Math.min(SURVIVAL.FOOD_MAX, this.food + food.food);
    this.healPool += food.heal;
  }

  reset(food: number = SURVIVAL.FOOD_MAX): void {
    this.food = food;
    this.healPool = 0;
    this.eating = 0;
    this.starveTimer = 0;
  }
}
