import { Vector3 } from 'three';
import { MOVE, PLAYER } from '../config';
import type { AABB } from '../world/collision';

export type MoveState = 'ground' | 'air' | 'slide' | 'dash' | 'slam';

/** Things that happened during a sim step; consumed by camera/HUD/audio each frame. */
export type MoveEvent =
  | { type: 'jump' }
  | { type: 'slideJump' }
  | { type: 'dashJump' }
  | { type: 'dash' }
  | { type: 'slideStart' }
  | { type: 'slam' }
  | { type: 'land'; speed: number }
  | { type: 'step'; height: number }
  | { type: 'slamLand'; height: number }
  | { type: 'slamBounce'; bonus: number }
  | { type: 'wallJump'; nx: number; nz: number };

export class Player {
  /** Feet center. */
  readonly pos = new Vector3();
  /** Position at the start of the last sim step (for render interpolation). */
  readonly prevPos = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  pitch = 0;

  state: MoveState = 'air';
  grounded = false;
  crouched = false;
  /** Body is in water (swimming physics). */
  inWater = false;

  touchingWall = false;
  wallNX = 0;
  wallNZ = 0;
  wallJumpsLeft: number = MOVE.WALL_JUMPS_MAX;

  dashPips: number = MOVE.DASH_PIPS;
  dashTimer = 0;
  dashDirX = 0;
  dashDirZ = 0;
  /** Invulnerability time left (dash i-frames). */
  iframes = 0;

  slideDirX = 0;
  slideDirZ = 0;
  slideSpeed = 0;

  slamStartY = 0;
  slamBounceTimer = 0;
  slamBounceBonus = 0;

  /** Time left on a buffered jump press. */
  jumpBuffer = 0;
  /** Time since leaving the ground. */
  airTime = Infinity;
  /** Time since landing. */
  groundTime = 0;
  jumpedSinceGround = false;
  /** A jump that can still be shortened by releasing the button. */
  jumpCuttable = false;
  /** Jump button state last step (to detect release). */
  jumpWasHeld = false;

  /** Multiplier on run speed / air control (guarding, heavy windups, stagger). */
  speedMult = 1;

  /** Multiplier on dash-pip regen (hunger will lower this in Phase 6). */
  regenMult = 1;

  events: MoveEvent[] = [];

  height(): number {
    return this.crouched ? PLAYER.CROUCH_HEIGHT : PLAYER.HEIGHT;
  }

  box(height = this.height()): AABB {
    const h = PLAYER.WIDTH / 2;
    return {
      minX: this.pos.x - h,
      minY: this.pos.y,
      minZ: this.pos.z - h,
      maxX: this.pos.x + h,
      maxY: this.pos.y + height,
      maxZ: this.pos.z + h,
    };
  }

  horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.state = 'air';
    this.grounded = false;
    this.crouched = false;
    this.airTime = Infinity;
    this.dashPips = MOVE.DASH_PIPS;
    this.wallJumpsLeft = MOVE.WALL_JUMPS_MAX;
  }
}
