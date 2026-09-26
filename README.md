# BLADEFALL

First-person voxel sandbox action game (TypeScript + Three.js + Vite). See [PLAN.md](PLAN.md) for architecture and phases.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (collision, mesher, movement, loop, combat)
npm run typecheck
npm run build
```

All tunable numbers live in [`src/config.ts`](src/config.ts).

## Status

- **Phase 1 — movement:** done.
- **Phase 2 — melee combat vs. a training dummy:** directional light/heavy attacks with combos, feints, parry/guard,
  posture, stagger + deathblow, riposte, projectile parry, telegraphs, off-screen warnings, blood healing,
  hitstop/shake/particles and placeholder sounds. Five weapons (keys 1–5). Press **G** to cycle the dummy's
  mode and **H** to move it in front of you.
- **Phase 3 — procedural world:** streamed chunk columns generated in Web Workers (hills, ridged mountains,
  lakes, beaches, snow caps, caves and tunnels, coal/copper/iron veins, trees, small ruins), greedy meshing in
  workers with baked sky + torch light and ambient occlusion, mining and placing (press **B** for build mode),
  swimming. Open `#arena` in the URL for the flat test arena.
- **Phase 4 — items, crafting, saving:** mined blocks drop items; 36-slot inventory with a 9-slot hotbar (the held
  item decides whether the mouse fights, mines or places); pickaxe tiers gate ores; crafting by hand and at the
  Workbench → Forge (smelting, copper gear) → Anvil (iron gear); copper and iron versions of all five weapons;
  main menu with save slots stored in IndexedDB, autosave and save-on-pause.

- **Visual overhaul:** cozy 80s dark-fantasy pixel art. All block art is painted in code from one palette
  (`src/render/palette.ts`, `src/render/textures.ts`); the world renders at ~300 px tall and is upscaled with ink
  outlines, a cool-shadow/warm-highlight grade and palette snapping with ordered dithering
  (`src/render/pixelPipeline.ts`); dusk sky with moon, stars and clouds; fireflies. Dreamlike terrain: 3D density
  with overhangs and arches, stone spires, floating islands, four moods (glade, golden wood, mist vale, heather moor)
  with their own trees and plants, glowing caves, ruined towers, arches and standing stones.

- **Smooth vertical terrain:** natural blocks render as one faceted surface (surface nets) with world-projected
  (triplanar) textures, while built blocks stay cubes and mining/collision stay per block. The land is a patchwork
  of plateaus of very different heights (sheer mesas and canyons in some regions, stepped terraces in others) with
  columnar cliff rock, alcoves, overhangs and vines.

- **Phase 5 — enemies:** Husks (hunched ground melee: slashes, overheads, unblockable red lunges and combos) spawn
  in darkness — caves, under overhangs, unlit ground — and chase you with voxel A* pathfinding (stepping up, dropping
  down, jumping gaps). Carrion Crows spawn under open sky, circle overhead and spit parryable orbs (perfect-parry
  them back) or dive in to peck; break a crow's posture and it falls out of the sky for a deathblow. Kills drop Husk
  Bones and Crow Feathers. Press **P** to toggle wild spawning (clears current wild enemies).
- **Phase 6 — survival:** a day/night cycle (~14 min; nights pass faster) with a moving sun and moon, blue days,
  golden dusks and dark moonlit nights. At night Husks roam the open surface, more of them and "nightborn" (red
  eyes, tougher, harder hitting, double loot); at dawn Husks caught in sunlight smoulder away. Darkness hides enemy
  telegraphs (listen for the cue). Hunger drains over time and faster when you dash, swing or are cold; hungry slows
  dash recovery, starving hurts, well fed slowly heals. Hold RMB with food to eat (Duskberries from berry bushes,
  Glowcaps, crow meat; cook Roast Crow, Berry Tarts and warming Glowcap Stew at a Campfire). Temperature falls with
  altitude, at night and in water; fires, forges, torches, warm clothes and stew keep you warm; freezing hurts.
  Dying leaves your Grave Coins in a glowing memory where you fell — walk into it to take them back, but die again
  first and it's gone. Craft a Feather Bed and press **F** on it to set your respawn point and sleep through the
  night. Head/body/legs armor slots (feather, copper, iron) reduce enemy damage and add warmth. The game now
  pauses while the pause screen is up.

Controls are listed on the start screen.
Crouch is bound to **C** (and X), not Ctrl: in a browser, Ctrl+W closes the tab.
