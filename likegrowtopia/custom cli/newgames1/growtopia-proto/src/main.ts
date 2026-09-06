import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE } from './systems/World';

console.log('[MAIN] Starting game initialization...');
console.log('[MAIN] Phaser version:', Phaser.VERSION);

// Check if #game element exists
const gameEl = document.getElementById('game');
console.log('[MAIN] #game element:', gameEl, gameEl ? 'FOUND' : 'NOT FOUND');

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#1a1a2e',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 1200 },
      debug: false,
    },
  },
  scene: [GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    pixelArt: true,
    antialias: false,
  },
};

const sceneArr = config.scene as any[];
console.log('[MAIN] Creating Phaser.Game with config:', {
  type: config.type,
  parent: config.parent,
  width: config.width,
  height: config.height,
  sceneCount: sceneArr.length,
});

const game = new Phaser.Game(config);

console.log('[MAIN] Phaser.Game created:', !!game);
console.log('[MAIN] Game canvas:', game.canvas);
console.log('[MAIN] Game renderer:', game.renderer?.type);

// Check canvas in DOM after creation
setTimeout(() => {
  const canvas = document.querySelector('#game canvas') as HTMLCanvasElement | null;
  console.log('[MAIN] Canvas in DOM after init:', canvas);
  if (canvas) {
    console.log('[MAIN] Canvas size:', canvas.width, 'x', canvas.height);
    console.log('[MAIN] Canvas style:', canvas.style.cssText);
  }
}, 100);

// Handle resize
window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

// Global debug
(window as any).game = game;

console.log('[MAIN] Initialization complete');