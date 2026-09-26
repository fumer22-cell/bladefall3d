import { describe, expect, it } from 'vitest';
import { COMBAT, DUMMY } from '../src/config';
import { CombatSystem } from '../src/combat/combatSystem';
import { NO_COMBAT_INTENT, type CombatIntent } from '../src/combat/playerCombat';
import { Dummy } from '../src/combat/trainingDummy';
import { stepMovement, NO_INTENT } from '../src/player/movement';
import { DT, flatWorld, playerOnGround } from './helpers';

function setup(mode: Dummy['mode']) {
  const world = flatWorld();
  const player = playerOnGround(world, 32.5, 34.5); // facing -Z toward the dummy
  const cs = new CombatSystem(player, world, () => {});
  const dummy = new Dummy(32.5, 4, 32.5, () => 0.99);
  dummy.setMode(mode);
  cs.dummies.push(dummy);
  const events: string[] = [];
  for (const k of ['hit', 'parry', 'guard', 'playerHit', 'postureBreak', 'deathblow', 'kill', 'playerParried'] as const) {
    cs.events.on(k, () => events.push(k));
  }
  const tick = (intent: Partial<CombatIntent> = {}, interact = false) => {
    stepMovement(player, NO_INTENT, world, DT);
    cs.step(DT, { ...NO_COMBAT_INTENT, ...intent }, interact);
  };
  return { world, player, cs, dummy, events, tick };
}

describe('CombatSystem', () => {
  it('a well-timed parry deflects the dummy swing, refunds a dash pip and damages its posture', () => {
    const { cs, dummy, events, tick, player } = setup('attacker');
    player.dashPips = 1;
    let i = 0;
    while (!(dummy.phase === 'windup' && dummy.phaseLen - dummy.t < 0.06) && i++ < 400) tick();
    tick({ blockPressed: true, blockHeld: true });
    for (let k = 0; k < 10; k++) tick({ blockHeld: true });
    expect(events).toContain('parry');
    expect(events).not.toContain('playerHit');
    expect(cs.combat.health).toBe(COMBAT.PLAYER_MAX_HEALTH);
    expect(player.dashPips).toBeGreaterThanOrEqual(2);
    expect(dummy.posture.value).toBeGreaterThan(0);
  });

  it('getting hit hurts and holding guard reduces damage', () => {
    const a = setup('attacker');
    for (let i = 0; i < 300 && !a.events.includes('playerHit'); i++) a.tick();
    expect(a.cs.combat.health).toBeLessThan(COMBAT.PLAYER_MAX_HEALTH);
    const hitDamage = COMBAT.PLAYER_MAX_HEALTH - a.cs.combat.health;

    const b = setup('attacker');
    b.tick({ blockPressed: true, blockHeld: true });
    for (let i = 0; i < 300 && !b.events.includes('guard'); i++) b.tick({ blockHeld: true });
    expect(b.events).toContain('guard');
    expect(COMBAT.PLAYER_MAX_HEALTH - b.cs.combat.health).toBeLessThan(hitDamage);
  });

  it('attacks damage the dummy; breaking posture enables a deathblow that kills it', () => {
    const { cs, dummy, events, tick, player } = setup('idle');
    cs.combat.setWeapon(1); // greatsword: big posture damage
    for (let n = 0; n < 40 && !dummy.staggered && dummy.alive; n++) {
      tick({ attackPressed: true, attackHeld: true });
      for (let i = 0; i < 80 && cs.combat.phase !== 'idle'; i++) tick({ attackHeld: true });
      for (let i = 0; i < 3; i++) tick();
    }
    expect(events).toContain('hit');
    expect(dummy.health).toBeLessThan(DUMMY.MAX_HEALTH);
    expect(dummy.staggered).toBe(true);
    player.teleport(dummy.pos.x, 4, dummy.pos.z + 2); // walk up to it
    tick();
    expect(cs.deathblowTarget()).toBe(dummy);

    tick({}, true);
    expect(cs.deathblow).not.toBeNull();
    for (let i = 0; i < Math.ceil(COMBAT.DEATHBLOW_TIME / DT) + 2; i++) tick();
    expect(events).toContain('deathblow');
    expect(dummy.alive).toBe(false);
    expect(cs.deathblow).toBeNull();
    expect(cs.combat.phase).toBe('idle');
  });

  it('the parrier deflects light attacks but not heavies', () => {
    const light = setup('parrier');
    light.tick({ attackPressed: true });
    for (let i = 0; i < 60; i++) light.tick();
    expect(light.events).toContain('playerParried');
    expect(light.events).not.toContain('hit');

    const heavy = setup('parrier');
    heavy.tick({ attackPressed: true, attackHeld: true });
    for (let i = 0; i < 90; i++) heavy.tick({ attackHeld: true });
    expect(heavy.events).toContain('hit');
  });

  it('perfect-parried projectiles fly back and hurt the dummy', () => {
    const { cs, dummy, events, tick, player } = setup('shooter');
    player.pos.z = 40.5; // back off a bit
    player.prevPos.copy(player.pos);
    let parried = false;
    for (let i = 0; i < 400 && !parried; i++) {
      const p = cs.projectiles.list.find((q) => q.faction === 'enemy');
      const near = p && p.pos.distanceTo(cs.eye()) < 1.9;
      tick(near ? { blockPressed: true, blockHeld: true } : {});
      parried = events.includes('parry');
    }
    expect(parried).toBe(true);
    for (let i = 0; i < 120 && !events.includes('hit'); i++) tick();
    expect(events).toContain('hit');
    expect(dummy.health).toBeLessThan(DUMMY.MAX_HEALTH);
  });
});
