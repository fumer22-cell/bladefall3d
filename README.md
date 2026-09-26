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
  swimming. Edits persist while you play (saving to disk arrives in Phase 4). Open `#arena` in the URL for the
  flat test arena.

Controls are listed on the start screen.
Crouch is bound to **C** (and X), not Ctrl: in a browser, Ctrl+W closes the tab.
