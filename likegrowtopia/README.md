# ✦ Lumen Vale

An original 2D fantasy sandbox — explore, gather, build, and shape your own
enchanted bioluminescent world.

> **Status:** Foundation pass complete (Milestone 1 — production-quality
> single-player prototype). This is an original work — not a clone.

## Run it

No build step, no dependencies. Serve the folder over HTTP:

```bash
cd likegrowtopia
python3 -m http.server 8004     # or: npm start
# then open http://localhost:8004
```

(Any static server works. `file://` will NOT work — the game uses ES modules.)

## Controls

| Input | Action |
|-------|--------|
| `A` / `D` or `←` / `→` | Move |
| `Space` / `W` / `↑` | Jump (coyote time + jump buffer) |
| Left mouse (hold) | Break block |
| Right mouse | Place selected block |
| `1`–`8` | Select hotbar slot |
| `E` | Inventory (drag/swap, right-click split) |
| `Esc` | Pause / menu |

World autosaves every 12s after a change, and on tab-close. Reopen to restore.

## Tests

```bash
npm test
```

Three headless suites — **no browser needed**:
- `test/smoke.mjs` — 50 logic checks (tile schema, physics, inventory, save/load)
- `test/render_check.mjs` — renderer + sprite execution (DOM-stubbed canvas)
- `test/ui_check.mjs` — inventory UI building

## Architecture

Data-driven, modular, render-free logic so a future server can run the same sim.

```
js/
  main.js             bootstrap + fixed-timestep loop
  core/prng.js        seeded PRNG + value/fbm noise
  data/tiles.js       tile "database" — ONE explicit schema per tile
  data/items.js       item "database"
  world/gen.js        deterministic procedural generation (multi-scale terrain)
  world/world.js      tile store + delta journal (only edits persisted)
  world/interact.js   break/place (explicit rules, drift-tolerant breaking)
  player/player.js    movement, AABB collision, animation state machine
  player/input.js     keyboard/mouse
  inventory/inventory.js  single-array: 8 hotbar + 40 main (48 slots)
  render/camera.js    smooth-follow camera
  render/sprites.js   procedural tile sprites (variants, cached)
  render/world.js     renderer: sky, parallax, static-layer caching, glow, particles
  save/save.js        localStorage (seed + edit delta + player + inventory)
  ui/ui.js            DOM UI (efficient, rebuilt only on state change)
test/                 headless test suites
```

### Tile schema (single source of truth)

Each tile declares: `renderLayer`, `solid`, `breakable`, `placeable`, `hard`,
`drop`, `glow`, `support`. Physics and rendering never infer from each other.
Invariants are checked at boot + in tests:
- background/deco/liquid ⇒ never solid
- solid ⇒ always foreground

### Rendering strategy (performance)

- **Static layer canvas** — terrain baked offscreen, rebuilt only on edits or
  camera-region changes, not per frame
- Cached gradients (sky, moon, vignette) — no per-frame allocation
- **Pooled, bounded particles** (debris, spores) — no GC churn
- Camera culling — only visible tiles processed
- UI rebuilt only on state change, not per frame in the hot loop

## Roadmap (next milestones)

1. ✅ Foundation (playable, performant, polished)
2. Farming  · 3. Crafting  · 4. Creatures/combat  · 5. Multiplayer split
