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

Controls are listed on the start screen.
Crouch is bound to **C** (and X), not Ctrl: in a browser, Ctrl+W closes the tab.
