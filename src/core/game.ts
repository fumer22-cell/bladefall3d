import { Vector3 } from 'three';
import { play, unlockAudio } from '../audio/sfx';
import { CombatSystem } from '../combat/combatSystem';
import { NO_COMBAT_INTENT, type CombatIntent } from '../combat/playerCombat';
import { Dummy, DUMMY_MODES } from '../combat/trainingDummy';
import { CAMERA, COMBAT, PARTICLES, PLAYER, SAVE, SIM, TEST_ARENA, WORLD, type Action } from '../config';
import { craft, nearbyStations } from '../items/crafting';
import { Drops } from '../items/drops';
import { Inventory } from '../items/inventory';
import { ITEMS } from '../items/items';
import { Builder, tierName } from '../player/builder';
import { saveDb } from '../save/db';
import { editsFromSave, editsToSave, type SaveData } from '../save/serialize';
import { DropView } from '../render/dropView';
import { InventoryUI } from '../ui/inventoryUI';
import { NO_INTENT, stepMovement, type MoveIntent } from '../player/movement';
import { Player } from '../player/player';
import { BlockHighlight } from '../render/blockHighlight';
import { CameraRig } from '../render/cameraRig';
import { ChunkRenderer } from '../render/chunkRenderer';
import { DummyView } from '../render/dummyView';
import { Particles } from '../render/particles';
import { ProjectileView } from '../render/projectileView';
import { Renderer } from '../render/renderer';
import { setFogColor } from '../render/voxelMaterial';
import { Viewmodel, type HeldHand } from '../render/viewmodel';
import { Hud } from '../ui/hud';
import { COLOR, SHAPE, SOLID } from '../world/blocks';
import { CS, WORLD_H } from '../world/chunk';
import { WorldStreamer } from '../world/streamer';
import { buildTestArena } from '../world/testArena';
import { WorkerPool } from '../world/workerPool';
import { World } from '../world/world';
import { Input } from './input';
import { FixedLoop } from './loop';
import { clamp, damp, DEG } from './math';

const SLOT_KEYS: Action[] = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9'];

export type GameMode = 'world' | 'arena';

export interface GameOptions {
  mode: GameMode;
  /** World to play (world mode). New worlds come from the menu as a fresh SaveData. */
  save?: SaveData;
  /** Write progress back to IndexedDB. */
  persist?: boolean;
}

const hexRGB = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const SKY_RGB = hexRGB(WORLD.SKY_COLOR);
const CAVE_RGB = hexRGB(WORLD.CAVE_FOG_COLOR);

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
  readonly builder = new Builder();
  readonly chunks: ChunkRenderer;
  readonly streamer: WorldStreamer | null = null;
  readonly seed: number;
  private readonly highlight: BlockHighlight;
  private readonly dummyViews: DummyView[] = [];
  private readonly projectileView: ProjectileView;
  private readonly spawnPoint = new Vector3();
  /** World mode: false until the spawn area has generated. */
  private ready = false;
  private slowmo = false;
  private frameMouseDx = 0;
  private frameMouseDy = 0;
  private caveMix = 0;
  readonly mode: GameMode;
  readonly inventory = new Inventory();
  readonly drops = new Drops();
  private readonly dropView: DropView;
  private readonly inventoryUI: InventoryUI;
  /** The save this session writes to (null in the arena). */
  private readonly save: SaveData | null;
  private readonly persist: boolean;
  private autosaveTimer: number = SAVE.AUTOSAVE_INTERVAL;
  private saving = false;
  /** Seconds played since the last save. */
  private playTime = 0;

  constructor(root: HTMLElement, opts: GameOptions = { mode: 'world' }) {
    this.mode = opts.mode;
    this.save = opts.save ?? null;
    this.persist = opts.persist ?? false;
    const mode = this.mode;
    this.renderer = new Renderer(root);
    this.input = new Input(this.renderer.canvas);
    this.hud = new Hud(root);
    this.hud.overlay.addEventListener('click', () => {
      unlockAudio();
      this.input.requestLock();
    });
    this.hud.quitButton.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.saveNow().finally(() => location.reload());
    });
    this.inventoryUI = new InventoryUI(
      root,
      this.inventory,
      () => nearbyStations(this.world, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z),
      (r, times) => {
        const stations = nearbyStations(this.world, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z);
        let n = 0;
        while (n < times && craft(this.inventory, r, stations)) n++;
        if (n > 0) play('place');
      },
      () => {
        // The key that closed the inventory must not also count as "open inventory" once relocked.
        this.input.consumePress('inventory');
        this.input.requestLock();
      },
    );
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) this.hud.setOverlay(false);
      else if (!this.inventoryUI.isOpen) {
        this.hud.setOverlay(true);
        void this.saveNow();
      }
    });
    document.addEventListener('pointerlockerror', () => this.hud.setOverlay(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.saveNow();
    });

    this.seed = this.save?.seed ?? (WORLD.SEED || Math.floor(Math.random() * 2 ** 31));
    if (mode === 'arena') {
      buildTestArena(this.world);
      this.world.lightAll();
      this.chunks = new ChunkRenderer(this.renderer.scene, null);
      const s = TEST_ARENA.SPAWN;
      this.spawnPoint.set(s.x, s.y, s.z);
      this.ready = true;
    } else {
      const pool = new WorkerPool();
      this.world.recordEdits = true;
      if (this.save) for (const [k, v] of editsFromSave(this.save.edits)) this.world.edits.set(k, v);
      this.chunks = new ChunkRenderer(this.renderer.scene, pool);
      this.streamer = new WorldStreamer(this.world, pool, this.seed);
      const sp = this.save?.player;
      if (sp) this.spawnPoint.set(...sp.spawn);
      else this.spawnPoint.set(8.5, WORLD.SEA_LEVEL + 20, 8.5);
    }

    const sp = this.save?.player;
    if (sp) {
      this.inventory.load(sp.inventory, sp.selected);
    } else {
      // Starting kit.
      this.inventory.add('rusty_sword', 1);
      this.inventory.add('torch', 8);
    }

    this.highlight = new BlockHighlight(this.renderer.scene);
    this.combat = new CombatSystem(this.player, this.world, () => this.respawn());
    this.particles = new Particles(this.renderer.scene, this.world);
    this.projectileView = new ProjectileView(this.renderer.scene);
    this.dropView = new DropView(this.renderer.scene);
    this.addDummy(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z - 6);
    this.respawn();
    if (sp) {
      this.player.teleport(sp.x, sp.y, sp.z);
      this.player.yaw = sp.yaw;
      this.player.pitch = sp.pitch;
      this.combat.combat.health = sp.health;
    }
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
    const s = this.spawnPoint;
    this.player.teleport(s.x, s.y, s.z);
    this.player.yaw = 0;
    this.player.pitch = 0;
  }

  /** Top of the ground at x, z (first solid block from the sky down), or -1 if unloaded. */
  private surfaceY(x: number, z: number): number {
    if (!this.world.isLoaded(x, z)) return -1;
    for (let y = WORLD_H - 1; y > 0; y--) {
      const id = this.world.getBlock(x, y, z);
      if (SOLID[id]) return y + 1;
      if (SHAPE[id] === 'water') return -1;
    }
    return -1;
  }

  /** Once the spawn area is loaded, pick a dry spot near the origin (or resume a save where it left off). */
  private trySpawn(): void {
    const pcx = Math.floor(this.player.pos.x / CS), pcz = Math.floor(this.player.pos.z / CS);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.column(pcx + dx, pcz + dz)) return;
    if (this.save?.player) {
      this.ready = true;
      this.placeDummyInFront(6);
      return;
    }
    for (let r = 0; r < 24 && !this.ready; r++) {
      for (let a = 0; a < Math.max(1, r * 6); a++) {
        const x = 8 + Math.round(Math.cos((a / Math.max(1, r * 6)) * Math.PI * 2) * r);
        const z = 8 + Math.round(Math.sin((a / Math.max(1, r * 6)) * Math.PI * 2) * r);
        const y = this.surfaceY(x, z);
        if (y < 0) continue;
        this.spawnPoint.set(x + 0.5, y, z + 0.5);
        this.ready = true;
        break;
      }
    }
    if (!this.ready) {
      this.spawnPoint.y = this.surfaceY(8, 8) > 0 ? this.surfaceY(8, 8) : WORLD.SEA_LEVEL + 2;
      this.ready = true;
    }
    this.respawn();
    this.placeDummyInFront(6);
  }

  private placeDummyInFront(dist: number): void {
    const p = this.player;
    const x = p.pos.x - Math.sin(p.yaw) * dist, z = p.pos.z - Math.cos(p.yaw) * dist;
    let y = this.surfaceY(Math.floor(x), Math.floor(z));
    if (y < 0) y = p.pos.y;
    this.combat.dummies[0]?.moveTo(x, y + 0.01, z);
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
      jumpHeld: i.isHeld('jump'),
      dashPressed: i.wasPressed('dash'),
      crouchPressed: i.wasPressed('crouch'),
      crouchHeld: i.isHeld('crouch'),
    };
  }

  private combatIntent(dashed: boolean): CombatIntent {
    const i = this.input;
    if (!i.locked || !this.combat.combat.armed) return { ...NO_COMBAT_INTENT, dashed };
    return {
      attackPressed: i.wasPressed('attack'),
      attackHeld: i.isHeld('attack'),
      blockPressed: i.wasPressed('block'),
      blockHeld: i.isHeld('block'),
      feintPressed: i.wasPressed('feint'),
      dashed,
    };
  }

  private step(dt: number): void {
    const { player, combat, input } = this;
    if (!this.ready) {
      input.endStep();
      return;
    }
    this.syncHeld();
    const move = this.moveIntent(combat.inputLocked());
    const dashed = move.dashPressed && player.dashPips >= 1;
    stepMovement(player, move, this.world, dt);
    if (dashed) play('dash');
    combat.step(dt, this.combatIntent(dashed), input.locked && input.wasPressed('interact'));

    const b = this.builder;
    b.update(
      dt,
      {
        mineHeld: input.locked && input.isHeld('attack'),
        placeHeld: input.locked && input.isHeld('block'),
        placePressed: input.locked && input.wasPressed('block'),
      },
      this.world,
      [player.box(), ...combat.dummies.filter((d) => d.alive).map((d) => d.hurtbox())],
      this.inventory,
    );
    for (const e of b.events) {
      if (e.type === 'broken') {
        this.particles.burst(
          { x: e.x + 0.5, y: e.y + 0.5, z: e.z + 0.5 },
          { count: 24, color: COLOR[e.id], speed: 4, life: 0.9, size: 0.12 },
        );
        if (e.drop) this.drops.spawn(e.x + 0.5, e.y + 0.5, e.z + 0.5, e.drop);
        play('break');
      } else if (e.type === 'placed') {
        this.viewmodel.pulse();
        play('place');
      } else if (e.type === 'tooWeak') {
        this.hud.toast(`Needs ${tierName(e.needed)}`);
      } else play('dig');
    }
    b.events.length = 0;

    const chest = new Vector3(player.pos.x, player.pos.y + 0.9, player.pos.z);
    for (const got of this.drops.update(dt, this.world, chest, this.inventory)) {
      this.hud.pickup(got.item, got.count);
      play('pickup');
    }

    if (player.pos.y < -30) this.respawn();
    input.endStep();
  }

  private frame(alpha: number, frameDt: number): void {
    const { input, player, combat, builder } = this;

    // World streaming + spawn.
    if (this.streamer) {
      this.streamer.update(player.pos.x, player.pos.z);
      if (!this.ready) this.trySpawn();
    }
    this.hud.setLoading(!this.ready, this.streamer?.busy ?? 0);

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
    SLOT_KEYS.forEach((k, i) => {
      if (input.consumePress(k)) this.inventory.select(i);
    });
    const wheel = input.takeWheel();
    if (wheel !== 0) this.inventory.select(this.inventory.selected + wheel);
    if (input.consumePress('inventory') && input.locked && this.ready) {
      this.inventoryUI.open();
      document.exitPointerLock();
    }
    if (input.consumePress('debugKit') && this.hud.debugVisible) this.giveDebugKit();
    this.inventoryUI.update(frameDt);
    const hand = this.syncHeld();

    if (this.ready && this.persist) {
      this.autosaveTimer -= frameDt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = SAVE.AUTOSAVE_INTERVAL;
        void this.saveNow();
      }
      if (input.locked) this.playTime += frameDt;
    }
    if (input.consumePress('dummyMode')) {
      for (const d of combat.dummies) d.setMode(DUMMY_MODES[(DUMMY_MODES.indexOf(d.mode) + 1) % DUMMY_MODES.length]);
    }
    if (input.consumePress('dummyReset')) this.placeDummyInFront(4);
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

    const cam = this.renderer.camera;
    const strafe = input.locked ? (input.isHeld('right') ? 1 : 0) - (input.isHeld('left') ? 1 : 0) : 0;
    const zoom = combat.deathblow ? COMBAT.DEATHBLOW_FOV_ZOOM : 0;
    this.cameraRig.update(cam, player, alpha, frameDt, strafe, zoom);

    builder.aim(this.world, cam.position, combat.lookDir());
    this.highlight.update(builder.target, builder.progress, builder.enabled);
    hand.mining = builder.enabled && builder.target !== null && input.locked && input.isHeld('attack');
    this.viewmodel.update(frameDt, cam, combat.combat, player, this.frameMouseDx, this.frameMouseDy, hand);
    combat.dummies.forEach((d, i) => this.dummyViews[i].update(d, alpha, frameDt * this.loop.timeScale));
    this.projectileView.update(combat.projectiles, alpha);
    this.particles.update(frameDt * this.loop.timeScale);
    this.updateFog(frameDt);
    this.hud.update(player, combat, cam, frameDt);
    this.hud.updateItems(this.inventory, builder, this.debugWorldInfo(), frameDt);
    this.dropView.update(this.drops, alpha, frameDt);
    this.chunks.update(this.world, cam.position.x, cam.position.y, cam.position.z);
    this.renderer.render(this.viewmodel.scene);
  }

  /** Point combat and building at whatever is in hand. */
  private syncHeld(): HeldHand {
    const stack = this.inventory.held;
    const held = stack ? ITEMS[stack.item] : undefined;
    const c = this.combat.combat;
    if (held?.weapon) {
      c.setWeapon(held.weapon.index);
      c.materialMult = held.weapon.mult;
      c.armed = true;
      this.builder.enabled = false;
      return { kind: 'weapon', color: held.color, mining: false };
    }
    if (c.armed) c.disarm();
    this.builder.enabled = true;
    const kind = !held ? 'empty' : held.tool ? 'tool' : 'item';
    return { kind, color: held?.color ?? 0, mining: false };
  }

  private giveDebugKit(): void {
    const kit: [string, number][] = [
      ['iron_pickaxe', 1], ['iron_sword', 1], ['iron_greatsword', 1], ['iron_daggers', 1], ['iron_spear', 1], ['iron_gauntlets', 1],
      ['torch', 64], ['planks', 64], ['cobblestone', 64], ['stone_brick', 64], ['workbench', 1], ['forge', 1], ['anvil', 1],
      ['coal', 32], ['copper_ingot', 16], ['iron_ingot', 16], ['stick', 32],
    ];
    for (const [id, n] of kit) this.inventory.add(id, n);
    this.hud.toast('Test kit added');
  }

  /** Write the world + player to IndexedDB (no-op in the arena or when storage is unavailable). */
  async saveNow(): Promise<void> {
    if (!this.save || !this.persist || !this.ready || this.saving) return;
    this.saving = true;
    const p = this.player;
    const s = this.save;
    s.updatedAt = Date.now();
    s.playTime += this.playTime;
    this.playTime = 0;
    s.player = {
      x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch,
      health: this.combat.combat.health,
      inventory: this.inventory.serialize(),
      selected: this.inventory.selected,
      spawn: [this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z],
    };
    s.edits = editsToSave(this.world.edits);
    try {
      await saveDb.put(s);
      this.hud.showSaved();
    } catch {
      this.hud.toast('Could not save (browser storage unavailable)', 3);
    } finally {
      this.saving = false;
    }
  }

  /** Fade fog/sky toward near-black when the camera is somewhere without sky light (caves). */
  private updateFog(dt: number): void {
    const cam = this.renderer.camera.position;
    const sky = this.world.getLight(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z)) >> 4;
    this.caveMix = damp(this.caveMix, 1 - Math.min(1, sky / 12), 2.5, dt);
    const t = this.caveMix;
    const r = SKY_RGB[0] + (CAVE_RGB[0] - SKY_RGB[0]) * t;
    const g = SKY_RGB[1] + (CAVE_RGB[1] - SKY_RGB[1]) * t;
    const b = SKY_RGB[2] + (CAVE_RGB[2] - SKY_RGB[2]) * t;
    setFogColor([this.chunks.opaqueMat, this.chunks.waterMat], r, g, b);
    this.renderer.setSkyColor(r, g, b);
  }

  private debugWorldInfo(): string {
    const p = this.player.pos;
    const l = this.world.getLight(Math.floor(p.x), Math.floor(p.y + PLAYER.EYE_HEIGHT), Math.floor(p.z));
    return (
      `world    ${this.mode} seed ${this.seed}  chunk ${Math.floor(p.x / CS)},${Math.floor(p.z / CS)}\n` +
      `columns  ${this.world.columns.size}  meshes ${this.chunks.meshCount}  dirty ${this.world.dirty.size}\n` +
      `jobs     gen ${this.streamer?.busy ?? 0}  mesh ${this.chunks.pending}\n` +
      `light    sky ${l >> 4} block ${l & 15}${this.player.inWater ? '  (in water)' : ''}`
    );
  }
}
