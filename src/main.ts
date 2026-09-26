import { Game } from './core/game';

const root = document.getElementById('app')!;
// `#arena` opens the flat movement/combat test arena instead of the procedural world.
const game = new Game(root, location.hash === '#arena' ? 'arena' : 'world');
game.start();

// Handy for poking at state from the dev console.
(window as unknown as { game: Game }).game = game;
