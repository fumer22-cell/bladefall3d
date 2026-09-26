import { Game } from './core/game';

const root = document.getElementById('app')!;
const game = new Game(root);
game.start();

// Handy for poking at state from the dev console.
(window as unknown as { game: Game }).game = game;
