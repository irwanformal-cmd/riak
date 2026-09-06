// Headless check of the render-only modules using a minimal DOM/canvas stub.
// Catches reference errors / wrong API usage in code that node can't run
// because it touches document/canvas. Not a pixel test.

function makeCanvas() {
  return {
    width: 640, height: 360, clientWidth: 640, clientHeight: 360,
    getContext: () => makeCtx(),
  };
}
function makeCtx() {
  const noop = () => {};
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillRect: noop, strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, arc: noop, ellipse: noop, arcTo: noop, quadraticCurveTo: noop,
    scale: noop, translate: noop, rotate: noop, save: noop, rest: (()=>{}), restore: noop,
    drawImage: noop, setTransform: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 0 }),
  };
  ctx.rest = ctx.restore;
  return ctx;
}
globalThis.document = {
  createElement: (tag) => tag === 'canvas' ? makeCanvas() : { style: {}, appendChild: () => {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: () => {}, append: () => {} },
  getElementById: () => makeCanvas(),
};
globalThis.devicePixelRatio = 1;

const { Renderer } = await import('../js/render/world.js');
const { World } = await import('../js/world/world.js');
const { Player } = await import('../js/player/player.js');
const { Camera } = await import('../js/render/camera.js');

const w = new World(1337);
const spawn = w.findSpawn();
const p = new Player(spawn.x, spawn.y);
const cam = new Camera(40, 22);
cam.snap(p, w);

// stub input for physics settle
const idle = { axis: () => 0, jumpHeld: () => false };
for (let i = 0; i < 120; i++) p.update(1/60, idle, w);

const renderer = new Renderer(makeCanvas());
renderer.resize();

try {
  renderer.render(1/60, w, p, cam, null);
  renderer.addBreakEvent('break', 10, 10, 5);
  renderer.render(1/60, w, p, cam, null);
  // different hover/progress
  renderer.render(1/60, w, p, cam, { tx: 5, ty: 5, valid: true, mode: 'break', progress: 0.5, tile: 3 });
  renderer.render(1/60, w, p, cam, { tx: 5, ty: 6, valid: true, mode: 'place', progress: 0, tile: 7 });
  // trigger animation states
  p.setBreaking(true);
  renderer.render(1/60, w, p, cam, null);
  console.log('renderer smoke: OK (no exceptions)');
} catch (e) {
  console.error('RENDERER FAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// also exercise sprite painting
const { tileSprite } = await import('../js/render/sprites.js');
const { TILE } = await import('../js/data/tiles.js');
try {
  for (const id of Object.values(TILE)) {
    const img = tileSprite(id, 3, 4);
    if (!img) throw new Error('tileSprite returned null for ' + id);
  }
  console.log('sprites: OK (' + Object.keys(TILE).length + ' tile types painted)');
} catch (e) {
  console.error('SPRITE FAIL:', e.message);
  process.exit(1);
}

console.log('render check passed');
