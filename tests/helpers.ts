import { NO_INTENT, stepMovement, type MoveIntent } from '../src/player/movement';
import { Player } from '../src/player/player';
import { Block } from '../src/world/blocks';
import { World } from '../src/world/world';

export const DT = 1 / 60;

/** 64×64 stone floor whose top surface is at y = 4. */
export function flatWorld(): World {
  const w = new World();
  w.fill(0, 0, 0, 63, 3, 63, Block.STONE);
  return w;
}

export function playerOnGround(world: World, x = 32.5, z = 32.5): Player {
  const p = new Player();
  p.teleport(x, 4, z);
  step(p, world, {}, 2); // settle
  return p;
}

export function step(p: Player, world: World, intent: Partial<MoveIntent> = {}, n = 1): void {
  for (let i = 0; i < n; i++) stepMovement(p, { ...NO_INTENT, ...intent }, world, DT);
}
