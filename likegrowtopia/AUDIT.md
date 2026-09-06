# Lumen Vale — Foundation Audit (pre-refactor)

Scope: correctness → performance → feel → world → visuals. No new gameplay systems.

## A. Critical gameplay bugs

1. **Background/foreground collision confusion (P0).** `isSolid()` reads `def.solid`,
   but the *renderer* decides draw order via `def.layer` while *physics* reads
   `def.solid`. These are two separate flags that can disagree. `WOOD_WALL`/
   `STONE_WALL` are `layer:'bg', solid:false` (correct), but nothing enforces the
   invariant "bg ⇒ non-solid" — a future tile could be bg+solid and silently break.
   Layer, solidity, breakability, placeability must be ONE explicit schema.
2. **Break progress resets on tiny cursor movement.** `breakTarget` is the exact
   "x,y" string; moving the cursor 1px to the next tile restarts the timer. Should
   tolerate small drift / re-target within the same intended block.
3. **No `breakable` flag.** `isTargetable()` infers breakability from `id!==AIR &&
   id!==WATER`. Bedrock-like or deco tiles can't be made unbreakable cleanly.
4. **Placement validity is tangled.** `interact.overlapsPlayer` + layer logic inline;
   deco tiles (flowers) can be placed overlapping solids with no support check.

## B. Tile/layer architecture problems

- Two parallel property systems: `solid` (physics) and `layer` (render). Collision is
  *inferred*, render order *is* physics-adjacent. Needs a single explicit schema:
  `{ renderLayer, solid, breakable, placeable, hardness, drops, glow }`.
- `isSolid` special-cases out-of-bounds → STONE (fine) but hides the layer model.
- Deco tiles (flower/leaves/stem) are `layer:'deco'` but drawn in the same pass as
  solids; no explicit "behind player" vs "in front" ordering for deco.

## C. Inventory limitations

- **Only 24 main + 8 hotbar, hardcoded.** Requirement: 8 hotbar + ≥40 main.
- **No move/split/swap.** Slots can't be dragged, swapped, or split.
- Hotbar and main are two separate arrays with duplicated stack logic (`tryStack`
  called twice). Should be ONE slot array; hotbar = indices 0..7.
- UI rebuilds the entire hotbar DOM on every `refresh()` (called on every block
  break/place) — full `innerHTML=''` + re-attach listeners. Per-frame-unsafe pattern.

## D. Performance bottlenecks

1. **Per-frame gradient creation.** Sky `createLinearGradient`, moon radial, and a
   radial gradient **per glowing tile per frame** (pass 3). Gradients are expensive;
   should be cached/pre-rendered to offscreen canvases.
2. **Template-string allocations in hot loops.** `hue.replace('A', ...)`,
   `rgba(...${0.35*tw})`, `hsla(${s.hue},...)` allocate strings every tile/spore/star
   every frame → GC pressure.
3. **`tileSprite(id)` called per tile** with a `Map.has`/`get` each call (cheap but
   non-zero); AO check calls `world.solid` 3× per solid tile → repeated generator
   lookups for unmodified tiles.
4. **No offscreen world buffer.** Every visible tile is re-`drawImage`'d every frame
   even when nothing changed. Fine at this size, but combined with gradient spam it's
   the main cost. A cached static-layer canvas invalidated on edits is the fix.
5. **Stars/spores recomputed and re-stringified each frame.** Should use pooled,
   pre-allocated buffers.
6. **UI `refresh()` rebuilds DOM** (see C).

## E. Player/animation problems

- Player is a **capsule/pill** (roundRect cloak + circle head). Requirement: readable
  fantasy adventurer with head/hair/body/arms/legs/face.
- **No animation state machine** — just a `walkPhase` bob. Need IDLE/WALK/JUMP/FALL/
  BREAK/HURT as a proper state machine separate from physics.
- **No expression system** — static glowing eyes.
- Physics itself (step-up, coyote, buffer, variable jump) is already correct — keep it.

## F. World-generation problems

- **Terrain shape is a single fbm band** → uniform rolling hills, no valleys/plateaus/
  mesas. Needs multi-scale composition (continental + hills + detail + ridge).
- **Trees/mushrooms are stamped templates** (fixed canopy blob, fixed cap disk) →
  cloned look. Need parameterized variants (height, thickness, canopy radius/shape,
  cap curvature) with per-instance seeded jitter.
- **Feature placement uses a per-column scan of ±4 neighbours** (`featureTile`) which
  is O(9) generator calls per air tile — works but is the hot path for worldgen and
  any on-the-fly `get()`. Should precompute feature occupancy per world into a cache.
- Vegetation variety is low (grass blades, one flower, one mushroom).

## G. Rendering/visual problems

- Sky is a flat 3-stop gradient + dots. No clouds, haze, distant silhouettes, or
  layered parallax.
- Lighting = additive radial blob per glow tile (expensive + washes out). No integrated
  light map / ambience.
- Tile art is flat fills + speckles; materials lack identity (stone/dirt similar).
- No day/night or atmosphere states; single static night.
- No depth cues (haze, parallax far layer, cave darkness gradient).

## Architectural causes (summary)

- **Split brain between physics & render flags** → the layer bug.
- **Two-array inventory + DOM-rebuild UI** → inventory limits + perf.
- **Immediate-mode rendering with per-frame gradient/string churn** → perf.
- **Template-stamped worldgen + on-demand feature scan** → world quality + some perf.

## Refactor plan (priority order)

P0: unified tile schema + layer/solid/breakable; fix break-drift; explicit placement rules.
P1: single-array inventory (8 hotbar + 40 main), move/swap/split, efficient slot UI.
P2: cached gradients & sprites, pooled particles, offscreen static world layer, culling.
P3: character sprite, animation state machine, expressions, break feedback + debris.
P4: terrain multi-scale, tree/mushroom variants, vegetation, sky layers, atmosphere states, depth.
