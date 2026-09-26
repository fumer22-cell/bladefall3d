import { Vector3 } from 'three';
import { play, unlockAudio } from '../audio/sfx';
import { CombatSystem } from '../combat/combatSystem';
import { NO_COMBAT_INTENT, type CombatIntent } from '../combat/playerCombat';
import { Dummy, DUMMY_MODES } from '../combat/trainingDummy';
import { CAMERA, COMBAT, DAYNIGHT, ENEMIES, LOOM, PARTICLES, UPGRADES, PLAYER, SAVE, SIM, SKY, SURVIVAL, TEST_ARENA, WORLD, type Action } from '../config';
import { craft, nearbyStations } from '../items/crafting';
import { Drops } from '../items/drops';
import { Inventory } from '../items/inventory';
import { ITEMS, blockDrop } from '../items/items';
import { FallingTrees } from '../render/fallingTrees';
import { RopeView } from '../render/ropeView';
import { Builder, tierName } from '../player/builder';
import { saveDb } from '../save/db';
import { editsFromSave, editsToSave, type SaveData } from '../save/serialize';
import { Fireflies } from '../render/ambient';
import { DropView } from '../render/dropView';
import { InventoryUI } from '../ui/inventoryUI';
import { NO_INTENT, stepMovement, type MoveIntent } from '../player/movement';
import { Player } from '../player/player';
import { BlockHighlight } from '../render/blockHighlight';
import { CameraRig } from '../render/cameraRig';
import { ChunkRenderer } from '../render/chunkRenderer';
import { DummyView } from '../render/dummyView';
import { CrowView, HuskView, type CombatantView } from '../render/enemyViews';
import { Spawner } from '../enemies/spawner';
import { Crow } from '../enemies/crow';
import type { Combatant } from '../combat/combatant';
import { Particles } from '../render/particles';
import { ProjectileView } from '../render/projectileView';
import { Renderer } from '../render/renderer';
import { setDaylight, setFogColor } from '../render/voxelMaterial';
import { MemoryView } from '../render/memoryView';
import { loomUniforms } from '../render/loom';
import { DayNight } from '../survival/daynight';
import { Hunger } from '../survival/hunger';
import { Memory } from '../survival/memory';
import { Temperature } from '../survival/temperature';
import { Viewmodel, type HeldHand } from '../render/viewmodel';
import { Hud } from '../ui/hud';
import { Block, COLOR, SHAPE, SOLID } from '../world/blocks';
import { CS } from '../world/chunk';
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
const DUSK_RGB = hexRGB(SKY.HAZE);
const DAY_RGB = hexRGB(DAYNIGHT.DAY_HAZE);
const NIGHT_RGB = hexRGB(DAYNIGHT.NIGHT_HAZE);
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
  private readonly views = new Map<Combatant, CombatantView>();
  private dummy!: Dummy;
  readonly spawner = new Spawner();
  private readonly projectileView: ProjectileView;
  private readonly spawnPoint = new Vector3();
  /** World mode: false until the spawn area has generated. */
  private ready = false;
  private slowmo = false;
  private frameMouseDx = 0;
  private frameMouseDy = 0;
  private caveMix = 0;
  private clock = 0;
  readonly mode: GameMode;
  readonly inventory = new Inventory();
  readonly drops = new Drops();
  private readonly dropView: DropView;
  private readonly fireflies: Fireflies;
  private readonly inventoryUI: InventoryUI;
  /** The save this session writes to (null in the arena). */
  private readonly save: SaveData | null;
  private readonly persist: boolean;
  private autosaveTimer: number = SAVE.AUTOSAVE_INTERVAL;
  private saving = false;
  /** Seconds played since the last save. */
  private playTime = 0;

  // --- Survival ---
  readonly daynight = new DayNight();
  readonly hunger = new Hunger();
  readonly temperature = new Temperature();
  readonly memory = new Memory();
  private readonly memoryView: MemoryView;
  private readonly fallingTrees: FallingTrees;
  private readonly rope: RopeView;
  private abilitiesVersion = -1;
  /** Hunger, cold, death memories and beds only run in world mode. */
  private readonly survival: boolean;
  /** Bed block the player respawns at. */
  private bed: [number, number, number] | null = null;
  /** Seconds left of warmth from hot food. */
  private warmBuff = 0;
  private sleepTimer = 0;
  private slept = false;
  private deathNote = '';
  /** Last spot the player stood on dry ground (memory orbs go here after falling into the void). */
  private readonly lastSafe = new Vector3();
  /** Looming warp strength target (toggled with L) and current value. */
  private loomTarget: number = LOOM.ENABLED ? 1 : 0;

  constructor(root: HTMLElement, opts: GameOptions = { mode: 'world' }) {
    this.mode = opts.mode;
    this.save = opts.save ?? null;
    this.persist = opts.persist ?? false;
    const mode = this.mode;
    this.survival = mode === 'world';
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
      this.inventory.load(sp.inventory, sp.selected, sp.armor ?? [], sp.trinkets ?? []);
      if (sp.food !== undefined) this.hunger.food = sp.food;
      if (sp.bodyTemp !== undefined) this.temperature.body = sp.bodyTemp;
      this.bed = sp.bed ?? null;
      if (sp.time !== undefined) this.daynight.time = sp.time;
      if (sp.day !== undefined) this.daynight.day = sp.day;
      this.memory.orb = sp.memory ?? null;
    } else {
      // Starting kit.
      this.inventory.add('rusty_sword', 1);
      this.inventory.add('torch', 8);
    }

    this.highlight = new BlockHighlight(this.renderer.scene);
    if (!this.survival) {
      this.daynight.time = DAYNIGHT.ARENA_TIME;
      this.daynight.frozen = true;
    }
    this.combat = new CombatSystem(this.player, this.world, () => this.onRespawn());
    this.particles = new Particles(this.renderer.scene, this.world);
    this.projectileView = new ProjectileView(this.renderer.scene);
    this.dropView = new DropView(this.renderer.scene);
    this.fireflies = new Fireflies(this.renderer.scene, this.world);
    this.memoryView = new MemoryView(this.renderer.scene);
    this.fallingTrees = new FallingTrees(this.renderer.scene);
    this.rope = new RopeView(this.renderer.scene);
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
    this.dummy = new Dummy(x, y, z);
    this.addEnemy(this.dummy);
  }

  private addEnemy(e: Combatant): void {
    this.combat.enemies.push(e);
    const scene = this.renderer.scene;
    this.views.set(e, e.kind === 'husk' ? new HuskView(scene) : e.kind === 'crow' ? new CrowView(scene) : new DummyView(scene));
  }

  private removeEnemy(e: Combatant): void {
    const list = this.combat.enemies;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    this.views.get(e)?.dispose();
    this.views.delete(e);
  }

  /** Spawn/despawn wild enemies, remove corpses, keep enemies from stacking on each other. */
  private updateEnemies(dt: number): void {
    const list = this.combat.enemies;
    if (this.streamer && this.ready) {
      const despawn = new Set<Combatant>();
      const env = { daylight: this.daynight.daylight(), night: this.daynight.night() };
      for (const e of this.spawner.update(dt, this.world, this.player.pos, list, despawn, env)) this.addEnemy(e);
      for (const e of despawn) this.removeEnemy(e);
    }
    const daylight = this.daynight.daylight();
    for (const e of list) {
      const c = e.center();
      const l = this.world.getLight(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z));
      e.lit = Math.max(((l >> 4) / 15) * daylight, (l & 15) / 15);
      // Husks smoulder and crumble in strong sunlight.
      if (e.kind === 'husk' && e.alive && daylight > 0.85 && l >> 4 >= 13) {
        e.health -= ENEMIES.SUN_BURN_DPS * dt;
        if (Math.random() < dt * 8) this.particles.burst(c, { count: 3, color: 0x484957, color2: 0xdc7629, speed: 1.2, life: 0.8, size: 0.1, gravity: -2 });
        if (e.health <= 0) {
          e.health = 0;
          e.kill();
        }
      }
    }
    for (const e of [...list]) if (e.removable) this.removeEnemy(e);
    const S = ENEMIES.SEPARATION;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (!a.alive || !b.alive || a.kind === 'dummy' || b.kind === 'dummy') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dz);
        if (d >= S || d < 1e-4 || Math.abs(dy) > 1.5) continue;
        const push = ((S - d) / d) * 2;
        a.vel.x -= dx * push;
        a.vel.z -= dz * push;
        b.vel.x += dx * push;
        b.vel.z += dz * push;
      }
  }

  private respawn(): void {
    const s = this.spawnPoint;
    const b = this.bed;
    if (b && this.world.isLoaded(b[0], b[2]) && this.world.getBlock(b[0], b[1], b[2]) === Block.BED) {
      this.player.teleport(b[0] + 0.5, b[1] + 1, b[2] + 0.5);
    } else {
      if (b && this.world.isLoaded(b[0], b[2])) {
        this.bed = null;
        this.hud.toast('Your bed is gone: back to the world spawn', 3);
      }
      this.player.teleport(s.x, s.y, s.z);
    }
    this.player.yaw = 0;
    this.player.pitch = 0;
  }

  /** Back from death. */
  private onRespawn(): void {
    this.respawn();
    if (!this.survival) return;
    this.hunger.reset(Math.max(this.hunger.food, SURVIVAL.RESPAWN_FOOD));
    this.temperature.reset();
    this.warmBuff = 0;
  }

  /** Died: coins stay behind in a memory where you fell (the previous memory is lost). */
  private onDeath(): void {
    if (!this.survival) return;
    const p = this.player.pos;
    const at = p.y < 1 ? this.lastSafe : p;
    const { lost, stored } = this.memory.onDeath(at.x, at.y + 0.9, at.z, this.inventory);
    this.deathNote =
      (stored > 0 ? `Your ${stored} Grave Coins linger where you fell` : 'Your memory holds nothing') +
      (lost > 0 ? ` · ${lost} coins from your last death are gone` : '');
    void this.saveNow();
  }

  /**
   * Standable ground at x, z below the floating-island band: a solid, non-water block with two
   * clear blocks above that sunlight reaches. Returns the feet y, or −1 if none/unloaded.
   */
  private surfaceY(x: number, z: number, from = 110, needSky = true): number {
    if (!this.world.isLoaded(x, z)) return -1;
    const w = this.world;
    for (let y = from; y > 1; y--) {
      const id = w.getBlock(x, y, z);
      if (SHAPE[id] === 'water') return -1;
      if (!SOLID[id]) continue;
      if (SOLID[w.getBlock(x, y + 1, z)] || SOLID[w.getBlock(x, y + 2, z)]) continue;
      if (needSky && w.getLight(x, y + 1, z) >> 4 < 13) continue; // under a roof, island or in a cave
      return y + 1;
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
    let y = this.surfaceY(Math.floor(x), Math.floor(z), Math.floor(p.pos.y) + 4, false);
    if (y < 0) y = p.pos.y;
    this.dummy.moveTo(x, y + 0.01, z);
  }

  /** Hook combat events up to hitstop, camera shake, particles, sound and HUD flashes. */
  private wireFeedback(): void {
    const ev = this.combat.events;
    const loop = () => this.loop;
    const rig = this.cameraRig;
    const fx = this.particles;
    const look = () => this.combat.lookDir();

    ev.on('swing', (e) => {
      play(e.heavy ? 'swingHeavy' : 'swing');
      if (this.survival) this.hunger.exert(SURVIVAL.FOOD_PER_SWING);
    });
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
    ev.on('kill', (e) => {
      fx.blood(e.pos, 50);
      for (const l of e.target.loot()) for (let k = 0; k < l.count; k++) this.drops.spawn(e.pos.x, e.pos.y, e.pos.z, l.item);
    });
    ev.on('aggro', (e) => {
      play(e.kind === 'crow' ? 'caw' : 'groan');
      // Crows are neutral, but attack one and its flock joins in.
      if (e.kind === 'crow')
        for (const c of this.combat.enemies)
          if (c instanceof Crow && Math.hypot(c.pos.x - e.pos.x, c.pos.y - e.pos.y, c.pos.z - e.pos.z) < 26) c.provoke();
    });
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
      this.onDeath();
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
      grapplePressed: i.wasPressed('grapple'),
      grappleHeld: i.isHeld('grapple'),
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
    // Not ready yet, or paused (pointer released without the inventory open): the world waits.
    if (!this.ready || (!input.locked && !this.inventoryUI.isOpen)) {
      input.endStep();
      return;
    }
    this.syncHeld();
    this.syncAbilities();
    this.daynight.update(dt);
    const move = this.moveIntent(combat.inputLocked() || this.sleepTimer > 0);
    const dashed = move.dashPressed && player.dashPips >= 1;
    stepMovement(player, move, this.world, dt);
    if (dashed) {
      play('dash');
      if (this.survival) this.hunger.exert(SURVIVAL.FOOD_PER_DASH);
    }
    let interact = input.locked && input.wasPressed('interact');
    if (interact && this.survival && this.tryBed()) interact = false;
    combat.step(dt, this.combatIntent(dashed), interact);
    this.updateEnemies(dt);
    if (this.survival) this.stepSurvival(dt);

    const b = this.builder;
    b.update(
      dt,
      {
        mineHeld: input.locked && input.isHeld('attack'),
        placeHeld: input.locked && input.isHeld('block'),
        placePressed: input.locked && input.wasPressed('block'),
      },
      this.world,
      [player.box(), ...combat.enemies.filter((d) => d.alive).map((d) => d.hurtbox())],
      this.inventory,
    );
    // Area mining breaks many blocks at once: merge their drops into one stack per item.
    const loot = new Map<string, { n: number; x: number; y: number; z: number }>();
    const addLoot = (item: string | null, x: number, y: number, z: number, n = 1) => {
      if (!item) return;
      const l = loot.get(item);
      if (l) l.n += n;
      else loot.set(item, { n, x, y, z });
    };
    let broke = 0;
    for (const e of b.events) {
      if (e.type === 'broken') {
        broke++;
        this.particles.burst(
          { x: e.x + 0.5, y: e.y + 0.5, z: e.z + 0.5 },
          { count: broke === 1 ? 24 : 6, color: COLOR[e.id], speed: 4, life: 0.9, size: 0.12 },
        );
        addLoot(e.drop, e.x + 0.5, e.y + 0.5, e.z + 0.5);
        if (e.id === Block.BERRY_BUSH) addLoot('duskberries', e.x + 0.5, e.y + 0.5, e.z + 0.5, 1 + Math.floor(Math.random() * 2));
        if (broke === 1) play('break');
      } else if (e.type === 'fell') {
        const away = { x: e.x + 0.5 - player.pos.x, z: e.z + 0.5 - player.pos.z };
        this.fallingTrees.add(e, e.blocks, away.x, away.z);
        play('fell');
      } else if (e.type === 'placed') {
        this.viewmodel.pulse();
        play('place');
      } else if (e.type === 'tooWeak') {
        this.hud.toast(`Needs ${tierName(e.needed)}`);
      } else play('dig');
    }
    b.events.length = 0;
    for (const [item, l] of loot) this.drops.spawn(l.x, l.y, l.z, item, l.n);

    // Felled trees that hit the ground burst into leaves and drops.
    for (const t of this.fallingTrees.update(dt)) {
      const stacks = new Map<string, { n: number; at: Vector3 }>();
      t.blocks.forEach((blk, i) => {
        const p = t.positions[i];
        if (i % 3 === 0) this.particles.burst(p, { count: 5, color: COLOR[blk.id], speed: 3, life: 0.8, size: 0.14 });
        const item = blockDrop(blk.id);
        if (!item) return;
        const s = stacks.get(item);
        if (s) s.n++;
        else stacks.set(item, { n: 1, at: p });
      });
      for (const [item, s] of stacks) {
        let y = s.at.y;
        for (let k = 0; k < 8 && this.world.isSolid(Math.floor(s.at.x), Math.floor(y), Math.floor(s.at.z)); k++) y += 1;
        this.drops.spawn(s.at.x, y, s.at.z, item, s.n);
      }
      this.cameraRig.addTrauma(0.25);
      play('treeLand');
    }

    const chest = new Vector3(player.pos.x, player.pos.y + 0.9, player.pos.z);
    for (const got of this.drops.update(dt, this.world, chest, this.inventory)) {
      this.hud.pickup(got.item, got.count);
      play('pickup');
    }

    if (player.pos.y < -30) {
      // The void kills in the world (the memory goes to the last safe ground); the arena just resets.
      if (this.survival && !combat.isDead()) combat.hurtPlayer(1e6);
      else if (!this.survival) this.respawn();
    }
    input.endStep();
  }

  /** Hunger, eating, temperature, healing from food, sleeping, reclaiming memories. */
  private stepSurvival(dt: number): void {
    const { player, combat, input, hunger } = this;
    if (player.grounded && !player.inWater) this.lastSafe.copy(player.pos);

    // Sleeping: fade out, skip to morning halfway, fade back in.
    if (this.sleepTimer > 0) {
      this.sleepTimer -= dt;
      if (!this.slept && this.sleepTimer < DAYNIGHT.SLEEP_FADE / 2) {
        this.slept = true;
        this.daynight.skipToMorning();
        for (const e of [...combat.enemies]) if (e.kind !== 'dummy') this.removeEnemy(e);
        hunger.exert(8);
        void this.saveNow();
      }
    }
    if (combat.isDead()) {
      hunger.eating = 0;
      return;
    }

    // Eating: hold RMB with food in hand.
    const stack = this.inventory.held;
    const food = stack ? ITEMS[stack.item]?.food : undefined;
    const missing = COMBAT.PLAYER_MAX_HEALTH - combat.combat.health;
    const wantsEat = !!food && input.locked && input.isHeld('block') && this.sleepTimer <= 0 && hunger.wants(food, missing);
    if (hunger.updateEating(dt, wantsEat) && food) {
      this.inventory.consumeHeld();
      hunger.eat(food);
      if (food.warm) this.warmBuff = SURVIVAL.WARM_BUFF_TIME;
      play('eat');
    } else if (wantsEat && Math.random() < dt * 5) play('eat');

    this.warmBuff = Math.max(0, this.warmBuff - dt);
    const head = this.world.getLight(Math.floor(player.pos.x), Math.floor(player.pos.y + PLAYER.EYE_HEIGHT), Math.floor(player.pos.z));
    const freeze = this.temperature.update(dt, this.world, player.pos.x, player.pos.y, player.pos.z, {
      skyLight: head >> 4,
      night: this.daynight.night(),
      inWater: player.inWater,
      insulation: this.inventory.warmth() + (this.warmBuff > 0 ? SURVIVAL.WARM_BUFF : 0),
    });
    const { heal, damage } = hunger.update(dt, this.temperature.foodMult());
    const c = combat.combat;
    if (heal > 0) c.health = Math.min(COMBAT.PLAYER_MAX_HEALTH, c.health + heal);
    for (const d of [damage, freeze]) {
      if (d <= 0) continue;
      combat.hurtPlayer(d);
      this.hud.flash('hurt', 0.45);
      play('hurt');
    }
    player.regenMult = hunger.regenMult();
    player.speedMult *= this.temperature.moveMult() * (hunger.eating > 0 ? SURVIVAL.EAT_MOVE_MULT : 1);
    combat.damageTakenMult = 1 - this.inventory.defense();

    const got = this.memory.update(player.pos.x, player.pos.y, player.pos.z, this.inventory);
    if (got > 0) {
      this.hud.toast(`Memory reclaimed: +${got} Grave Coins`, 2.5);
      this.particles.burst({ x: player.pos.x, y: player.pos.y + 1, z: player.pos.z }, { count: 40, color: 0x66c1d6, color2: 0xb1eeee, speed: 4, life: 0.9, size: 0.08, gravity: -1 });
      play('memory');
    }
  }

  /** F on a bed: set respawn there, and sleep through the night if it's safe. Returns true if handled. */
  private tryBed(): boolean {
    const t = this.builder.target;
    if (!t || this.world.getBlock(t.x, t.y, t.z) !== Block.BED || this.combat.deathblowTarget()) return false;
    if (this.sleepTimer > 0) return true;
    this.bed = [t.x, t.y, t.z];
    if (!this.daynight.isNight()) {
      this.hud.toast('Respawn point set. You can only sleep at night.', 2.5);
      return true;
    }
    const R = DAYNIGHT.SLEEP_ENEMY_RADIUS;
    const near = this.combat.enemies.some((e) => e.kind !== 'dummy' && e.alive && e.pos.distanceTo(this.player.pos) < R);
    if (near) {
      this.hud.toast('Respawn point set. You cannot rest with enemies nearby.', 2.5);
      return true;
    }
    this.sleepTimer = DAYNIGHT.SLEEP_FADE;
    this.slept = false;
    play('sleep');
    return true;
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
      this.dummy.setMode(DUMMY_MODES[(DUMMY_MODES.indexOf(this.dummy.mode) + 1) % DUMMY_MODES.length]);
    }
    if (input.consumePress('toggleSpawns')) {
      this.spawner.enabled = !this.spawner.enabled;
      if (!this.spawner.enabled) for (const e of [...combat.enemies]) if (e.kind !== 'dummy') this.removeEnemy(e);
      this.hud.toast(this.spawner.enabled ? 'Enemy spawning on' : 'Enemy spawning off (cleared)');
    }
    if (input.consumePress('dummyReset')) this.placeDummyInFront(4);
    if (input.consumePress('toggleLoom')) {
      this.loomTarget = this.loomTarget > 0.5 ? 0 : 1;
      this.hud.toast(this.loomTarget ? 'Looming far field on' : 'Looming off (true distances)');
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

    for (const e of player.events) {
      this.cameraRig.handleEvent(e, player);
      if (e.type === 'airJump') {
        play('airJump');
        this.particles.burst({ x: player.pos.x, y: player.pos.y, z: player.pos.z }, { count: 10, color: 0xe6dcc1, speed: 3, life: 0.4, size: 0.06, gravity: 2 });
      } else if (e.type === 'grapple') play(e.hit ? 'grapple' : 'feint');
    }
    player.events.length = 0;

    const cam = this.renderer.camera;
    const strafe = input.locked ? (input.isHeld('right') ? 1 : 0) - (input.isHeld('left') ? 1 : 0) : 0;
    const zoom = combat.deathblow ? COMBAT.DEATHBLOW_FOV_ZOOM : 0;
    this.cameraRig.update(cam, player, alpha, frameDt, strafe, zoom);

    builder.aim(this.world, cam.position, combat.lookDir());
    this.highlight.update(builder.target, builder.progress, builder.enabled);
    hand.mining = builder.enabled && builder.target !== null && input.locked && input.isHeld('attack');
    this.viewmodel.update(frameDt, cam, combat.combat, player, this.frameMouseDx, this.frameMouseDy, hand);
    for (const e of combat.enemies) this.views.get(e)?.update(e, alpha, frameDt * this.loop.timeScale);
    this.projectileView.update(combat.projectiles, alpha);
    this.particles.update(frameDt * this.loop.timeScale);
    this.updateFog(frameDt);
    this.hud.update(player, combat, cam, frameDt);
    this.hud.updateItems(this.inventory, builder, this.debugWorldInfo(), frameDt);
    this.dropView.update(this.drops, alpha, frameDt);
    this.memoryView.update(this.memory.orb, frameDt);
    this.rope.update(player.grappleAnchor, cam, player.state === 'grapple' ? Math.min(1, player.grappleTime * 6) : 0);
    const sleepK = this.sleepTimer > 0 ? 1 - Math.abs(this.sleepTimer / DAYNIGHT.SLEEP_FADE - 0.5) * 2 : 0;
    this.hud.setSleep(Math.min(1, sleepK * 1.6), this.slept ? `Day ${this.daynight.day}` : '…');
    const dn = this.daynight;
    this.hud.updateSurvival(
      {
        food: this.hunger.food,
        healPool: this.hunger.healPool,
        eating: this.hunger.eating,
        hunger: this.hunger.state,
        temp: this.temperature.state,
        bodyTemp: this.temperature.body,
        warmBuff: this.warmBuff > 0,
        day: dn.day,
        phase: dn.phaseName(),
        night: dn.isNight(),
        memory: this.memory.orb,
        deathNote: this.survival ? this.deathNote : '',
      },
      cam,
    );
    this.chunks.update(this.world, cam.position.x, cam.position.y, cam.position.z);
    const hfov = Math.atan(Math.tan((cam.fov * DEG) / 2) * cam.aspect);
    this.chunks.cull(cam.position.x, cam.position.z, player.yaw, player.pitch, hfov);
    const loom = loomUniforms.uLoom.value;
    loom.z += Math.sign(this.loomTarget - loom.z) * Math.min(Math.abs(this.loomTarget - loom.z), frameDt / LOOM.TOGGLE_TIME);
    this.renderer.render(this.viewmodel.scene);
  }

  /** Movement comes from worn trinkets in the world (everything is unlocked in the arena). */
  private syncAbilities(): void {
    if (this.inventory.version === this.abilitiesVersion) return;
    this.abilitiesVersion = this.inventory.version;
    const p = this.player;
    const before = p.abilities;
    p.abilities = this.survival ? this.inventory.abilities() : { ...UPGRADES.FULL };
    const a = p.abilities;
    p.dashPips = Math.min(p.dashPips, a.dashPips);
    p.airJumpsLeft = Math.min(p.airJumpsLeft, a.airJumps);
    p.wallJumpsLeft = Math.min(p.wallJumpsLeft, a.wallJumps);
    if (!a.grapple) p.grappleAnchor = null;
    const gained = a.dashPips > before.dashPips || a.airJumps > before.airJumps || (a.wallRun && !before.wallRun) || (a.grapple && !before.grapple);
    if (gained && this.ready) play('equip');
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
      ['grappling_hook', 1], ['climbing_claws', 1], ['storm_charm', 1], ['iron_band', 1], ['feather_charm', 1],
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
      armor: this.inventory.serializeArmor(),
      trinkets: this.inventory.serializeTrinkets(),
      food: this.hunger.food,
      bodyTemp: this.temperature.body,
      bed: this.bed,
      time: this.daynight.time,
      day: this.daynight.day,
      memory: this.memory.orb,
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
    // Time of day: blend the day, dusk and night looks.
    const dn = this.daynight;
    const dusk = dn.dusk();
    const mix = { day: dn.dayness() * (1 - dusk), dusk, night: dn.night() * (1 - dusk) };
    const sum = mix.day + mix.dusk + mix.night || 1;
    const blend = (a: readonly number[], b: readonly number[], c: readonly number[], i: number) =>
      (a[i] * mix.day + b[i] * mix.dusk + c[i] * mix.night) / sum;
    const haze = [0, 1, 2].map((i) => blend(DAY_RGB, DUSK_RGB, NIGHT_RGB, i));
    const tint = [0, 1, 2].map((i) => blend(DAYNIGHT.DAY_TINT, DAYNIGHT.DUSK_TINT, DAYNIGHT.NIGHT_TINT, i));
    const mats = [this.chunks.opaqueMat, this.chunks.waterMat];
    const daylight = dn.daylight();
    setDaylight(mats, daylight, tint);
    this.renderer.sky.setTimeOfDay(dn.time, mix);
    this.renderer.setDaylight(daylight, tint, this.renderer.sky.sunDir);

    const r = haze[0] + (CAVE_RGB[0] - haze[0]) * t;
    const g = haze[1] + (CAVE_RGB[1] - haze[1]) * t;
    const b = haze[2] + (CAVE_RGB[2] - haze[2]) * t;
    setFogColor(mats, r, g, b);
    this.renderer.setSkyColor(r, g, b);
    this.clock += dt;
    this.renderer.sky.update(this.renderer.camera.position, this.clock, t);
    if (this.ready) this.fireflies.update(dt, this.renderer.camera, Math.max(t, dn.night()));
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
