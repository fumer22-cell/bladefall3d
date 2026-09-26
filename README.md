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

Controls are listed on the start screen.
Crouch is bound to **C** (and X), not Ctrl: in a browser, Ctrl+W closes the tab.
