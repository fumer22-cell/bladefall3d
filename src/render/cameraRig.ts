import type { PerspectiveCamera } from 'three';
import { CAMERA, MOVE, PLAYER } from '../config';
import { clamp, damp, DEG, lerp } from '../core/math';
import type { MoveEvent, Player } from '../player/player';

/**
 * Turns player state + movement events into camera feel:
 * FOV kicks, roll tilt, head bob, landing dip, trauma-based shake.
 */
export class CameraRig {
  private fov: number = CAMERA.BASE_FOV;
  private roll = 0;
  private tiltKick = 0;
  private dip = 0;
  private stepOffset = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private trauma = 0;
  private time = 0;
  private eyeHeight: number = PLAYER.EYE_HEIGHT;

  handleEvent(e: MoveEvent, player: Player): void {
    switch (e.type) {
      case 'land':
        if (e.speed > 4) this.dip -= Math.min(e.speed * CAMERA.LAND_DIP_PER_SPEED, CAMERA.LAND_DIP_MAX);
        break;
      case 'step':
        this.stepOffset -= e.height;
        break;
      case 'slamLand':
        this.addTrauma(Math.max(CAMERA.SLAM_LAND_TRAUMA_MIN, e.height * CAMERA.SLAM_LAND_TRAUMA_PER_BLOCK));
        break;
      case 'slamBounce':
        this.addTrauma(0.15);
        break;
      case 'wallJump': {
        // Tilt away from the wall: positive roll when the wall is on the camera's right.
        const rightX = Math.cos(player.yaw), rightZ = -Math.sin(player.yaw);
        const side = -(e.nx * rightX + e.nz * rightZ);
        this.tiltKick = side * CAMERA.WALL_JUMP_TILT;
        break;
      }
    }
  }

  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  update(camera: PerspectiveCamera, p: Player, alpha: number, dt: number, strafe: number, zoom = 0): void {
    this.time += dt;

    // Position (interpolated between sim steps).
    const x = lerp(p.prevPos.x, p.pos.x, alpha);
    const y = lerp(p.prevPos.y, p.pos.y, alpha);
    const z = lerp(p.prevPos.z, p.pos.z, alpha);
    this.eyeHeight = damp(this.eyeHeight, p.crouched ? PLAYER.CROUCH_EYE_HEIGHT : PLAYER.EYE_HEIGHT, PLAYER.EYE_BLEND_RATE, dt);

    // FOV.
    const hs = p.horizontalSpeed();
    let fovTarget = CAMERA.BASE_FOV + clamp((hs - MOVE.RUN_SPEED) / CAMERA.SPEED_FOV_RANGE, 0, 1) * CAMERA.SPEED_FOV_MAX;
    if (p.state === 'dash') fovTarget += CAMERA.DASH_FOV_KICK;
    else if (p.state === 'slide') fovTarget += CAMERA.SLIDE_FOV_KICK;
    else if (p.state === 'slam') fovTarget += CAMERA.SLAM_FOV_KICK;
    fovTarget -= zoom;
    this.fov = damp(this.fov, fovTarget, CAMERA.FOV_BLEND_RATE, dt);

    // Roll.
    let rollTarget = -strafe * CAMERA.STRAFE_TILT;
    if (p.state === 'slide') rollTarget += CAMERA.SLIDE_TILT;
    this.roll = damp(this.roll, rollTarget, CAMERA.ROLL_BLEND_RATE, dt);
    this.tiltKick = damp(this.tiltKick, 0, CAMERA.TILT_KICK_DECAY, dt);

    // Head bob.
    const bobbing = p.grounded && p.state === 'ground' && hs > 1;
    this.bobAmp = damp(this.bobAmp, bobbing ? Math.min(hs / MOVE.RUN_SPEED, 1) : 0, 10, dt);
    if (bobbing) this.bobPhase += hs * CAMERA.BOB_FREQ * dt;
    const bobY = Math.sin(this.bobPhase * 2) * CAMERA.BOB_AMOUNT * this.bobAmp;
    const bobRoll = Math.sin(this.bobPhase) * 0.4 * this.bobAmp;

    // Landing dip springs back.
    this.dip = damp(this.dip, 0, CAMERA.LAND_DIP_RECOVER, dt);
    this.stepOffset = damp(this.stepOffset, 0, CAMERA.STEP_SMOOTH_RATE, dt);

    // Shake.
    this.trauma = Math.max(0, this.trauma - CAMERA.SHAKE_DECAY * dt);
    const s = this.trauma * this.trauma;
    const t = this.time * CAMERA.SHAKE_FREQ;
    const shakeX = s * CAMERA.SHAKE_MAX_OFFSET * Math.sin(t * 1.1 + 1.3);
    const shakeY = s * CAMERA.SHAKE_MAX_OFFSET * Math.sin(t * 1.7 + 4.1);
    const shakeRoll = s * CAMERA.SHAKE_MAX_ROLL * Math.sin(t * 0.9 + 2.2);

    camera.position.set(x + shakeX, y + this.eyeHeight + this.dip + this.stepOffset + bobY + shakeY, z);
    camera.rotation.set(p.pitch, p.yaw, (this.roll + this.tiltKick + bobRoll + shakeRoll) * DEG);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}
