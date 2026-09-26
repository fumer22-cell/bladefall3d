import { Game } from './core/game';
import { showMainMenu } from './ui/menu';

const root = document.getElementById('app')!;

async function boot(): Promise<void> {
  // `#arena` jumps straight into the flat movement/combat test arena.
  const choice = location.hash === '#arena' ? ({ type: 'arena' } as const) : await showMainMenu(root);
  const game =
    choice.type === 'arena'
      ? new Game(root, { mode: 'arena' })
      : new Game(root, { mode: 'world', save: choice.save, persist: choice.persist });
  game.start();
  // Handy for poking at state from the dev console.
  (window as unknown as { game: Game }).game = game;
}

void boot();
