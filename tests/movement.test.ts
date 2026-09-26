import { describe, expect, it } from 'vitest';
import { MOVE, PLAYER } from '../src/config';
import { Block } from '../src/world/blocks';
import { DT, flatWorld, playerOnGround, step } from './helpers';

/** Step until grounded (or n steps), return max height reached above the start. */
function jumpApex(p: ReturnType<typeof playerOnGround>, w: ReturnType<typeof flatWorld>, n = 240): number {
  const y0 = 4; // floor top
  let max = 0;
  for (let i = 0; i < n; i++) {
    step(p, w);
    max = Math.max(max, p.pos.y - y0);
    if (p.grounded && i > 2) break;
  }
  return max;
}

describe('ground movement', () => {
  it('settles on the ground', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    expect(p.grounded).toBe(true);
    expect(p.state).toBe('ground');
    expect(p.pos.y).toBeCloseTo(4, 5);
  });

  it('reaches run speed and not more', () => {
    const w = flatWorld();
    const p = playerOnGround(w, 32.5, 60);
    step(p, w, { forward: 1 }, 30);
    expect(p.horizontalSpeed()).toBeCloseTo(MOVE.RUN_SPEED, 3);
    // yaw 0 looks toward -Z
    expect(p.vel.z).toBeLessThan(0);
  });
});

describe('jumping', () => {
  it('jumps about 1.9 blocks high', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    step(p, w, { jumpPressed: true });
    expect(p.vel.y).toBeGreaterThan(0);
    const apex = jumpApex(p, w);
    const expected = (MOVE.JUMP_VELOCITY * MOVE.JUMP_VELOCITY) / (2 * MOVE.GRAVITY);
    expect(apex).toBeGreaterThan(expected - 0.15);
    expect(apex).toBeLessThan(expected + 0.1);
  });

  it('allows a jump within coyote time after walking off a ledge', () => {
    const w = flatWorld();
    w.fill(0, 4, 0, 63, 9, 31, Block.STONE); // raised half, top at y = 10
    const p = playerOnGround(w, 32.5, 30.5);
    p.teleport(32.5, 10, 30.5);
    step(p, w, {}, 2);
    expect(p.grounded).toBe(true);
    // Walk toward +Z (backwards) off the edge at z = 32.
    let steps = 0;
    while (p.grounded && steps++ < 60) step(p, w, { forward: -1 });
    expect(p.grounded).toBe(false);
    step(p, w, { forward: -1 }, 3); // 50ms late
    step(p, w, { jumpPressed: true });
    expect(p.vel.y).toBeGreaterThan(MOVE.JUMP_VELOCITY - 1);
  });

  it('does not allow a jump well after coyote time', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    p.teleport(32.5, 20, 32.5);
    step(p, w, {}, 20);
    step(p, w, { jumpPressed: true });
    expect(p.vel.y).toBeLessThan(0);
  });

  it('buffers a jump pressed just before landing', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    p.teleport(32.5, 4.4, 32.5);
    p.vel.y = -8;
    step(p, w, { jumpPressed: true }); // still in the air
    let jumped = false;
    for (let i = 0; i < 6; i++) {
      step(p, w);
      if (p.vel.y > 5) jumped = true;
    }
    expect(jumped).toBe(true);
  });
});

describe('dash', () => {
  it('consumes a pip, moves fast, grants i-frames and regenerates', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    step(p, w, { dashPressed: true });
    expect(p.state).toBe('dash');
    expect(p.dashPips).toBeCloseTo(MOVE.DASH_PIPS - 1, 5);
    expect(p.iframes).toBeGreaterThan(0);
    expect(p.horizontalSpeed()).toBeCloseTo(MOVE.DASH_SPEED, 3);
    step(p, w, {}, Math.ceil(MOVE.DASH_TIME / DT) + 1);
    expect(p.state).toBe('ground');
    step(p, w, {}, Math.ceil(MOVE.DASH_REGEN_TIME / DT) + 1);
    expect(p.dashPips).toBe(MOVE.DASH_PIPS);
  });

  it('cannot dash with no pips', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    for (let i = 0; i < 3; i++) step(p, w, { dashPressed: true });
    expect(p.dashPips).toBeLessThan(1);
    const pips = p.dashPips;
    p.state = 'ground';
    step(p, w, { dashPressed: true });
    expect(p.dashPips).toBeGreaterThan(pips); // regen only, no spend
  });

  it('works midair and ignores gravity while dashing', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    p.teleport(32.5, 20, 32.5);
    step(p, w, { dashPressed: true, right: 1 });
    expect(p.vel.y).toBe(0);
    expect(p.vel.x).toBeCloseTo(MOVE.DASH_SPEED, 3);
    const y = p.pos.y;
    step(p, w, {}, 5);
    expect(p.pos.y).toBeCloseTo(y, 5);
  });
});

describe('slide', () => {
  it('starts at slide speed, shrinks the hitbox and keeps speed while held', () => {
    const w = flatWorld();
    const p = playerOnGround(w, 32.5, 60);
    step(p, w, { crouchPressed: true, crouchHeld: true });
    expect(p.state).toBe('slide');
    expect(p.crouched).toBe(true);
    expect(p.height()).toBe(PLAYER.CROUCH_HEIGHT);
    step(p, w, { crouchHeld: true }, 60);
    expect(p.horizontalSpeed()).toBeCloseTo(MOVE.SLIDE_SPEED, 3);
  });

  it('keeps dash momentum when dashing into a slide', () => {
    const w = flatWorld();
    const p = playerOnGround(w, 32.5, 60);
    step(p, w, { dashPressed: true });
    step(p, w, { crouchPressed: true, crouchHeld: true });
    expect(p.state).toBe('slide');
    expect(p.horizontalSpeed()).toBeGreaterThan(MOVE.SLIDE_SPEED + 5);
  });

  it('slide-jump carries more horizontal speed than a standing jump', () => {
    const w = flatWorld();
    const p = playerOnGround(w, 32.5, 60);
    step(p, w, { crouchPressed: true, crouchHeld: true }, 5);
    step(p, w, { jumpPressed: true });
    expect(p.state).toBe('air');
    expect(p.crouched).toBe(false);
    expect(p.horizontalSpeed()).toBeCloseTo(MOVE.SLIDE_SPEED * MOVE.SLIDE_JUMP_BOOST, 1);
  });

  it('stays crouched under a low ceiling after releasing crouch', () => {
    const w = flatWorld();
    w.fill(0, 5, 0, 63, 5, 40, Block.STONE); // 1-block gap over z < 41
    const p = playerOnGround(w, 32.5, 45.5);
    step(p, w, { crouchPressed: true, crouchHeld: true, forward: 1 });
    step(p, w, { crouchHeld: true, forward: 1 }, 30); // slide under
    expect(p.pos.z).toBeLessThan(40);
    step(p, w, {}, 1);
    expect(p.crouched).toBe(true);
    expect(p.state).toBe('slide');
  });
});

describe('ground slam', () => {
  it('drops fast and bounces higher than a normal jump', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    const normal = (() => {
      const q = playerOnGround(w);
      step(q, w, { jumpPressed: true });
      return jumpApex(q, w);
    })();

    p.teleport(32.5, 24, 32.5);
    step(p, w, { crouchPressed: true });
    expect(p.state).toBe('slam');
    expect(p.vel.y).toBe(-MOVE.SLAM_SPEED);
    let n = 0;
    while (!p.grounded && n++ < 120) step(p, w);
    expect(p.slamBounceTimer).toBeGreaterThan(0);
    step(p, w, { jumpPressed: true });
    const apex = jumpApex(p, w);
    expect(apex).toBeGreaterThan(normal * 2);
  });

  it('a late jump after slam landing is a normal jump', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    p.teleport(32.5, 24, 32.5);
    step(p, w, { crouchPressed: true });
    let n = 0;
    while (!p.grounded && n++ < 120) step(p, w);
    step(p, w, {}, Math.ceil(MOVE.SLAM_BOUNCE_WINDOW / DT) + 2);
    step(p, w, { jumpPressed: true });
    expect(p.vel.y).toBeCloseTo(MOVE.JUMP_VELOCITY - MOVE.GRAVITY * DT, 1);
  });
});

describe('wall jump', () => {
  it('pushes off the wall, is limited to 3, and resets on landing', () => {
    const w = flatWorld();
    w.fill(40, 4, 0, 40, 60, 63, Block.STONE); // wall at x = 40
    const p = playerOnGround(w, 39.6, 32.5);
    p.teleport(39.6, 20, 32.5);
    step(p, w, { right: 1 }); // yaw 0: right is +X, into the wall
    expect(p.touchingWall).toBe(true);
    expect(p.wallNX).toBeCloseTo(-1);

    for (let i = 0; i < MOVE.WALL_JUMPS_MAX; i++) {
      // Drift back to the wall.
      let n = 0;
      while (!p.touchingWall && n++ < 60) step(p, w, { right: 1 });
      step(p, w, { jumpPressed: true, right: 1 });
      expect(p.vel.y).toBeGreaterThan(MOVE.WALL_JUMP_UP - 1);
      expect(p.vel.x).toBeLessThan(0);
      expect(p.wallJumpsLeft).toBe(MOVE.WALL_JUMPS_MAX - 1 - i);
    }
    let n = 0;
    while (!p.touchingWall && n++ < 60) step(p, w, { right: 1 });
    step(p, w, { jumpPressed: true, right: 1 });
    expect(p.wallJumpsLeft).toBe(0);
    expect(p.vel.y).toBeLessThan(MOVE.WALL_JUMP_UP - 1);

    n = 0;
    while (!p.grounded && n++ < 600) step(p, w);
    expect(p.wallJumpsLeft).toBe(MOVE.WALL_JUMPS_MAX);
  });
});

describe('momentum', () => {
  it('air control preserves speed above run speed', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    p.teleport(32.5, 40, 32.5);
    p.vel.set(0, 0, -20);
    step(p, w, { forward: 1 }, 30);
    expect(p.horizontalSpeed()).toBeGreaterThan(18);
  });

  it('landing grace keeps speed for a quick bunny hop', () => {
    const w = flatWorld();
    const p = playerOnGround(w);
    p.teleport(32.5, 5, 32.5);
    p.vel.set(0, -5, -20);
    let n = 0;
    while (!p.grounded && n++ < 30) step(p, w, { forward: 1 });
    step(p, w, { jumpPressed: true, forward: 1 });
    expect(p.horizontalSpeed()).toBeGreaterThan(19);
  });
});

describe('step-up', () => {
  it('slides up a 1-block ledge without losing speed', () => {
    const w = flatWorld();
    w.fill(0, 4, 0, 63, 4, 40, Block.STONE); // 1-block ledge for z <= 40
    const p = playerOnGround(w, 32.5, 50.5);
    step(p, w, { crouchPressed: true, crouchHeld: true, forward: 1 });
    step(p, w, { crouchHeld: true, forward: 1 }, 50);
    expect(p.pos.z).toBeLessThan(40);
    expect(p.pos.y).toBeCloseTo(5, 5);
    expect(p.horizontalSpeed()).toBeCloseTo(MOVE.SLIDE_SPEED, 3);
    expect(p.state).toBe('slide');
  });

  it('does not climb 2-block walls', () => {
    const w = flatWorld();
    w.fill(0, 4, 0, 63, 5, 40, Block.STONE);
    const p = playerOnGround(w, 32.5, 50.5);
    step(p, w, { forward: 1 }, 90);
    expect(p.pos.y).toBeCloseTo(4, 5);
    expect(p.pos.z).toBeGreaterThan(41);
  });
});

describe('water', () => {
  it('sinks slowly and swims up while jump is held', () => {
    const w = flatWorld();
    w.fill(0, 4, 0, 63, 12, 63, Block.WATER);
    const p = playerOnGround(w);
    p.teleport(32.5, 10, 32.5);
    step(p, w, {}, 60);
    expect(p.inWater).toBe(true);
    expect(p.vel.y).toBeGreaterThanOrEqual(-MOVE.WATER_MAX_SINK - 0.01);
    const y = p.pos.y;
    step(p, w, { jumpHeld: true }, 30);
    expect(p.pos.y).toBeGreaterThan(y);
  });
});
