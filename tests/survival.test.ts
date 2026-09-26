import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { COMBAT, DAYNIGHT, ENEMIES, SURVIVAL } from '../src/config';
import { CombatSystem } from '../src/combat/combatSystem';
import { Husk } from '../src/enemies/husk';
import { Spawner } from '../src/enemies/spawner';
import { RECIPES, canCraft, nearbyStations } from '../src/items/crafting';
import { Inventory } from '../src/items/inventory';
import { ITEMS, blockDrop } from '../src/items/items';
import { DayNight } from '../src/survival/daynight';
import { Hunger } from '../src/survival/hunger';
import { Memory } from '../src/survival/memory';
import { Temperature, ambientTemperature, heatAt } from '../src/survival/temperature';
import { Block } from '../src/world/blocks';
import { DT, flatWorld, playerOnGround } from './helpers';

const run = (seconds: number, f: (dt: number) => void) => {
  for (let t = 0; t < seconds; t += DT) f(DT);
};

describe('DayNight', () => {
  it('cycles light, counts days and passes nights faster', () => {
    const d = new DayNight();
    d.time = 0.25;
    expect(d.daylight()).toBeCloseTo(1);
    expect(d.night()).toBe(0);
    d.time = 0.75;
    expect(d.daylight()).toBeCloseTo(DAYNIGHT.NIGHT_LIGHT);
    expect(d.night()).toBe(1);
    expect(d.isNight()).toBe(true);

    // Day half (0 → 0.5) takes longer than the night half.
    const timeFor = (from: number, to: number) => {
      const dn = new DayNight();
      dn.time = from;
      let s = 0;
      while (dn.time < to) {
        dn.update(1);
        s++;
      }
      return s;
    };
    expect(timeFor(0.5, 0.999)).toBeLessThan(timeFor(0.001, 0.5));

    d.time = 0.99;
    d.update(DAYNIGHT.DAY_LENGTH * 0.02);
    expect(d.day).toBe(2);
    d.time = 0.8;
    d.skipToMorning();
    expect(d.day).toBe(3);
    expect(d.isNight()).toBe(false);
  });
});

describe('Hunger', () => {
  it('drains, slows dash regen when hungry, and starves', () => {
    const h = new Hunger();
    run(60, (dt) => h.update(dt));
    expect(h.food).toBeCloseTo(SURVIVAL.FOOD_MAX - SURVIVAL.FOOD_DRAIN * 60, 0);
    h.food = 10;
    expect(h.state).toBe('hungry');
    expect(h.regenMult()).toBeLessThan(1);
    h.food = 0;
    let dmg = 0;
    run(SURVIVAL.STARVE_INTERVAL * 3 + 0.1, (dt) => (dmg += h.update(dt).damage));
    expect(dmg).toBe(SURVIVAL.STARVE_DAMAGE * 3);
  });

  it('eats after holding, and food heals over time', () => {
    const h = new Hunger();
    h.food = 20;
    let ate = false;
    run(SURVIVAL.EAT_TIME * 0.5, (dt) => (ate ||= h.updateEating(dt, true)));
    expect(ate).toBe(false);
    h.updateEating(DT, false); // let go: progress resets
    expect(h.eating).toBe(0);
    run(SURVIVAL.EAT_TIME + 0.05, (dt) => (ate ||= h.updateEating(dt, true)));
    expect(ate).toBe(true);
    const stew = ITEMS.glowcap_stew.food!;
    h.eat(stew);
    expect(h.food).toBe(20 + stew.food);
    let healed = 0;
    run(10, (dt) => (healed += h.update(dt).heal));
    expect(healed).toBeGreaterThanOrEqual(stew.heal - 0.01);
  });

  it('exertion costs food', () => {
    const h = new Hunger();
    h.exert(SURVIVAL.FOOD_PER_DASH * 10);
    expect(h.food).toBeCloseTo(SURVIVAL.FOOD_MAX - SURVIVAL.FOOD_PER_DASH * 10);
  });
});

describe('Temperature', () => {
  const open = { skyLight: 15, night: 0, inWater: false, insulation: 0 };

  it('gets colder with altitude and at night, milder under cover', () => {
    const w = flatWorld();
    const low = ambientTemperature(w, 5, 70, 5, open).temp;
    const high = ambientTemperature(w, 5, 140, 5, open).temp;
    const highNight = ambientTemperature(w, 5, 140, 5, { ...open, night: 1 }).temp;
    const cave = ambientTemperature(w, 5, 140, 5, { ...open, night: 1, skyLight: 0 }).temp;
    expect(high).toBeLessThan(low);
    expect(highNight).toBeLessThan(high);
    expect(highNight).toBeLessThan(SURVIVAL.FREEZING_BELOW);
    expect(cave).toBeCloseTo(SURVIVAL.TEMP_SHELTER);
    // Warm clothes help.
    expect(ambientTemperature(w, 5, 140, 5, { ...open, night: 1, insulation: 20 }).temp).toBeGreaterThan(highNight + 10);
  });

  it('campfires warm you, and freezing hurts', () => {
    const w = flatWorld();
    w.setBlock(10, 4, 10, Block.CAMPFIRE);
    expect(heatAt(w, 11.5, 4, 10.5)).toBeGreaterThan(10);
    expect(heatAt(w, 30, 4, 30)).toBe(0);

    const t = new Temperature();
    const cold = { skyLight: 15, night: 1, inWater: false, insulation: 0 };
    let dmg = 0;
    run(120, (dt) => (dmg += t.update(dt, w, 40, 150, 40, cold)));
    expect(t.state).toBe('freezing');
    expect(dmg).toBeGreaterThan(0);
    expect(t.foodMult()).toBeGreaterThan(1);
    expect(t.moveMult()).toBeLessThan(1);
    // Sit by the fire.
    run(60, (dt) => t.update(dt, w, 11.5, 4, 10.5, { ...cold, skyLight: 15 }));
    expect(t.body).toBeGreaterThan(SURVIVAL.COLD_BELOW);
    expect(t.nearFire).toBe(true);
  });
});

describe('Memory (death drops)', () => {
  it('stores coins at death, loses them on a second death, reclaims on touch', () => {
    const inv = new Inventory();
    const m = new Memory();
    inv.add('coin', 30);
    expect(m.onDeath(10, 5, 10, inv)).toEqual({ lost: 0, stored: 30 });
    expect(inv.count('coin')).toBe(0);
    inv.add('coin', 4);
    // Die again before going back: the first memory is gone.
    expect(m.onDeath(50, 5, 50, inv)).toEqual({ lost: 30, stored: 4 });
    expect(m.update(0, 4, 0, inv)).toBe(0);
    expect(m.update(50, 4.2, 50, inv)).toBe(4);
    expect(inv.count('coin')).toBe(4);
    expect(m.orb).toBeNull();
  });
});

describe('Armor', () => {
  it('equips into the right slot and absorbs enemy damage', () => {
    const inv = new Inventory();
    inv.add('iron_cuirass', 1);
    inv.add('feather_hood', 1);
    inv.quickMove(0);
    inv.quickMove(1);
    expect(inv.armor[1]?.item).toBe('iron_cuirass');
    expect(inv.armor[0]?.item).toBe('feather_hood');
    expect(inv.slots[0]).toBeNull();
    expect(inv.defense()).toBeCloseTo(ITEMS.iron_cuirass.armor!.defense + ITEMS.feather_hood.armor!.defense);
    expect(inv.warmth()).toBe(ITEMS.iron_cuirass.armor!.warmth + ITEMS.feather_hood.armor!.warmth);
    // A helm can't go in the legs slot.
    expect(inv.clickArmor(2, { item: 'iron_helm', count: 1 })).toEqual({ item: 'iron_helm', count: 1 });

    const w = flatWorld();
    const hurt = (mult: number) => {
      const p = playerOnGround(w);
      const cs = new CombatSystem(p, w, () => {});
      cs.damageTakenMult = mult;
      const h = new Husk(32.5, 4, 30.5, () => 0.99);
      h.yaw = Math.PI; // face +z toward the player
      cs.enemies.push(h);
      (cs as unknown as { resolveEnemyMelee: (d: unknown, a: unknown) => void }).resolveEnemyMelee(h, ENEMIES.HUSK.ATTACKS.slash);
      return COMBAT.PLAYER_MAX_HEALTH - cs.combat.health;
    };
    const bare = hurt(1);
    expect(bare).toBeGreaterThan(0);
    expect(hurt(1 - inv.defense())).toBeCloseTo(bare * (1 - inv.defense()));
  });
});

describe('Survival items', () => {
  it('cooks at a campfire and crafts a bed from feathers', () => {
    const w = flatWorld();
    w.setBlock(20, 4, 20, Block.CAMPFIRE);
    const stations = nearbyStations(w, 21, 5, 20);
    expect(stations.has('campfire')).toBe(true);
    const inv = new Inventory();
    inv.add('crow_meat', 1);
    expect(canCraft(inv, RECIPES.find((r) => r.output.item === 'roast_crow')!, stations)).toBe(true);
    inv.add('planks', 3);
    inv.add('feather', 4);
    expect(canCraft(inv, RECIPES.find((r) => r.output.item === 'bed')!, new Set(['hand', 'workbench']))).toBe(true);
    expect(blockDrop(Block.BERRY_BUSH)).toBe('duskberries');
    expect(blockDrop(Block.GLOWSHROOM)).toBe('glowcap');
    expect(blockDrop(Block.BED)).toBe('bed');
  });
});

describe('Night spawns', () => {
  it('husks roam the open surface at night but not by day, and nightborn are tougher', () => {
    const w = flatWorld();
    w.lightAll();
    const count = (env: { daylight: number; night: number }) => {
      const s = new Spawner(() => 0.3);
      let husks = 0;
      for (let i = 0; i < 20; i++)
        husks += s.update(2, w, new Vector3(32, 4, 32), [], new Set(), env).filter((e) => e.kind === 'husk').length;
      return husks;
    };
    expect(count({ daylight: 1, night: 0 })).toBe(0);
    expect(count({ daylight: DAYNIGHT.NIGHT_LIGHT, night: 1 })).toBeGreaterThan(0);
    const nb = new Husk(0, 4, 0, Math.random, true);
    expect(nb.maxHealth).toBe(ENEMIES.HUSK.HEALTH * ENEMIES.NIGHTBORN_HEALTH_MULT);
    expect(nb.damageMult).toBe(ENEMIES.NIGHTBORN_DAMAGE_MULT);
  });
});
