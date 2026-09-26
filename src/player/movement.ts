import { MOVE, PLAYER } from '../config';
import { clamp, moveToward2 } from '../core/math';
import { FRICTION } from '../world/blocks';
import { boxOverlapsSolid, moveBox, sweepAxis, type AABB, type MoveResult } from '../world/collision';
import type { VoxelQuery } from '../world/world';
import type { Player } from './player';

/** Movement input for one sim step. forward/right are in [-1, 1]. */
export interface MoveIntent {
  forward: number;
  right: number;
  jumpPressed: boolean;
  dashPressed: boolean;
  crouchPressed: boolean;
  crouchHeld: boolean;
}

export const NO_INTENT: MoveIntent = {
  forward: 0,
  right: 0,
  jumpPressed: false,
  dashPressed: false,
  crouchPressed: false,
  crouchHeld: false,
};

interface Wish {
  x: number;
  z: number;
  has: boolean;
  /** Look direction flattened to the ground plane. */
  fx: number;
  fz: number;
}

/**
 * Advance player movement by one fixed step.
 * Velocity is shared between all states and is only ever modified, never reset,
 * so moves chain into each other (dash → slide → jump → slam → bounce).
 */
export function stepMovement(p: Player, input: MoveIntent, world: VoxelQuery, dt: number): void {
  p.prevPos.copy(p.pos);
  const wish = computeWish(p, input);

  // --- Timers ---
  p.jumpBuffer = input.jumpPressed ? MOVE.JUMP_BUFFER : Math.max(0, p.jumpBuffer - dt);
  p.iframes = Math.max(0, p.iframes - dt);
  p.slamBounceTimer = Math.max(0, p.slamBounceTimer - dt);
  if (p.state !== 'dash') {
    p.dashPips = Math.min(MOVE.DASH_PIPS, p.dashPips + (dt * p.regenMult) / MOVE.DASH_REGEN_TIME);
  }
  if (p.grounded) p.groundTime += dt;
  else p.airTime += dt;

  // --- Input-driven transitions ---
  if (input.dashPressed && p.dashPips >= 1) startDash(p, wish, world);
  if (input.crouchPressed && !p.grounded && p.state !== 'slam') startSlam(p);
  if (p.grounded && input.crouchHeld && p.state === 'ground') startSlide(p, wish);
  if (p.grounded && input.crouchPressed && p.state === 'dash') startSlide(p, wish);
  if (p.jumpBuffer > 0) tryJump(p, world);

  // --- Per-state velocity ---
  switch (p.state) {
    case 'dash':
      updateDash(p, wish, input, dt);
      break;
    case 'ground':
      updateGround(p, wish, world, dt);
      break;
    case 'air':
      updateAir(p, wish, dt);
      break;
    case 'slide':
      updateSlide(p, wish, input, world, dt);
      break;
    case 'slam':
      p.vel.y = -MOVE.SLAM_SPEED;
      break;
  }

  // --- Integrate + collide ---
  const start = p.box();
  let box = { ...start };
  const preVy = p.vel.y;
  const dx = p.vel.x * dt, dy = p.vel.y * dt, dz = p.vel.z * dt;
  let hit = moveBox(world, box, dx, dy, dz);
  if ((hit.hitX || hit.hitZ) && p.grounded && p.vel.y <= 0 && p.state !== 'slam') {
    const stepped = tryStepUp(world, start, box, dx, dz);
    if (stepped) {
      box = stepped.box;
      hit = stepped.hit;
      p.events.push({ type: 'step', height: box.minY - start.minY });
    }
  }
  p.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
  if (hit.hitX) p.vel.x = 0;
  if (hit.hitZ) p.vel.z = 0;
  if (hit.hitY) p.vel.y = 0;

  // --- Contacts ---
  const wasGrounded = p.grounded;
  p.grounded = p.vel.y <= 0 && probeGround(world, p.box());
  if (p.grounded && !wasGrounded) onLand(p, preVy, wish, input);
  else if (!p.grounded && wasGrounded) {
    p.airTime = 0;
    if (p.state === 'ground' || p.state === 'slide') p.state = 'air';
  }
  probeWalls(p, world);

  if (p.crouched && p.state !== 'slide') tryStand(p, world);
}

function computeWish(p: Player, input: MoveIntent): Wish {
  const s = Math.sin(p.yaw);
  const c = Math.cos(p.yaw);
  // Camera looks down -Z at yaw 0; right is +X.
  const fx = -s, fz = -c;
  const rx = c, rz = -s;
  let x = fx * input.forward + rx * input.right;
  let z = fz * input.forward + rz * input.right;
  const len = Math.hypot(x, z);
  if (len > 0) {
    x /= len;
    z /= len;
  }
  return { x, z, has: len > 0, fx, fz };
}

function startDash(p: Player, wish: Wish, world: VoxelQuery): void {
  p.dashPips -= 1;
  p.dashDirX = wish.has ? wish.x : wish.fx;
  p.dashDirZ = wish.has ? wish.z : wish.fz;
  p.state = 'dash';
  p.dashTimer = MOVE.DASH_TIME;
  p.iframes = Math.max(p.iframes, MOVE.DASH_IFRAMES);
  p.vel.set(p.dashDirX * MOVE.DASH_SPEED, 0, p.dashDirZ * MOVE.DASH_SPEED);
  if (p.crouched) tryStand(p, world);
  p.events.push({ type: 'dash' });
}

function startSlam(p: Player): void {
  p.state = 'slam';
  p.vel.x *= MOVE.SLAM_HORIZONTAL_KEEP;
  p.vel.z *= MOVE.SLAM_HORIZONTAL_KEEP;
  p.vel.y = -MOVE.SLAM_SPEED;
  p.slamStartY = p.pos.y;
  p.events.push({ type: 'slam' });
}

function startSlide(p: Player, wish: Wish): void {
  const hs = p.horizontalSpeed();
  if (hs > 0.5) {
    p.slideDirX = p.vel.x / hs;
    p.slideDirZ = p.vel.z / hs;
  } else {
    p.slideDirX = wish.has ? wish.x : wish.fx;
    p.slideDirZ = wish.has ? wish.z : wish.fz;
  }
  p.slideSpeed = Math.max(hs, MOVE.SLIDE_SPEED);
  p.vel.x = p.slideDirX * p.slideSpeed;
  p.vel.z = p.slideDirZ * p.slideSpeed;
  p.state = 'slide';
  p.crouched = true;
  p.events.push({ type: 'slideStart' });
}

function tryJump(p: Player, world: VoxelQuery): void {
  const coyote = !p.jumpedSinceGround && p.airTime < MOVE.COYOTE_TIME && p.state !== 'slam';
  if (p.grounded || coyote) {
    let vy: number = MOVE.JUMP_VELOCITY;
    if (p.state === 'slide') {
      vy = MOVE.SLIDE_JUMP_VELOCITY;
      p.vel.x *= MOVE.SLIDE_JUMP_BOOST;
      p.vel.z *= MOVE.SLIDE_JUMP_BOOST;
      p.events.push({ type: 'slideJump' });
    } else if (p.state === 'dash') {
      const s = MOVE.DASH_SPEED * MOVE.DASH_JUMP_SPEED_MULT;
      p.vel.x = p.dashDirX * s;
      p.vel.z = p.dashDirZ * s;
      p.events.push({ type: 'dashJump' });
    }
    if (p.slamBounceTimer > 0) {
      vy = Math.max(vy, MOVE.JUMP_VELOCITY) + p.slamBounceBonus;
      p.slamBounceTimer = 0;
      p.events.push({ type: 'slamBounce', bonus: p.slamBounceBonus });
    }
    p.vel.y = vy;
    p.state = 'air';
    p.grounded = false;
    p.jumpedSinceGround = true;
    p.airTime = 0;
    p.jumpBuffer = 0;
    if (p.crouched) tryStand(p, world);
    p.events.push({ type: 'jump' });
    return;
  }

  if (p.touchingWall && p.wallJumpsLeft > 0 && p.state !== 'slam') {
    const nx = p.wallNX, nz = p.wallNZ;
    const vn = p.vel.x * nx + p.vel.z * nz;
    const tx = p.vel.x - nx * vn;
    const tz = p.vel.z - nz * vn;
    p.vel.x = tx * MOVE.WALL_JUMP_TANGENT_KEEP + nx * MOVE.WALL_JUMP_PUSH;
    p.vel.z = tz * MOVE.WALL_JUMP_TANGENT_KEEP + nz * MOVE.WALL_JUMP_PUSH;
    p.vel.y = MOVE.WALL_JUMP_UP;
    p.wallJumpsLeft--;
    p.state = 'air';
    p.jumpBuffer = 0;
    p.events.push({ type: 'wallJump', nx, nz });
  }
}

function updateDash(p: Player, wish: Wish, input: MoveIntent, dt: number): void {
  p.dashTimer -= dt;
  p.vel.set(p.dashDirX * MOVE.DASH_SPEED, 0, p.dashDirZ * MOVE.DASH_SPEED);
  if (p.dashTimer > 0) return;
  if (p.grounded && input.crouchHeld) {
    startSlide(p, wish); // keeps full dash speed as slide speed
  } else {
    p.vel.x = p.dashDirX * MOVE.DASH_EXIT_SPEED;
    p.vel.z = p.dashDirZ * MOVE.DASH_EXIT_SPEED;
    p.state = p.grounded ? 'ground' : 'air';
    p.groundTime = 0; // grace so a jump right after the dash keeps its speed
  }
}

function groundFriction(p: Player, world: VoxelQuery): number {
  const id = world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.05), Math.floor(p.pos.z));
  return id === 0 ? 1 : FRICTION[id];
}

function updateGround(p: Player, wish: Wish, world: VoxelQuery, dt: number): void {
  const hs = p.horizontalSpeed();
  let rate: number;
  if (hs > MOVE.RUN_SPEED + 0.01) {
    rate = p.groundTime < MOVE.LANDING_FRICTION_GRACE ? 0 : MOVE.GROUND_OVERSPEED_DECEL;
  } else {
    rate = wish.has ? MOVE.GROUND_ACCEL : MOVE.GROUND_DECEL;
  }
  rate *= groundFriction(p, world);
  const h = { x: p.vel.x, z: p.vel.z };
  moveToward2(h, wish.x * MOVE.RUN_SPEED, wish.z * MOVE.RUN_SPEED, rate * dt);
  p.vel.x = h.x;
  p.vel.z = h.z;
  p.vel.y -= MOVE.GRAVITY * dt;
}

function updateAir(p: Player, wish: Wish, dt: number): void {
  if (wish.has) {
    // Quake-style: accelerate toward wish dir only up to RUN_SPEED along it, so momentum above
    // run speed is preserved while steering stays strong.
    const along = p.vel.x * wish.x + p.vel.z * wish.z;
    const add = MOVE.RUN_SPEED - along;
    if (add > 0) {
      const a = Math.min(add, MOVE.AIR_ACCEL * dt);
      p.vel.x += wish.x * a;
      p.vel.z += wish.z * a;
    }
  }
  const hs = p.horizontalSpeed();
  if (hs > MOVE.RUN_SPEED) {
    const k = Math.max(MOVE.RUN_SPEED, hs - MOVE.AIR_OVERSPEED_DRAG * dt) / hs;
    p.vel.x *= k;
    p.vel.z *= k;
  }
  p.vel.y = Math.max(p.vel.y - MOVE.GRAVITY * dt, -MOVE.MAX_FALL_SPEED);

  // Wall slide: pushing into a wall slows the fall.
  if (p.touchingWall && wish.has && p.vel.y < -MOVE.WALL_SLIDE_MAX_FALL) {
    if (-(wish.x * p.wallNX + wish.z * p.wallNZ) > 0.3) p.vel.y = -MOVE.WALL_SLIDE_MAX_FALL;
  }
}

function updateSlide(p: Player, wish: Wish, input: MoveIntent, world: VoxelQuery, dt: number): void {
  if (wish.has) {
    // Rotate the slide direction toward the wish direction, limited by steer rate.
    const cur = Math.atan2(p.slideDirX, p.slideDirZ);
    const want = Math.atan2(wish.x, wish.z);
    let diff = want - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) < Math.PI * 0.75) {
      const a = cur + clamp(diff, -MOVE.SLIDE_STEER_RATE * dt, MOVE.SLIDE_STEER_RATE * dt);
      p.slideDirX = Math.sin(a);
      p.slideDirZ = Math.cos(a);
    }
  }
  p.slideSpeed = Math.max(MOVE.SLIDE_SPEED, p.slideSpeed - MOVE.SLIDE_OVERSPEED_DECEL * dt);
  p.vel.x = p.slideDirX * p.slideSpeed;
  p.vel.z = p.slideDirZ * p.slideSpeed;
  p.vel.y -= MOVE.GRAVITY * dt;

  if (!input.crouchHeld && canStand(p, world)) {
    p.crouched = false;
    p.state = 'ground';
    p.groundTime = 0;
  }
}

function onLand(p: Player, preVy: number, wish: Wish, input: MoveIntent): void {
  p.wallJumpsLeft = MOVE.WALL_JUMPS_MAX;
  p.groundTime = 0;
  p.jumpedSinceGround = false;
  p.events.push({ type: 'land', speed: -preVy });
  if (p.state === 'slam') {
    const height = Math.max(0, p.slamStartY - p.pos.y);
    p.slamBounceTimer = MOVE.SLAM_BOUNCE_WINDOW;
    p.slamBounceBonus = clamp(
      height * MOVE.SLAM_BOUNCE_PER_BLOCK,
      MOVE.SLAM_BOUNCE_MIN_BONUS,
      MOVE.SLAM_BOUNCE_MAX_BONUS,
    );
    p.events.push({ type: 'slamLand', height });
    p.state = 'ground';
  } else if (p.state === 'air') {
    p.state = 'ground';
  }
  if (p.state === 'ground' && input.crouchHeld) startSlide(p, wish);
}

/**
 * Retry a blocked grounded move from STEP_HEIGHT higher, then settle back down.
 * Returns the stepped result only if it got further horizontally and ended up higher.
 */
function tryStepUp(
  world: VoxelQuery,
  start: AABB,
  blocked: AABB,
  dx: number,
  dz: number,
): { box: AABB; hit: MoveResult } | null {
  if (MOVE.STEP_HEIGHT <= 0) return null;
  const alt = { ...start };
  const up = sweepAxis(world, alt, 1, MOVE.STEP_HEIGHT);
  if (up <= 0) return null;
  const hit = moveBox(world, alt, dx, 0, dz);
  sweepAxis(world, alt, 1, -up);
  if (alt.minY <= start.minY + 1e-4) return null;
  const distAlt = Math.hypot(alt.minX - start.minX, alt.minZ - start.minZ);
  const distBlocked = Math.hypot(blocked.minX - start.minX, blocked.minZ - start.minZ);
  if (distAlt <= distBlocked + 1e-4) return null;
  hit.hitY = true;
  return { box: alt, hit };
}

function probeGround(world: VoxelQuery, b: AABB): boolean {
  return boxOverlapsSolid(world, { ...b, minY: b.minY - 0.05, maxY: b.minY });
}

function probeWalls(p: Player, world: VoxelQuery): void {
  p.touchingWall = false;
  if (p.grounded) return;
  const b = p.box();
  const d = MOVE.WALL_CHECK_DIST;
  const y0 = b.minY + 0.1, y1 = b.maxY - 0.1;
  let nx = 0, nz = 0;
  if (boxOverlapsSolid(world, { ...b, minY: y0, maxY: y1, minX: b.maxX, maxX: b.maxX + d })) nx -= 1;
  if (boxOverlapsSolid(world, { ...b, minY: y0, maxY: y1, minX: b.minX - d, maxX: b.minX })) nx += 1;
  if (boxOverlapsSolid(world, { ...b, minY: y0, maxY: y1, minZ: b.maxZ, maxZ: b.maxZ + d })) nz -= 1;
  if (boxOverlapsSolid(world, { ...b, minY: y0, maxY: y1, minZ: b.minZ - d, maxZ: b.minZ })) nz += 1;
  const len = Math.hypot(nx, nz);
  if (len === 0) return;
  p.touchingWall = true;
  p.wallNX = nx / len;
  p.wallNZ = nz / len;
}

function canStand(p: Player, world: VoxelQuery): boolean {
  return !p.crouched || !boxOverlapsSolid(world, p.box(PLAYER.HEIGHT));
}

function tryStand(p: Player, world: VoxelQuery): void {
  if (canStand(p, world)) p.crouched = false;
}
