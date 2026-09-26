# BLADEFALL

First-person voxel sandbox action game (TypeScript + Three.js + Vite). See [PLAN.md](PLAN.md) for architecture and phases.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (collision, mesher, movement, loop)
npm run typecheck
npm run build
```

All tunable numbers live in [`src/config.ts`](src/config.ts).

## Status

**Phase 1 — movement test arena.** Controls are listed on the start screen.
Crouch is bound to **C** (and X), not Ctrl: in a browser, Ctrl+W closes the tab.
