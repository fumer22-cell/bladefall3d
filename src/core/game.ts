import { Vector3 } from 'three';
import { play, unlockAudio } from '../audio/sfx';
import { CombatSystem } from '../combat/combatSystem';
import { type CombatIntent } from '../combat/playerCombat';
import { Dummy, DUMMY_MODES } from '../combat/trainingDummy';
import { CAMERA, COMBAT, PARTICLES, SIM, TEST_ARENA, WEAPONS, type Action } from '../config';
import { NO_INTENT, stepMovement, type MoveIntent } from '../player/movement';
import { Player } from '../player/player';
import { CameraRig } from '../render/cameraRig';
import { DummyView } from '../render/dummyView';
import { Particles } from '../render/particles';
import { ProjectileView } from '../render/projectileView';
import { Renderer } from '../render/renderer';
import { Viewmodel } from '../render/viewmodel';
import { Hud } from '../ui/hud';
import { buildTestArena } from '../world/testArena';
import { World } from '../world/world';
import { Input } from './input';
import { FixedLoop } from './loop';
import { clamp, DEG } from './math';

const WEAPON_KEYS: Action[] = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5'];

export class Game {
  readonly world = new World();
  readonly player = new Player();
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly cameraRig = new CameraRig();
  readonly loop: FixedLoop;
  readonly combat: CombatSystem;
  readonly particles: Particles;
  readonly viewmodel = new Viewmodel();
  private readonly dummyViews: DummyView[] = [];
  private readonly projectileView: ProjectileView;
  private slowmo = false;
  private frameMouseDx = 0;
  private frameMouseDy = 0;

  constructor(root: HTMLElement) {
    this.renderer = new Renderer(root);
    this.input = new Input(this.renderer.canvas);
    this.hud = new Hud(root);
    this.hud.overlay.addEventListener('click', () => {
      unlockAudio();
      this.input.requestLock();
    });
    document.addEventListener('pointerlockchange', () => this.hud.setOverlay(!this.input.locked));

    buildTestArena(this.world);
    this.combat = new CombatSystem(this.player, this.world, () => this.respawn());
    this.particles = new Particles(this.renderer.scene, this.world);
    this.projectileView = new ProjectileView(this.renderer.scene);
    this.addDummy(80.5, 4, 74.5);
    this.respawn();
    this.wireFeedback();

    this.loop = new FixedLoop(
      (dt) => this.step(dt),
      (alpha, frameDt) => this.frame(alpha, frameDt),
    );
  }

  start(): void {
    this.loop.start();
  }

  private addDummy(x: number, y: number, z: number): void {
    this.combat.dummies.push(new Dummy(x, y, z));
    this.dummyViews.push(new DummyView(this.renderer.scene));
  }

  private respawn(): void {
    const s = TEST_ARENA.SPAWN;
    this.player.teleport(s.x, s.y, s.z);
    this.player.yaw = 0;
    this.player.pitch = 0;
  }

  /** Hook combat events up to hitstop, camera shake, particles, sound and HUD flashes. */
  private wireFeedback(): void {
    const ev = this.combat.events;
    const loop = () => this.loop;
    const rig = this.cameraRig;
    const fx = this.particles;
    const look = () => this.combat.lookDir();

    ev.on('swing', (e) => play(e.heavy ? 'swingHeavy' : 'swing'));
    ev.on('feint', () => play('feint'));
    ev.on('telegraph', (e) => play(e.unblockable ? 'telegraphRed' : 'telegraph'));
    ev.on('hit', (e) => {
      loop().requestHitstop(e.crit ? COMBAT.HITSTOP_CRIT : e.heavy ? COMBAT.HITSTOP_HEAVY : COMBAT.HITSTOP_LIGHT);
      rig.addTrauma(e.crit || e.heavy ? COMBAT.SHAKE_HEAVY : COMBAT.SHAKE_HIT);
      fx.blood(e.pos, e.damage, look().multiplyScalar(0.6));
      this.viewmodel.kick();
      play(e.crit ? 'crit' : e.heavy ? 'hitHeavy' : 'hit');
    });
    ev.on('playerParried', (e) => {
      loop().requestHitstop(COMBAT.HITSTOP_PARRY);
      rig.addTrauma(COMBAT.SHAKE_PARRY);
      fx.sparks(e.pos, PARTICLES.SPARKS_PARRY);
      play('parried');
    });
    ev.on('parry', (e) => {
      loop().requestHitstop(COMBAT.HITSTOP_PARRY);
      rig.addTrauma(COMBAT.SHAKE_PARRY);
      fx.sparks(e.pos, PARTICLES.SPARKS_PARRY);
      this.hud.flash('parry', 0.8);
      this.viewmodel.kick(0.12);
      play('clang');
    });
    ev.on('guard', (e) => {
      loop().requestHitstop(COMBAT.HITSTOP_GUARD);
      rig.addTrauma(COMBAT.SHAKE_HIT);
      fx.sparks(e.pos, PARTICLES.SPARKS_GUARD);
      this.viewmodel.kick(0.1);
      play('guard');
    });
    ev.on('playerHit', (e) => {
      loop().requestHitstop(COMBAT.HITSTOP_PLAYER_HIT);
      rig.addTrauma(COMBAT.SHAKE_PLAYER_HIT);
      this.hud.flash('hurt', Math.min(1, 0.4 + e.damage / 30));
      play('hurt');
    });
    ev.on('postureBreak', (e) => {
      rig.addTrauma(0.4);
      fx.sparks(e.pos, 60);
      play('postureBreak');
    });
    ev.on('deathblow', (e) => {
      loop().requestHitstop(COMBAT.DEATHBLOW_HITSTOP);
      rig.addTrauma(COMBAT.SHAKE_DEATHBLOW);
      fx.blood(e.pos, 120, look());
      fx.blood(e.pos, 60);
      play('deathblow');
    });
    ev.on('kill', (e) => fx.blood(e.pos, 50));
    ev.on('heal', () => {
      this.hud.onHeal();
      this.hud.flash('heal', 0.35);
    });
    ev.on('shoot', () => play('shoot'));
    ev.on('projectileBurst', (e) =>
      fx.burst(e.pos, { count: 14, color: 0xffd23a, color2: 0xff8a1f, speed: 5, life: 0.4, size: 0.06, gravity: 4 }),
    );
    ev.on('playerDeath', () => {
      play('death');
      rig.addTrauma(0.8);
    });
  }

  private moveIntent(locked: boolean): MoveIntent {
    const i = this.input;
    if (!i.locked || locked) return NO_INTENT;
    return {
      forward: (i.isHeld('forward') ? 1 : 0) - (i.isHeld('back') ? 1 : 0),
      right: (i.isHeld('right') ? 1 : 0) - (i.isHeld('left') ? 1 : 0),
      jumpPressed: i.wasPressed('jump'),
      dashPressed: i.wasPressed('dash'),
      crouchPressed: i.wasPressed('crouch'),
      crouchHeld: i.isHeld('crouch'),
    };
  }

  private combatIntent(dashed: boolean): CombatIntent {
    const i = this.input;
    const on = i.locked;
    return {
      attackPressed: on && i.wasPressed('attack'),
      attackHeld: on && i.isHeld('attack'),
      blockPressed: on && i.wasPressed('block'),
      blockHeld: on && i.isHeld('block'),
      feintPressed: on && i.wasPressed('feint'),
      dashed,
    };
  }

  private step(dt: number): void {
    const { player, combat } = this;
    const move = this.moveIntent(combat.inputLocked());
    const dashed = move.dashPressed && player.dashPips >= 1;
    stepMovement(player, move, this.world, dt);
    if (dashed) play('dash');
    combat.step(dt, this.combatIntent(dashed), this.input.locked && this.input.wasPressed('interact'));
    if (player.pos.y < -30) this.respawn();
    this.input.endStep();
  }

  private frame(alpha: number, frameDt: number): void {
    const { input, player, combat } = this;

    // Per-frame UI actions.
    if (input.consumePress('debug')) this.hud.toggleDebug();
    if (input.consumePress('reset')) {
      combat.combat.reset();
      this.respawn();
    }
    if (input.consumePress('slowmo')) {
      this.slowmo = !this.slowmo;
      this.hud.setSlowmo(this.slowmo);
    }
    WEAPON_KEYS.forEach((k, i) => {
      if (input.consumePress(k) && i < WEAPONS.length) combat.combat.setWeapon(i);
    });
    if (input.consumePress('dummyMode')) {
      for (const d of combat.dummies) d.setMode(DUMMY_MODES[(DUMMY_MODES.indexOf(d.mode) + 1) % DUMMY_MODES.length]);
    }
    if (input.consumePress('dummyReset')) {
      const f = new Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const d = combat.dummies[0];
      d?.moveTo(player.pos.x + f.x * 4, player.pos.y + 0.01, player.pos.z + f.z * 4);
    }
    this.loop.timeScale = (this.slowmo ? SIM.DEBUG_SLOWMO_SCALE : 1) * (combat.deathblow ? COMBAT.DEATHBLOW_TIMESCALE : 1);

    // Mouse look is applied per frame for minimum latency; it also steers swing direction.
    const { dx, dy } = input.takeMouseDelta();
    this.frameMouseDx = dx;
    this.frameMouseDy = dy;
    if (!combat.deathblow) {
      player.yaw -= dx * CAMERA.MOUSE_SENSITIVITY;
      player.pitch = clamp(player.pitch - dy * CAMERA.MOUSE_SENSITIVITY, -CAMERA.PITCH_LIMIT * DEG, CAMERA.PITCH_LIMIT * DEG);
    }
    combat.combat.addAim(dx, dy);

    for (const e of player.events) this.cameraRig.handleEvent(e, player);
    player.events.length = 0;

    const strafe = input.locked ? (input.isHeld('right') ? 1 : 0) - (input.isHeld('left') ? 1 : 0) : 0;
    const zoom = combat.deathblow ? COMBAT.DEATHBLOW_FOV_ZOOM : 0;
    this.cameraRig.update(this.renderer.camera, player, alpha, frameDt, strafe, zoom);
    this.viewmodel.update(frameDt, this.renderer.camera, combat.combat, player, this.frameMouseDx, this.frameMouseDy);
    combat.dummies.forEach((d, i) => this.dummyViews[i].update(d, alpha, frameDt * this.loop.timeScale));
    this.projectileView.update(combat.projectiles, alpha);
    this.particles.update(frameDt * this.loop.timeScale);
    this.hud.update(player, combat, this.renderer.camera, frameDt);
    this.renderer.syncChunks(this.world);
    this.renderer.render(this.viewmodel.scene);
  }
}
