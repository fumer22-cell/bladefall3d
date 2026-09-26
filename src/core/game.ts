import { CAMERA, SIM, TEST_ARENA } from '../config';
import { stepMovement, type MoveIntent } from '../player/movement';
import { Player } from '../player/player';
import { CameraRig } from '../render/cameraRig';
import { Renderer } from '../render/renderer';
import { Hud } from '../ui/hud';
import { buildTestArena } from '../world/testArena';
import { World } from '../world/world';
import { Input } from './input';
import { FixedLoop } from './loop';
import { clamp, DEG } from './math';

export class Game {
  readonly world = new World();
  readonly player = new Player();
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly cameraRig = new CameraRig();
  readonly loop: FixedLoop;
  private slowmo = false;

  constructor(root: HTMLElement) {
    this.renderer = new Renderer(root);
    this.input = new Input(this.renderer.canvas);
    this.hud = new Hud(root);
    this.hud.overlay.addEventListener('click', () => this.input.requestLock());
    document.addEventListener('pointerlockchange', () => this.hud.setOverlay(!this.input.locked));

    buildTestArena(this.world);
    this.respawn();

    this.loop = new FixedLoop(
      (dt) => this.step(dt),
      (alpha, frameDt) => this.frame(alpha, frameDt),
    );
  }

  start(): void {
    this.loop.start();
  }

  private respawn(): void {
    const s = TEST_ARENA.SPAWN;
    this.player.teleport(s.x, s.y, s.z);
    this.player.yaw = 0;
    this.player.pitch = 0;
  }

  private intent(): MoveIntent {
    const i = this.input;
    const active = i.locked;
    return {
      forward: active ? (i.isHeld('forward') ? 1 : 0) - (i.isHeld('back') ? 1 : 0) : 0,
      right: active ? (i.isHeld('right') ? 1 : 0) - (i.isHeld('left') ? 1 : 0) : 0,
      jumpPressed: active && i.wasPressed('jump'),
      dashPressed: active && i.wasPressed('dash'),
      crouchPressed: active && i.wasPressed('crouch'),
      crouchHeld: active && i.isHeld('crouch'),
    };
  }

  private step(dt: number): void {
    stepMovement(this.player, this.intent(), this.world, dt);
    if (this.player.pos.y < -30) this.respawn();
    this.input.endStep();
  }

  private frame(alpha: number, frameDt: number): void {
    const { input, player } = this;

    // Per-frame UI actions.
    if (input.consumePress('debug')) this.hud.toggleDebug();
    if (input.consumePress('reset')) this.respawn();
    if (input.consumePress('slowmo')) {
      this.slowmo = !this.slowmo;
      this.loop.timeScale = this.slowmo ? SIM.DEBUG_SLOWMO_SCALE : 1;
      this.hud.setSlowmo(this.slowmo);
    }

    // Mouse look is applied per frame for minimum latency.
    const { dx, dy } = input.takeMouseDelta();
    player.yaw -= dx * CAMERA.MOUSE_SENSITIVITY;
    player.pitch = clamp(player.pitch - dy * CAMERA.MOUSE_SENSITIVITY, -CAMERA.PITCH_LIMIT * DEG, CAMERA.PITCH_LIMIT * DEG);

    for (const e of player.events) this.cameraRig.handleEvent(e, player);
    player.events.length = 0;

    const strafe = input.locked ? (input.isHeld('right') ? 1 : 0) - (input.isHeld('left') ? 1 : 0) : 0;
    this.cameraRig.update(this.renderer.camera, player, alpha, frameDt, strafe);
    this.hud.update(player, frameDt);
    this.renderer.syncChunks(this.world);
    this.renderer.render();
  }
}
