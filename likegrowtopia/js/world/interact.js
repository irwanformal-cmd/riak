// ============================================================================
// Block interaction: break (hold left) with hardness progress, place (right).
// Uses the explicit tile schema — breakability/placeability/solidity are read
// from tile defs, never inferred from render order or position.
//
// Events are surfaced via a listener so the renderer can spawn debris and the
// player can play a break animation WITHOUT this module touching rendering.
// ============================================================================

import { TILE, tileDef, isBreakable, isSolid } from '../data/tiles.js';
import { TILE_PX, REACH } from '../player/player.js';
import { itemDef } from '../data/items.js';

// Allow the cursor to drift onto a neighbouring tile briefly without losing
// break progress, as long as it's the same target block region.
const DRIFT_GRACE = 0.08; // seconds

export class Interaction {
  constructor() {
    this.breakTarget = null;   // "x,y" currently being chipped
    this.breakTime = 0;
    this.lastKey = null;       // last tile under cursor
    this.drift = 0;            // time spent off the break target
    this.placeCooldown = 0;
    this.onEvent = null;       // (type, tx, ty, tileId) => {}
  }

  reset() {
    this.breakTarget = null;
    this.breakTime = 0;
    this.lastKey = null;
    this.drift = 0;
    this.placeCooldown = 0;
  }

  mouseTile(input, cam) {
    const wx = input.mouse.x / TILE_PX + cam.x;
    const wy = input.mouse.y / TILE_PX + cam.y;
    return { tx: Math.floor(wx), ty: Math.floor(wy) };
  }

  inReach(player, tx, ty) {
    const dx = tx + 0.5 - player.x;
    const dy = ty + 0.5 - (player.y - player.h / 2);
    return dx * dx + dy * dy <= REACH * REACH;
  }

  // Can `tileId` be placed at (tx,ty) given world + player? Explicit rules.
  canPlace(world, player, tx, ty, tileId) {
    const def = tileDef(tileId);
    if (!def.placeable) return false;
    if (!world.inBounds(tx, ty)) return false;

    const existing = world.get(tx, ty);
    const exDef = tileDef(existing);

    if (def.renderLayer === 'bg') {
      // background wall: only where there's no bg wall already, and not into a
      // solid foreground block
      if (exDef.renderLayer === 'bg') return false;
      if (exDef.solid) return false;
    } else {
      // fg / deco / liquid occupy the cell — must be empty (air or walk-through)
      if (existing !== TILE.AIR && exDef.solid) return false;
      if (exDef.renderLayer === 'deco' && existing !== TILE.AIR) return false;
    }

    // support rule
    if (def.support === 'ground' && !isSolid(world.get(tx, ty + 1))) return false;

    // never inside the player's collision volume when solid
    if (def.solid && this.overlapsPlayer(player, tx, ty)) return false;

    return true;
  }

  update(dt, input, cam, world, player, inv, onChange) {
    this.placeCooldown -= dt;
    const { tx, ty } = this.mouseTile(input, cam);
    const key = tx + ',' + ty;
    let hover = null;
    let breaking = false;

    // --- BREAK (hold left)
    if (input.mouse.left && this.inReach(player, tx, ty)) {
      const id = world.get(tx, ty);
      if (isBreakable(id)) {
        const def = tileDef(id);

        if (this.breakTarget === key) {
          this.drift = 0; // still on target
        } else if (this.breakTarget && this.lastKey === this.breakTarget) {
          // cursor just drifted off the target — allow a short grace period
          this.drift += dt;
          if (this.drift > DRIFT_GRACE) { this.breakTarget = key; this.breakTime = 0; this.drift = 0; }
        } else {
          this.breakTarget = key; this.breakTime = 0; this.drift = 0;
        }

        if (this.breakTarget === key) {
          this.breakTime += dt;
          breaking = true;
          const need = Math.max(def.hard, 0.05);
          hover = { tx, ty, valid: true, mode: 'break', progress: Math.min(1, this.breakTime / need), tile: id };
          if (this.breakTime >= need) {
            world.set(tx, ty, TILE.AIR);
            if (def.drop) inv.add(def.drop, 1);
            this.emit('break', tx, ty, id);
            this.breakTarget = null; this.breakTime = 0; this.drift = 0;
            onChange && onChange();
          }
        }
      } else {
        this.breakTarget = null; this.breakTime = 0; this.drift = 0;
      }
    } else {
      this.breakTarget = null; this.breakTime = 0; this.drift = 0;
    }
    this.lastKey = key;

    // --- PLACE (right click)
    if (input.mouse.right && this.placeCooldown <= 0 && this.inReach(player, tx, ty)) {
      const stack = inv.selectedStack();
      if (stack) {
        const idef = itemDef(stack.id);
        if (idef && idef.kind === 'block' && idef.tile != null) {
          if (this.canPlace(world, player, tx, ty, idef.tile)) {
            world.set(tx, ty, idef.tile);
            inv.consumeSelected();
            this.placeCooldown = 0.18;
            this.emit('place', tx, ty, idef.tile);
            hover = { tx, ty, valid: true, mode: 'place', progress: 0, tile: idef.tile };
            onChange && onChange();
          }
        }
      }
    }

    // passive hover for cursor feedback (target the actual block under cursor)
    if (!hover && this.inReach(player, tx, ty) && isBreakable(world.get(tx, ty))) {
      hover = { tx, ty, valid: true, mode: 'break', progress: 0, tile: world.get(tx, ty) };
    }

    return { hover, breaking };
  }

  overlapsPlayer(player, tx, ty) {
    const b = player.aabb();
    return tx < b.x + b.w && tx + 1 > b.x && ty < b.y + b.h && ty + 1 > b.y;
  }

  emit(type, tx, ty, tileId) {
    if (this.onEvent) this.onEvent(type, tx, ty, tileId);
  }
}
