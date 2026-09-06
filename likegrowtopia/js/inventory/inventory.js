// ============================================================================
// Inventory — single-slot-array design. Hotbar = first 8 slots (indices 0–7).
// Main inventory = slots 8–47. One unified stack/split/swap system.
// ============================================================================

import { itemDef } from '../data/items.js';

export const HOTBAR_SLOTS = 8;
export const MAIN_SLOTS = 40;
export const TOTAL_SLOTS = HOTBAR_SLOTS + MAIN_SLOTS; // 48

export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.selected = 0; // hotbar index 0–7
  }

  // --- slot access ---
  slot(i) { return this.slots[i]; }

  selectedStack() { return this.slots[this.selected]; }
  selectedItem() {
    const s = this.selectedStack();
    return s ? itemDef(s.id) : null;
  }

  // --- add items (auto-stacks first, then first empty) ---
  add(id, count = 1) {
    const def = itemDef(id);
    if (!def) return 0;
    let remaining = count;

    // first pass: stack into existing
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < def.stack) {
        const move = Math.min(def.stack - s.count, remaining);
        s.count += move; remaining -= move;
      }
    }
    // second pass: fill empty slots
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      if (!this.slots[i]) {
        const move = Math.min(def.stack, remaining);
        this.slots[i] = { id, count: move };
        remaining -= move;
      }
    }
    return count - remaining;
  }

  // --- remove from anywhere ---
  remove(id, count = 1) {
    let need = count;
    for (let i = 0; i < TOTAL_SLOTS && need > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, need);
        s.count -= take; need -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - need;
  }

  // --- consume one from selected hotbar slot ---
  consumeSelected() {
    const s = this.slots[this.selected];
    if (!s) return null;
    const id = s.id;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    return id;
  }

  // --- count total of an item across all slots ---
  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // --- hotbar selection ---
  select(i) { if (i >= 0 && i < HOTBAR_SLOTS) this.selected = i; }

  // --- swap two slots ---
  swap(a, b) {
    if (a < 0 || a >= TOTAL_SLOTS || b < 0 || b >= TOTAL_SLOTS || a === b) return;
    const sa = this.slots[a], sb = this.slots[b];
    // if same item, try to merge
    if (sa && sb && sa.id === sb.id) {
      const def = itemDef(sa.id);
      const max = def ? def.stack : 99;
      const space = max - sb.count;
      if (space > 0) {
        const move = Math.min(sa.count, space);
        sb.count += move; sa.count -= move;
        if (sa.count <= 0) this.slots[a] = null;
        return;
      }
    }
    // otherwise just swap
    this.slots[a] = sb; this.slots[b] = sa;
  }

  // --- split half from slot a into slot b (or first empty) ---
  split(a) {
    const sa = this.slots[a];
    if (!sa || sa.count <= 1) return false;
    const half = Math.floor(sa.count / 2);
    // find target: first empty slot
    let target = -1;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (!this.slots[i]) { target = i; break; }
    }
    if (target === -1) return false;
    this.slots[target] = { id: sa.id, count: half };
    sa.count -= half;
    return true;
  }

  // --- serialize / load ---
  serialize() {
    return {
      slots: this.slots.map(s => s ? [s.id, s.count] : null),
      selected: this.selected,
    };
  }
  load(data) {
    if (!data) return;
    if (data.slots) {
      for (let i = 0; i < TOTAL_SLOTS; i++) {
        const e = data.slots[i];
        this.slots[i] = e ? { id: e[0], count: e[1] } : null;
      }
    }
    this.selected = data.selected || 0;
  }
}
