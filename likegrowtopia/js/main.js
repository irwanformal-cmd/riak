// ============================================================================
// Lumen Vale — entry point. Wires world, player, renderer, input, UI, save.
// A fixed-timestep loop keeps physics stable regardless of frame rate.
// ============================================================================

import { World } from './world/world.js';
import { Player, TILE_PX } from './player/player.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/world.js';
import { Input } from './player/input.js';
import { Interaction } from './world/interact.js';
import { Inventory } from './inventory/inventory.js';
import { UI } from './ui/ui.js';
import { saveGame, loadGame, hasSave, clearSave } from './save/save.js';
import { validateTiles } from './data/tiles.js';

// --- boot-time sanity check
const tileProblems = validateTiles();
if (tileProblems.length) {
  console.warn('Tile invariant violations:\n' + tileProblems.join('\n'));
}

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const interact = new Interaction();

// collect break/place events for particles + animation
interact.onEvent = (type, tx, ty, tileId) => {
  renderer.addBreakEvent(type, tx, ty, tileId);
};

let world, player, inv, cam, ui;
let autosaveTimer = 0;
let dirty = false;
let currentBreaking = false;

function viewTiles() {
  return {
    w: canvas.clientWidth / TILE_PX,
    h: canvas.clientHeight / TILE_PX,
  };
}

function boot(seed) {
  world = new World(seed);
  const spawn = world.findSpawn();
  player = new Player(spawn.x, spawn.y);
  inv = new Inventory();
  const v = viewTiles();
  cam = new Camera(v.w, v.h);
  cam.snap(player, world);

  ui = new UI(inv, {
    onSave: () => {
      if (saveGame(world, player, inv)) { ui.toast('World saved ✦'); dirty = false; }
      else ui.toast('Save failed');
    },
    onNewWorld: () => {
      clearSave();
      boot((Math.random() * 0xffffffff) >>> 0);
      ui.toast('A new realm forms…');
    },
    onPause: () => {},
    onPauseChange: () => { input.releaseMouse(); interact.reset(); },
  });

  // starter kit
  inv.add('enchanted_wood', 20);
  inv.add('stone', 20);
  inv.add('glow_flower', 5);
  inv.add('lumen_brick', 10);
  inv.add('glass', 10);
  inv.select(0);
  ui.refresh();
}

function restoreOrBoot() {
  const save = hasSave() ? loadGame() : null;
  if (save) {
    boot(save.seed >>> 0);
    world.loadMods(save.mods);
    player.load(save.player);
    inv.load(save.inventory);
    ui.refresh();
    const v = viewTiles(); cam.viewW = v.w; cam.viewH = v.h;
    cam.snap(player, world);
    ui.toast('Welcome back to your vale ✦');
  } else {
    boot(1337);
  }
}

// --- keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) return;
  if (e.code === 'Escape') { ui.togglePause(); }
  else if (e.code === 'KeyE') { if (!ui.paused) ui.toggleInventory(); }
  else if (/^Digit[1-8]$/.test(e.code)) {
    inv.select(parseInt(e.code.slice(5), 10) - 1);
    ui.refresh();
  }
});

window.addEventListener('resize', () => {
  renderer.resize();
  const v = viewTiles(); cam.viewW = v.w; cam.viewH = v.h;
  renderer.invalidateStatic();
});

// Save on exit / tab switch
function persist() {
  if (dirty) { saveGame(world, player, inv); dirty = false; }
}
window.addEventListener('beforeunload', persist);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
});

// --- main loop (fixed timestep for physics, variable render)
let last = performance.now();
let acc = 0;
const STEP = 1 / 120;
const MAX_STEPS = 4; // max physics steps per frame to avoid spiral

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;

  if (!ui.paused) {
    let steps = 0;
    acc += dt;
    while (acc >= STEP && steps < MAX_STEPS) {
      player.update(STEP, input, world);
      acc -= STEP;
      steps++;
    }
    if (steps >= MAX_STEPS) acc = 0; // avoid spiral death

    cam.follow(player, world, dt);

    const result = interact.update(dt, input, cam, world, player, inv, () => {
      dirty = true;
      ui.refresh();
      renderer.invalidateStatic();
    });

    currentBreaking = result.breaking;
    player.setBreaking(currentBreaking);

    renderer.render(dt, world, player, cam, result.hover);
    ui.updateHotbar();
    ui.setHint(inv.selectedItem() ? inv.selectedItem().name : '');

    // autosave every 12s if something changed
    autosaveTimer += dt;
    if (dirty && autosaveTimer > 12) {
      autosaveTimer = 0;
      if (saveGame(world, player, inv)) { dirty = false; ui.toast('Autosaved'); }
    }
  } else {
    renderer.render(dt, world, player, cam, null);
  }

  requestAnimationFrame(frame);
}

renderer.resize();
restoreOrBoot();
requestAnimationFrame(frame);
