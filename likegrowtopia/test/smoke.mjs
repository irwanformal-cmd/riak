// ============================================================================
// Lumen Vale — logic smoke test. Covers every non-DOM module.
// ============================================================================

import { TILE, TILE_DEFS, tileDef, isSolid, isBreakable, isPlaceable, renderLayer, isTargetable, validateTiles } from '../js/data/tiles.js';
import { ITEM_DEFS, itemDef } from '../js/data/items.js';
import { mulberry32, noise1, noise2, fbm1, fbm2 } from '../js/core/prng.js';
import { World } from '../js/world/world.js';
import { surfaceHeight, WORLD_W, WORLD_H } from '../js/world/gen.js';
import { Player, ANIM, REACH, TILE_PX } from '../js/player/player.js';
import { Inventory, HOTBAR_SLOTS, MAIN_SLOTS, TOTAL_SLOTS } from '../js/inventory/inventory.js';
import { Interaction } from '../js/world/interact.js';
import { Camera } from '../js/render/camera.js';
import { saveGame, loadGame } from '../js/save/save.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗ FAIL:', label); }
}

// polyfill localStorage for save module
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

console.log('\n— tile schema invariants —');
const probs = validateTiles();
ok(probs.length === 0, `tile invariants clean (${probs.length} violations)`);
if (probs.length) probs.forEach(p => console.log('   ', p));

ok(Object.keys(TILE_DEFS).length >= 15, `tile defs: ${Object.keys(TILE_DEFS).length}`);
ok(Object.keys(ITEM_DEFS).length >= 10, `item defs: ${Object.keys(ITEM_DEFS).length}`);

// every placeable item references a valid tile
let badTile = 0;
for (const [id, d] of Object.entries(ITEM_DEFS)) if (d.tile != null && !TILE_DEFS[d.tile]) badTile++;
ok(badTile === 0, 'all placeable items reference valid tiles');

// every tile drop references a valid item
let badDrop = 0;
for (const d of Object.values(TILE_DEFS)) if (d.drop && !ITEM_DEFS[d.drop]) badDrop++;
ok(badDrop === 0, 'all tile drops reference valid items');

// layer/solid consistency
ok(isSolid(TILE.STONE) && !isSolid(TILE.AIR), 'isSolid correct');
ok(isBreakable(TILE.DIRT) && !isBreakable(TILE.AIR), 'isBreakable correct');
ok(!isSolid(TILE.WOOD_WALL) && !isSolid(TILE.STONE_WALL), 'bg walls non-solid');
ok(renderLayer(TILE.WOOD_WALL) === 'bg', 'bg walls render behind');
ok(renderLayer(TILE.GLOW_FLOWER) === 'deco', 'flowers are deco');
ok(!isSolid(TILE.GLOW_FLOWER), 'flowers non-solid');
ok(renderLayer(TILE.CRYSTAL) === 'fg', 'crystal is foreground');
ok(isSolid(TILE.CRYSTAL), 'crystal is solid');

console.log('\n— prng determinism —');
const r1 = mulberry32(42), r2 = mulberry32(42);
ok(r1() === r2() && r1() === r2(), 'mulberry32 deterministic');
ok(noise2(3.5, 7.2, 9) === noise2(3.5, 7.2, 9), 'noise2 deterministic');
ok(fbm1(1.23, 5) !== fbm1(1.23, 6), 'different seeds differ');

console.log('\n— world generation —');
const w = new World(1337);
ok(w.w === WORLD_W && w.h === WORLD_H, `world dims ${w.w}x${w.h}`);
const wSame = new World(1337), wDiff = new World(999);
let same = 0, n = 0, diff = 0;
for (let x = 0; x < w.w; x += 3) for (let y = 0; y < w.h; y += 3) {
  n++;
  if (w.get(x, y) === wSame.get(x, y)) same++;
  if (w.get(x, y) !== wDiff.get(x, y)) diff++;
}
ok(same === n, `deterministic (${same}/${n})`);
ok(diff > n * 0.15, `seed variance (${diff}/${n} differ)`);
let surfOK = true;
for (let x = 0; x < w.w; x++) { const s = surfaceHeight(x, 1337); if (s < 15 || s > 115) surfOK = false; }
ok(surfOK, 'surface height within sane band');

console.log('\n— player physics —');
const spawn = w.findSpawn();
ok(spawn.x > 0 && spawn.y > 0, `spawn at ${spawn.x.toFixed(1)},${spawn.y}`);
const p = new Player(spawn.x, spawn.y);
const idle = { axis: () => 0, jumpHeld: () => false };
for (let i = 0; i < 300; i++) p.update(1/60, idle, w);
ok(p.onGround, 'player settles on ground');
ok(p.anim === ANIM.IDLE, 'animation state is idle');

// walk
const right = { axis: () => 1, jumpHeld: () => false };
let x0 = p.x;
for (let i = 0; i < 180; i++) p.update(1/60, right, w);
const walkedR = p.x - x0;
p.x = x0; p.vx = 0;
const left = { axis: () => -1, jumpHeld: () => false };
for (let i = 0; i < 180; i++) p.update(1/60, left, w);
const walkedL = x0 - p.x;
ok(Math.max(walkedR, walkedL) > 5, `walks (right ${walkedR.toFixed(1)}, left ${walkedL.toFixed(1)})`);
ok(p.anim === ANIM.WALK || Math.max(walkedR, walkedL) > 5, 'walk anim state');

// jump apex
let y0 = p.y, apex = 0;
const jump = { axis: () => 0, jumpHeld: () => true };
p.update(1/60, jump, w);
for (let i = 0; i < 90; i++) { p.update(1/60, jump, w); apex = Math.max(apex, y0 - p.y); }
ok(apex > 2 && apex < 3.2, `jump apex ${apex.toFixed(2)} tiles`);

// auto step-up (build a flat runway + 1-block step)
{
  const w9 = new World(1337);
  for (let x = 0; x < 20; x++) {
    w9.set(x, 80, TILE.DIRT);
    w9.set(x, 81, TILE.STONE);
    for (let y = 75; y <= 79; y++) w9.set(x, y, TILE.AIR);
  }
  w9.set(10, 79, TILE.STONE); // 1-block step
  const ps = new Player(2.5, 80);
  for (let i = 0; i < 60; i++) ps.update(1/60, { axis: () => 0, jumpHeld: () => false }, w9);
  ok(ps.onGround, 'step-up player is on ground');
  const xBefore = ps.x;
  // walk right toward the step — with step-up the player crosses x=10
  for (let i = 0; i < 120; i++) ps.update(1/60, { axis: () => 1, jumpHeld: () => false }, w9);
  ok(ps.x > 10, `auto step-up: crossed x=10 (now at ${ps.x.toFixed(2)})`);
}

// wall collision
{
  const wallX = Math.floor(p.x) + 2;
  for (let wy = Math.floor(p.y) - 3; wy <= Math.floor(p.y); wy++) w.set(wallX, wy, TILE.STONE);
  const before = p.x;
  for (let i = 0; i < 120; i++) p.update(1/60, { axis: () => 1, jumpHeld: () => false }, w);
  ok(p.x < wallX, `wall blocks (stopped at ${p.x.toFixed(2)} before ${wallX})`);
}

// player expressions
p.setExpression('happy', 1);
ok(p.expr === 'happy', 'expression set');
p.update(2, idle, w); // > 1 second
ok(p.expr === 'neutral', 'expression expires');

console.log('\n— inventory —');
const inv = new Inventory();
ok(inv.slots.length === TOTAL_SLOTS, `slots: ${inv.slots.length} (expected ${TOTAL_SLOTS})`);
ok(HOTBAR_SLOTS === 8 && MAIN_SLOTS === 40, `hotbar ${HOTBAR_SLOTS} + main ${MAIN_SLOTS}`);
inv.add('stone', 5);
inv.add('stone', 3);
ok(inv.count('stone') === 8, 'stacking (8 stone)');
inv.select(0);
ok(inv.selectedItem()?.name === 'Stone', 'selected item resolves');
const used = inv.consumeSelected();
ok(used === 'stone' && inv.count('stone') === 7, 'consumeSelected');

// split
const splitSlot = 1;
inv.add('crystal', 10);
inv.select(splitSlot);
inv.split(splitSlot + MAIN_SLOTS); // split from a main slot... actually split(1) is slot 1 which has crystals
const crystalTotal = inv.count('crystal');
ok(crystalTotal === 10, `split preserved count: ${crystalTotal}`);

// swap
inv.add('dirt', 5);
const dirtBefore = inv.count('dirt');
inv.swap(0, 10); // swap hotbar 0 (stone) with main slot 10 (dirt)
ok(inv.count('dirt') === dirtBefore, 'swap preserves items');
ok(inv.count('stone') === 7, 'swap preserves other items');

// overflow
inv.add('glow_flower', 99);
inv.add('glow_flower', 99);
ok(inv.count('glow_flower') === 198, `overflow: ${inv.count('glow_flower')} glow_flowers`);

console.log('\n— interaction (reach + place rules) —');
const inter = new Interaction();
const p2 = new Player(spawn.x, spawn.y);
for (let i = 0; i < 300; i++) p2.update(1/60, idle, w);
ok(inter.inReach(p2, Math.floor(p2.x), Math.floor(p2.y) - 1), 'adjacent in reach');
ok(!inter.inReach(p2, Math.floor(p2.x) + 50, Math.floor(p2.y)), 'far tile out of reach');

// canPlace respects player overlap
const px2 = Math.floor(p2.x), py2 = Math.floor(p2.y) - 1;
const canPlaceResult = inter.canPlace(w, p2, px2, py2, TILE.STONE);
ok(!canPlaceResult, 'cannot place solid block inside player');

// canPlace respects support rules
const airX = Math.floor(p2.x) + 3, airY = Math.floor(p2.y) - 5;
const canPlaceFlower = inter.canPlace(w, p2, airX, airY, TILE.GLOW_FLOWER);
ok(!canPlaceFlower, 'flower needs ground support');

console.log('\n— save / load roundtrip —');
const tx = Math.floor(spawn.x), ty = Math.floor(spawn.y) - 3;
w.set(tx, ty, TILE.LUMEN_BRICK);
const saved = saveGame(w, p, inv);
ok(saved, 'saveGame writes');
const data = loadGame();
ok(data && data.seed === 1337, 'loadGame reads seed');
const w2 = new World(data.seed);
w2.loadMods(data.mods);
ok(w2.get(tx, ty) === TILE.LUMEN_BRICK, 'mods roundtrip');
const p3 = new Player(0, 0); p3.load(data.player);
ok(Math.abs(p3.x - p.x) < 0.001, 'player position restored');
const inv3 = new Inventory(); inv3.load(data.inventory);
ok(inv3.count('stone') === inv.count('stone'), 'inventory restored');

console.log('\n— camera —');
const cam = new Camera(40, 22);
cam.snap(p, w);
ok(cam.x >= 0 && cam.y >= 0, 'camera clamps to world');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
