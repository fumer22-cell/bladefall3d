# BLADEFALL — Architecture & Build Plan

First-person voxel sandbox survival (mining, building, crafting, biomes, bosses) with ULTRAKILL-style movement and Sekiro/Chivalry-style melee.

Stack: **TypeScript + Three.js + Vite**, browser only. No physics engine; custom AABB-vs-voxel collision. Flat-colored voxels, box-model enemies.

---

## 1. Guiding principles

1. **Every phase is playable.** `npm run dev` → open browser → something to do and test.
2. **All tunables in `src/config.ts`.** Speeds, windows, damage, FOV, gravity, chunk size, render distance, spawn rates. Grouped by system (`MOVE`, `COMBAT`, `WEAPONS`, `WORLD`, `SURVIVAL`, …), plain `as const` objects. No magic numbers elsewhere.
3. **Fixed-timestep simulation, variable-rate rendering.** Sim at 60 Hz (accumulator loop, capped catch-up steps), render interpolates between the previous and current sim state. Hitstop = the sim clock pauses/scales; render keeps running.
4. **Simulation is separate from rendering.** Game state (entities, world data, player) lives in plain TS objects; `/render` reads them. Keeps save/load and later features (bosses mirroring player, etc.) simple.
5. **Data-driven content.** Blocks, items, recipes, weapons, enemies, and biomes are registries of plain data, so adding content in Phase 9 is mostly adding entries.

---

## 2. Directory layout

```
/index.html
/vite.config.ts
/tsconfig.json
/src
  main.ts                 bootstrap, creates Game
  config.ts               ALL tunable numbers
  /core
    game.ts               owns systems, fixed-timestep loop, state machine (menu/playing/paused/dead)
    loop.ts               accumulator loop + interpolation alpha + time scale (hitstop/slowmo)
    input.ts              keyboard/mouse, pointer lock, action bindings, input buffering
    events.ts             tiny typed event bus (onHit, onParry, onKill, onBlockBroken…)
    rng.ts                seeded RNG
    math.ts               vec helpers, easing, damp/lerp
  /world
    blocks.ts             block registry (id, color, solid, transparent, hardness, tool tier, light emission, friction, drops)
    chunk.ts              16×16×16 chunk: Uint16Array block ids + Uint8Array light
    world.ts              chunk map, get/set block (world coords), dirty tracking, load/unload around player
    worldgen.worker.ts    Web Worker: noise terrain, caves, ores, biomes, structures
    worldgen/*.ts         noise (simplex), biome selection, per-biome generators, structure stamps
    lighting.ts           BFS sunlight + block-light propagation & removal
    raycast.ts            voxel DDA raycast (mining/placing/line of sight)
    collision.ts          AABB-vs-voxel sweep (per axis), ground/wall/ceiling contacts, step-up
  /render
    renderer.ts           Three.js scene, camera, resize, fog, sky
    mesher.worker.ts      greedy mesher (in worker), per-vertex AO + light baked into vertex colors
    chunkMeshes.ts        upload/dispose chunk geometry, frustum culling
    camera.ts             FOV kick, tilt, shake (trauma-based), deathblow camera animation
    viewmodel.ts          first-person weapon model, sway, bob, recoil, swing animations
    particles.ts          pooled GPU-instanced particles (blood, sparks, dust, debris)
    boxModel.ts           helper to build box-model characters from part specs
  /player
    player.ts             player entity: state, health, posture, stamina pips
    movement.ts           movement state machine (ground/air/slide/dash/slam/wallrun-contact)
    controller.ts         maps input → movement + combat intents
  /combat
    attack.ts             attack data (windup/active/recovery, direction, damage, posture dmg, reach, arc)
    melee.ts              swing resolution: sweep arc hit tests against hurtboxes
    parry.ts              block/parry state, perfect-parry window, guard posture drain
    posture.ts            posture meters, regen rules, break → stagger → deathblow
    damage.ts             damage pipeline (armor, crits, riposte, knockback, blood spawn)
    projectiles.ts        projectile sim, projectile parry/reflect to crosshair
    telegraphs.ts         yellow/red weapon glow, off-screen attack indicators
    style.ts              style meter (Phase 10, hooks exist earlier)
    hitstop.ts            hitstop + slowmo requests
  /items
    items.ts              item registry (blocks, tools, weapons, food, armor, scrolls)
    weapons.ts            weapon defs: movesets/combos, parry window modifiers, reach
    inventory.ts          slots, stacking, hotbar
    crafting.ts           recipes + station requirements
  /enemies
    entity.ts             shared entity base (pos, vel, AABB, health, posture, faction)
    ai/                   behavior state machines + shared behaviors (approach, circle, flee, attack)
    pathfinding.ts        A* on voxel grid (walkable = solid below, 2 air above), jump/drop links, path cache
    spawner.ts            biome/time/light-based spawning & despawning
    defs/*.ts             husk.ts, crow.ts, … one file per enemy
  /bosses
    boss.ts               boss base: phases, arena lock, music trigger, scroll drop
    defs/*.ts             one file per boss
  /npcs
    housing.ts            room validation (flood fill: enclosed, light, door, chair)
    npc.ts                NPC base, spawn conditions, dialogue/shop hooks
    defs/*.ts             guide.ts, blacksmith.ts, …
  /survival
    hunger.ts, temperature.ts, daynight.ts, death.ts (memory drop), spawnpoint.ts
  /save
    db.ts                 IndexedDB wrapper
    serialize.ts          world (modified chunks only, RLE), player, inventory, flags
  /ui
    hud.ts                HTML/CSS overlay: health, posture, stamina pips, hotbar, crosshair
    menus.ts              main/pause/settings/death screens
    inventoryUI.ts, craftingUI.ts, dialogueUI.ts, bossBar.ts, debug.ts (F3 overlay)
  /audio
    sfx.ts                sound hook calls (named events → placeholder WebAudio beeps until real assets)
```

UI is plain DOM over the canvas (fast to build, crisp text); 3D-space elements (telegraph glows, memory orb) are in Three.js.

---

## 3. Key technical decisions

### Game loop
- `SIM_HZ = 60`, `dt = 1/60`. Accumulator with max 5 steps per frame (avoid spiral of death).
- `timeScale` in loop: hitstop sets it to ~0 for N ms, slowmo for deathblows.
- Render state is interpolated (`prev` / `curr` positions) → smooth on 120/144 Hz monitors.

### Voxels
- Chunk = **16³** (config). World columns are finite in height (e.g. 0..255 → 16 chunks tall), infinite-ish in X/Z.
- Block data `Uint16Array` (room for many block types), light `Uint8Array` (4 bits sky, 4 bits block light).
- **Workers:** a small pool — generation worker(s) produce chunk data; mesher worker(s) produce greedy meshes (positions, normals, colors, indices as transferable ArrayBuffers). Main thread only uploads to GPU.
- **Greedy meshing** per face direction, merging faces with the same block id *and* same light/AO so lighting stays correct (falls back to smaller quads where light varies).
- Single shared vertex-colored material (`MeshLambertMaterial` / custom shader for light levels + day/night factor). Transparent blocks (water, ice, glass) in a second pass.
- Remesh priority queue: edited chunks first, nearest-first for new chunks.

### Collision
- Player/enemies are AABBs. Move per axis (Y, then X, then Z), clamp against solid voxels overlapping the swept box. Report contacts (ground, wall normal, ceiling) for movement logic.
- Auto step-up for 1/2 blocks (slabs, later) optional; full blocks require jump (keeps Minecraft feel).
- Block properties feed movement: `friction` (ice), `damagePerSec` (lava, poison water), `swim`.

### Movement state machine (player)
States: `Ground`, `Air`, `Slide`, `Dash`, `Slam`. Shared velocity vector — **momentum is never reset between states**, only modified:
- Ground: accel toward wish-dir, high friction. Air: strong air accel, low drag.
- Coyote time & jump buffer via timestamps in config.
- Dash: sets velocity to `dir * DASH_SPEED` for `DASH_TIME`, gravity off, i-frames; on exit preserves a fraction of speed. 3 pips, regen per pip.
- Slide: entered from ground+crouch with speed, low friction, lowered hitbox; slide-jump adds horizontal boost.
- Slam: crouch in air → large downward velocity; on landing, store `slamBounceWindow`; jump in window → high bounce scaled by fall distance.
- Wall jump: in air, touching wall (collision contact) + jump → push off wall normal + up; counter resets on ground.
- Camera effects driven by state (FOV kick, roll tilt), all amplitudes in config.

### Combat model
- Every attack is a timeline: `windup → active → recovery`, with frame-accurate (sim tick) timing.
- **Directional input:** during windup, mouse delta accumulates; dominant axis picks `slashLeft/Right`, `overhead`, or `stab` (short movement or forward-move = stab). Direction changes the swing arc and which guards it beats.
- **Hit detection:** during active frames, sample the weapon's arc as a set of rays/capsule segments from the camera; test against entity hurtbox AABBs. Each attack instance hits each target once.
- **Parry:** block press opens `PERFECT_PARRY_WINDOW` (~150 ms, weapon-modified). Incoming hit in window → perfect parry (no dmg, hitstop, spark, +1 dash pip, heavy enemy posture dmg, riposte window opens). Holding past the window = guard: dmg reduced, player posture drained. Spamming block has a cooldown/penalty (anti-turtle).
- **Posture:** both sides. Regen is faster when *not* blocking and when health is high (Sekiro rule); player regen additionally faster when attacking (aggression rewarded). Break → stagger → deathblow prompt.
- **Telegraphs:** enemy attack defs carry `parryable: boolean`; weapon mesh emissive glows yellow/red during windup. Off-screen warning = HUD arrow at screen edge for any attack whose target is player and origin outside view frustum.
- **Blood healing:** hits/kills spawn blood particles + a "blood burst" heal volume; player heals if within `BLOOD_HEAL_RADIUS`. No passive regen.
- **Projectiles:** simple sim objects; parry during window reflects along crosshair ray, `damage *= 2`, faction flipped.

### AI & pathfinding
- Enemies are finite-state machines with shared behaviors; each enemy def picks behaviors + attack list.
- A* over voxel grid limited to a radius around the enemy (bounded node budget per tick, results cached, re-path on target move > N blocks). Moves: walk, step up 1 block (jump), drop down ≤3. Flying enemies use direct steering + raycast avoidance.
- Burrowers / Mother Burrow use block destruction instead of pathing.

### Saving
- IndexedDB stores: `meta`, `player`, `chunks` (only chunks that differ from generated — keyed by coord, RLE compressed), `entities`/`flags` (bosses killed, awakened mode, NPCs).
- World regenerates deterministically from seed; saved deltas overlay it.
- Autosave on interval and on pause/exit.

---

## 4. Phase breakdown

Each phase ends with a "what to test" checklist delivered to you.

### Phase 1 — Player controller & movement (flat voxel test area)
- Vite + TS + Three.js scaffold, fixed-timestep loop, input + pointer lock, `config.ts`.
- Simple (non-chunked-streaming) voxel test arena: flat floor + walls, pillars, ramps of stairs, high ledges, long corridors for sliding, a tower for wall jumps. Meshed with the greedy mesher (so it carries into Phase 3).
- AABB collision, full movement kit: run, jump, coyote time, jump buffer, air control, dash (3 pips, i-frames flag, any dir), slide, slide-jump, ground slam + slam bounce, wall jump (max 3), momentum chaining.
- Camera: FOV kick, slide/wall-jump tilt, head bob, landing dip.
- HUD: crosshair, stamina pips, speedometer; F3 debug overlay (state, velocity, contacts).
- **Playable:** run around the test arena chaining movement.

### Phase 2 — Melee combat on a training dummy
- Viewmodel sword with sway/bob/recoil; light/heavy attacks with combo strings; directional attacks from mouse movement in windup; feint (cancel heavy windup).
- Parry (perfect window + held guard), player posture, dash-pip refund.
- **Training dummy** that can be configured (F-keys) to: stand still, attack on a loop with parryable (yellow) or unblockable (red) swings, feint, shoot projectiles.
- Enemy posture, stagger, deathblow with camera animation, riposte crits.
- Projectile parry → reflect to crosshair.
- Hitstop, camera shake, knockback, spark/blood particles, blood healing, off-screen attack indicator.
- Weapon data for all 5 melee weapons (switch with number keys) so movesets can be tuned early.
- **Playable:** fight the dummy, parry, break posture, deathblow.

### Phase 3 — Chunked procedural world, mining, building, lighting
- Chunk streaming around player, worldgen in Web Worker, meshing in worker.
- Terrain: 2D+3D noise, caves (3D noise worms/cheese), ore veins, trees, simple ruins. Initially Verdant Surface + Hollow Caves; biome system designed for all 7.
- Voxel raycast; mine (hold, hardness × tool) and place blocks; block outline highlight.
- Voxel light: sunlight + block light (torches) with BFS propagation/removal; light baked into mesh; remesh on edits.
- Water (static, swimmable), fog, sky color.
- Dummy + movement carry over.
- **Playable:** explore a streamed world, dig caves, build, place torches.

### Phase 4 — Inventory, crafting, items, save/load
- Item registry, block drops, inventory + hotbar UI, drag & drop, stacking.
- Tools (pickaxe tiers gate ores), weapons as items, food items (basic).
- Crafting UI, Workbench and Forge stations (others defined, unlocked later).
- IndexedDB save/load: multiple save slots, world seed + modified chunks + player + inventory. Main menu (new/continue).
- **Playable:** gather → craft pickaxe → mine copper → craft copper sword; quit and reload.

### Phase 5 — Enemies & AI (Husk, Carrion Crow)
- Entity system, box-model enemies, voxel A* pathfinding, spawner (surface, darkness-based).
- **Husk:** slow, telegraphed yellow swings, occasional red overhead; teaches parry.
- **Carrion Crow:** flying, circles, spits parryable projectiles.
- Enemy drops, kill blood bursts, knockback into walls, enemy-vs-terrain collision.
- **Playable:** survive on the surface, fight with real AI.

### Phase 6 — Survival systems
- Hunger (slows stamina/dash regen), food healing over time.
- Day/night cycle (sky, sunlight level, more/stronger night spawns).
- Temperature (biome/altitude based, fires & armor warmth — full effect once cold/hot biomes exist).
- Darkness hides telegraphs.
- Death: drop coins + glowing memory orb; lost on second death. Beds set spawn.
- Armor slots (basic).
- **Playable:** full survival loop through a few day/night cycles.

### Phase 7 — Boss 1: The Threshold Warden
- Boss framework: phases, posture bar, arena lock (barrier blocks), music trigger hook, Technique Scroll drop, boss health/posture bar UI.
- Ruined-arena structure generated in Verdant Surface.
- Warden: 2 phases, slow clear telegraphs, big posture, phase-2 combos & one unblockable.
- Technique system + first scroll (e.g. Air Parry). Iron tier unlocked.
- **Playable:** find the arena, beat the Warden, learn a technique.

### Phase 8 — NPCs & housing
- Housing validation (enclosed room, light, door, chair); doors & chairs as blocks.
- Guide, Blacksmith (upgrades/repairs), Merchant, Alchemist (potions), Gravekeeper, Cartographer, Sword Saint (50 perfect parries), Wandering Duelist (random visitor + 1v1).
- Dialogue + shop UI, coin economy.
- **Playable:** build houses, attract NPCs, trade and upgrade.

### Phase 9 — Remaining biomes, enemies, bosses
Split into sub-phases, each playable:
- 9a Hollow Caves full (Burrowers, Lantern Thieves) + **Mother Burrow**
- 9b Blood Marsh (Leechers, Bog Knights, poison water) + **Twin Duelists**
- 9c Frostpeak (ice friction, Frost Wolves, Icebound Sentinels, cold) + **Frost Matriarch** → **Awakened mode** (void corruption spread, variants)
- 9d Cinder Depths (lava, Ember Hounds, Furnace Priests, heat) + **Cinder Colossus** (climbable body)
- 9e Sky Ruins (floating islands, Gargoyles, Wind Duelists) + **Hanged Choir**
- 9f The Void (low/shifting gravity, Mirror Shades, Hollow Kings) + **Ashen Sovereign**
- Remaining ore tiers, stations (Anvil, Bloodforge, Void Altar), ranged secondaries (throwing knives, crossbow, flintlock), remaining technique scrolls (dash-strike, counter-slam, grapple hook, …).

### Phase 10 — Polish
- Style meter (D→S: variety, parries, air kills, no-hit; affects loot).
- Particle and feedback pass, sound hooks wired to WebAudio placeholders.
- Menus, settings (sensitivity, FOV, render distance, keybinds, volume), pause, controls screen.
- Performance pass (mesh pooling, worker tuning, LOD fog distance).

---

## 5. Default controls (rebindable later)

| Action | Key |
|---|---|
| Move | WASD |
| Jump / wall jump | Space |
| Dash | Shift |
| Crouch / slide / slam | Ctrl or C |
| Light attack | LMB tap |
| Heavy attack | LMB hold |
| Feint (during heavy windup) | Q |
| Block / parry | RMB |
| Mine / place (build mode) | LMB / RMB when a tool/block is held |
| Hotbar | 1–9, wheel |
| Inventory | Tab / E |
| Interact / deathblow | F |
| Debug overlay | F3 |

Weapons vs. tools are distinguished by held item, so LMB/RMB mine/place when holding a pickaxe or block.

---

## 6. Open questions for you

1. **Controls:** OK with the Phase-2 proposal above (LMB light / hold heavy, RMB parry)?
2. **World height:** 256 blocks tall with Cinder Depths at the bottom and Sky Ruins floating near the top — OK? (Makes it one continuous world rather than separate dimensions; The Void would be a separate dimension reached via the Void Altar.)
3. **Tests:** I plan to add Vitest unit tests for deterministic pieces (collision, greedy mesher, lighting, parry timing, inventory). Fine?

Once you approve (with any changes), I'll start **Phase 1**.
