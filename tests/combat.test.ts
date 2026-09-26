import { describe, expect, it } from 'vitest';
import { COMBAT, DUMMY, WEAPONS } from '../src/config';
import { resolveDefense } from '../src/combat/defense';
import { directionFromAim, inCone, swingHits } from '../src/combat/melee';
import { NO_COMBAT_INTENT, PlayerCombat, type CombatIntent } from '../src/combat/playerCombat';
import { Posture } from '../src/combat/posture';
import { Dummy } from '../src/combat/trainingDummy';
import { DT, flatWorld } from './helpers';

function run(c: PlayerCombat, intent: Partial<CombatIntent> = {}, n = 1): void {
  for (let i = 0; i < n; i++) c.update(DT, { ...NO_COMBAT_INTENT, ...intent });
}
const steps = (s: number) => Math.ceil(s / DT);

describe('directionFromAim', () => {
  it('uses the fallback for small movements', () => {
    expect(directionFromAim(3, -4, 'stab')).toBe('stab');
  });
  it('maps horizontal to slashes and vertical to overhead/stab', () => {
    expect(directionFromAim(60, 10, 'stab')).toBe('slashR');
    expect(directionFromAim(-60, 10, 'stab')).toBe('slashL');
    expect(directionFromAim(5, -60, 'stab')).toBe('overhead');
    expect(directionFromAim(5, 60, 'slashR')).toBe('stab');
  });
});

describe('swingHits', () => {
  const box = (x: number, z: number) => ({ minX: x - 0.4, minY: 4, minZ: z - 0.4, maxX: x + 0.4, maxY: 6, maxZ: z + 0.4 });
  const eye = { x: 0, y: 5.6, z: 0 };
  it('hits a target in front within reach', () => {
    expect(swingHits(eye, 0, 0, 'slashR', 2.7, box(0, -2))).toBe(true);
  });
  it('misses out of reach, and stabs reach further', () => {
    expect(swingHits(eye, 0, 0, 'slashR', 2.7, box(0, -3.6))).toBe(false);
    expect(swingHits(eye, 0, 0, 'stab', 2.7, box(0, -3.6))).toBe(true);
  });
  it('misses targets behind; slashes are wider than stabs', () => {
    expect(swingHits(eye, 0, 0, 'slashR', 2.7, box(0, 2))).toBe(false);
    expect(swingHits(eye, 0, 0, 'slashR', 2.7, box(1.6, -1.2))).toBe(true);
    expect(swingHits(eye, 0, 0, 'stab', 2.7, box(1.6, -1.2))).toBe(false);
  });
});

describe('inCone', () => {
  it('respects facing and reach', () => {
    expect(inCone({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 0, z: -2 }, 3, 60)).toBe(true);
    expect(inCone({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 0, z: 2 }, 3, 60)).toBe(false);
    expect(inCone({ x: 0, y: 0, z: 0 }, 0, { x: 0, y: 0, z: -4 }, 3, 60)).toBe(false);
  });
});

describe('resolveDefense', () => {
  it('orders dodge > unblockable > perfect > guard', () => {
    expect(resolveDefense({ iframes: 0.1, perfectParry: true, guarding: true }, true)).toBe('dodged');
    expect(resolveDefense({ iframes: 0, perfectParry: true, guarding: true }, true)).toBe('hit');
    expect(resolveDefense({ iframes: 0, perfectParry: true, guarding: true }, false)).toBe('perfect');
    expect(resolveDefense({ iframes: 0, perfectParry: false, guarding: true }, false)).toBe('guarded');
    expect(resolveDefense({ iframes: 0, perfectParry: false, guarding: false }, false)).toBe('hit');
  });
});

describe('Posture', () => {
  it('breaks when full and regenerates after a delay', () => {
    const p = new Posture(100);
    expect(p.damage(60)).toBe(false);
    expect(p.damage(50)).toBe(true);
    p.reset();
    p.damage(50);
    p.update(COMBAT.POSTURE_REGEN_DELAY * 0.5);
    expect(p.value).toBe(50);
    p.update(COMBAT.POSTURE_REGEN_DELAY);
    p.update(1);
    expect(p.value).toBeLessThan(50);
  });
});

describe('PlayerCombat attacks', () => {
  it('a tap becomes a light attack that goes active after its windup', () => {
    const c = new PlayerCombat();
    const light = WEAPONS[0].light[0];
    run(c, { attackPressed: true, attackHeld: true });
    run(c); // released
    expect(c.phase).toBe('windup');
    expect(c.swing!.heavy).toBe(false);
    run(c, {}, steps(light.windup));
    expect(c.phase).toBe('active');
  });

  it('holding becomes a heavy', () => {
    const c = new PlayerCombat();
    run(c, { attackPressed: true, attackHeld: true });
    run(c, { attackHeld: true }, steps(COMBAT.HEAVY_HOLD_TIME) + 1);
    expect(c.swing!.heavy).toBe(true);
    expect(c.swing!.def).toBe(WEAPONS[0].heavy);
  });

  it('mouse movement during windup sets the direction', () => {
    const c = new PlayerCombat();
    run(c, { attackPressed: true });
    c.addAim(0, -80);
    run(c, {}, steps(0.3));
    expect(c.swing!.dir).toBe('overhead');
  });

  it('feinting a heavy cancels it and costs posture', () => {
    const c = new PlayerCombat();
    run(c, { attackPressed: true, attackHeld: true });
    run(c, { attackHeld: true }, steps(COMBAT.HEAVY_HOLD_TIME) + 1);
    run(c, { attackHeld: true, feintPressed: true });
    expect(c.phase).toBe('recovery');
    expect(c.swing).toBeNull();
    expect(c.posture.value).toBeCloseTo(COMBAT.FEINT_POSTURE_COST);
  });

  it('light attacks chain into the combo', () => {
    const c = new PlayerCombat();
    const a = WEAPONS[0].light[0];
    run(c, { attackPressed: true });
    run(c, {}, steps(a.windup + a.active) + 1);
    expect(c.phase).toBe('recovery');
    run(c, { attackPressed: true });
    run(c, {}, steps(a.recovery));
    expect(c.swing!.comboIndex).toBe(1);
  });
});

describe('PlayerCombat parry', () => {
  it('opens a perfect window, then guards while held', () => {
    const c = new PlayerCombat();
    run(c, { blockPressed: true, blockHeld: true });
    expect(c.isPerfectParry()).toBe(true);
    run(c, { blockHeld: true }, steps(COMBAT.PERFECT_PARRY_WINDOW) + 1);
    expect(c.isPerfectParry()).toBe(false);
    expect(c.isGuarding()).toBe(true);
    run(c);
    expect(c.phase).toBe('idle');
  });

  it('gauntlets have a much smaller window', () => {
    const c = new PlayerCombat();
    c.setWeapon(4);
    expect(c.perfectWindow()).toBeLessThan(COMBAT.PERFECT_PARRY_WINDOW * 0.6);
  });

  it('mashing parry is punished with a guard-only lockout', () => {
    const c = new PlayerCombat();
    run(c, { blockPressed: true, blockHeld: true });
    run(c, {}, steps(COMBAT.PERFECT_PARRY_WINDOW) + 2);
    expect(c.phase).toBe('idle');
    run(c, { blockPressed: true, blockHeld: true });
    expect(c.isGuarding()).toBe(true);
    expect(c.isPerfectParry()).toBe(false);
  });

  it('a successful parry opens a riposte; the next attack is a riposte', () => {
    const c = new PlayerCombat();
    run(c, { blockPressed: true, blockHeld: true });
    c.onPerfectParry();
    run(c, {}, steps(COMBAT.PERFECT_PARRY_WINDOW) + 1);
    run(c, { attackPressed: true });
    expect(c.swing!.riposte).toBe(true);
  });

  it('block during a windup cancels the attack', () => {
    const c = new PlayerCombat();
    run(c, { attackPressed: true });
    run(c, { blockPressed: true, blockHeld: true });
    expect(c.phase).toBe('parry');
  });

  it('breaking posture staggers the player', () => {
    const c = new PlayerCombat();
    c.takePosture(COMBAT.PLAYER_MAX_POSTURE);
    expect(c.phase).toBe('staggered');
    run(c, {}, steps(COMBAT.PLAYER_STAGGER_TIME) + 1);
    expect(c.phase).toBe('idle');
  });
});

describe('Dummy', () => {
  it('attacks a nearby player with a telegraphed swing', () => {
    const w = flatWorld();
    const d = new Dummy(32.5, 4, 32.5, () => 0.99);
    d.setMode('attacker');
    const player = { pos: { x: 32.5, y: 4, z: 30.5 } as never, windupSwingId: 0 };
    let attacked = false;
    for (let i = 0; i < 240 && !attacked; i++) {
      d.update(DT, w, player);
      if (d.events.some((e) => e.type === 'attack')) attacked = true;
      if (d.phase === 'windup') expect(d.telegraph()).toBe('yellow');
      d.events.length = 0;
    }
    expect(attacked).toBe(true);
  });

  it('staggers when posture breaks and dies at zero health', () => {
    const d = new Dummy(0, 0, 0);
    expect(d.takeHit(1, DUMMY.MAX_POSTURE, 0, 0).broke).toBe(true);
    expect(d.staggered).toBe(true);
    expect(d.takeHit(DUMMY.MAX_HEALTH, 0, 0, 0).died).toBe(true);
    expect(d.alive).toBe(false);
  });

  it('parrier raises a parry shortly after the player starts a windup', () => {
    const w = flatWorld();
    const d = new Dummy(32.5, 4, 32.5, () => 0.1);
    d.setMode('parrier');
    const player = { pos: { x: 32.5, y: 4, z: 30.5 } as never, windupSwingId: 7 };
    let parried = false;
    for (let i = 0; i < steps(0.4); i++) {
      d.update(DT, w, player);
      if (d.isParrying()) parried = true;
    }
    expect(parried).toBe(true);
  });
});
