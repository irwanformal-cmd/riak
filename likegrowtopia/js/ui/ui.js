// ============================================================================
// DOM-based UI: hotbar, inventory panel (48 slots), pause menu, toasts.
// Built once; updated only when state changes. No per-frame DOM churn.
// ============================================================================

import { itemDef } from '../data/items.js';
import { HOTBAR_SLOTS, MAIN_SLOTS } from '../inventory/inventory.js';
import { TILE_DEFS } from '../data/tiles.js';

// Pre-rendered item icon cache (avoids creating canvases per frame)
const iconCache = new Map();

function getIcon(itemId) {
  if (iconCache.has(itemId)) return iconCache.get(itemId);
  const c = paintIcon(itemId);
  iconCache.set(itemId, c);
  return c;
}

function paintIcon(itemId) {
  const def = itemDef(itemId);
  const c = document.createElement('canvas');
  c.width = 30; c.height = 30;
  const g = c.getContext('2d');
  if (def && def.tile != null) {
    const tdef = TILE_DEFS[def.tile];
    const col = tdef?.colors || {};
    g.fillStyle = col.face || def.color;
    g.fillRect(2, 2, 26, 26);
    if (col.top) { g.fillStyle = col.top; g.fillRect(2, 2, 26, 8); }
    if (col.dot) { g.fillStyle = col.dot; g.beginPath(); g.arc(15, 14, 4, 0, 7); g.fill(); }
    if (col.facet) { g.fillStyle = col.facet; g.beginPath(); g.moveTo(15, 4); g.lineTo(24, 18); g.lineTo(6, 18); g.closePath(); g.fill(); }
    if (col.petal) { g.fillStyle = col.petal; g.beginPath(); g.arc(15, 14, 6, 0, 7); g.fill(); g.fillStyle = col.core; g.beginPath(); g.arc(15, 14, 2.5, 0, 7); g.fill(); }
    if (col.stripe) { g.fillStyle = col.face; g.fillRect(10, 2, 10, 26); g.fillStyle = col.stripe; g.fillRect(14, 2, 2, 26); }
    if (col.ring) { g.strokeStyle = col.ring; g.lineWidth = 1; g.strokeRect(4, 4, 22, 22); }
    if (col.seam && col.faceDark) { g.strokeStyle = col.seam; g.lineWidth = 1; g.strokeRect(2, 2, 26, 26); g.strokeRect(2, 15, 26, 1); }
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.strokeRect(2.5, 2.5, 25, 25);
  } else {
    g.fillStyle = def ? def.color : '#888';
    g.beginPath(); g.arc(15, 15, 10, 0, Math.PI * 2); g.fill();
  }
  return c;
}

export class UI {
  constructor(inv, callbacks) {
    this.inv = inv;
    this.cb = callbacks;
    this.invOpen = false;
    this.paused = false;
    this._lastSel = -1;
    this._lastInvState = '';
    this.buildDom();
    this.refreshHotbar();
  }

  buildDom() {
    const root = document.getElementById('ui');

    // hotbar
    this.hotbarEl = el('div', 'hotbar');
    root.appendChild(this.hotbarEl);

    // inventory panel
    this.invPanel = el('div', 'inv-panel hidden');
    const invTitle = el('div', 'inv-title', 'Inventory');
    this.invGrid = el('div', 'inv-grid');
    this.invPanel.appendChild(invTitle);
    this.invPanel.appendChild(this.invGrid);
    root.appendChild(this.invPanel);

    // pause menu
    this.pauseEl = el('div', 'pause hidden');
    const card = el('div', 'pause-card');
    card.appendChild(el('h1', '', '✦ Lumen Vale'));
    card.appendChild(el('p', 'dim', 'An enchanted sandbox'));
    const bResume = btn('Resume  (Esc)', () => this.togglePause(false));
    const bSave = btn('Save World', () => this.cb.onSave());
    const bNew = btn('New World', () => {
      if (confirm('Start a new world? Current save will be replaced.')) this.cb.onNewWorld();
    });
    card.append(bResume, bSave, bNew);
    card.appendChild(el('p', 'dim small',
      'A/D move · Space jump · LMB break · RMB place\n1-8 hotbar · E inventory · Esc pause'));
    this.pauseEl.appendChild(card);
    root.appendChild(this.pauseEl);

    // toast
    this.toastEl = el('div', 'toast hidden');
    root.appendChild(this.toastEl);

    // hint
    this.hintEl = el('div', 'hint');
    root.appendChild(this.hintEl);
  }

  // Full rebuild (hotbar + inventory if open). Used after load/restore.
  refresh() {
    this.refreshHotbar();
    if (this.invOpen) this.refreshInventory();
  }

  toast(msg, ms = 1800) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  togglePause(force) {
    this.paused = force !== undefined ? force : !this.paused;
    this.pauseEl.classList.toggle('hidden', !this.paused);
    if (this.paused) this.toggleInventory(false);
    if (this.cb.onPauseChange) this.cb.onPauseChange(this.paused);
  }

  toggleInventory(force) {
    this.invOpen = force !== undefined ? force : !this.invOpen;
    this.invPanel.classList.toggle('hidden', !this.invOpen);
    if (this.invOpen) this.refreshInventory();
  }

  // --- hotbar: only rebuild when selection changes or items change ---
  refreshHotbar() {
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const s = this.inv.slot(i);
      const slot = el('div', 'slot' + (i === this.inv.selected ? ' sel' : ''));
      slot.appendChild(el('span', 'key', String(i + 1)));
      if (s) {
        const icon = getIcon(s.id).cloneNode();
        slot.appendChild(icon);
        if (s.count > 1) slot.appendChild(el('span', 'count', String(s.count)));
      }
      slot.addEventListener('click', () => { this.inv.select(i); this.refreshHotbar(); });
      this.hotbarEl.appendChild(slot);
    }
    this._lastSel = this.inv.selected;
  }

  // --- full inventory grid (8 hotbar + 40 main) ---
  refreshInventory() {
    this.invGrid.innerHTML = '';
    // hotbar section
    this.invGrid.appendChild(el('div', 'inv-section-label', 'Hotbar'));
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      this.invGrid.appendChild(this._makeSlot(i));
    }
    // main section
    this.invGrid.appendChild(el('div', 'inv-section-label', 'Main Inventory'));
    for (let i = HOTBAR_SLOTS; i < HOTBAR_SLOTS + MAIN_SLOTS; i++) {
      this.invGrid.appendChild(this._makeSlot(i));
    }
  }

  _makeSlot(i) {
    const s = this.inv.slot(i);
    const slot = el('div', 'slot' + (i < HOTBAR_SLOTS && i === this.inv.selected ? ' sel' : ''));
    slot.title = '';
    if (s) {
      const def = itemDef(s.id);
      slot.appendChild(getIcon(s.id).cloneNode());
      if (s.count > 1) slot.appendChild(el('span', 'count', String(s.count)));
      slot.title = def ? def.name : s.id;
      slot.dataset.slot = i;
    }
    // left click = swap selected into this slot
    slot.addEventListener('click', () => {
      if (i < HOTBAR_SLOTS) {
        this.inv.select(i);
      } else {
        // swap with selected hotbar slot
        this.inv.swap(this.inv.selected, i);
      }
      this.refreshHotbar();
      if (this.invOpen) this.refreshInventory();
    });
    // right click = split
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (s && s.count > 1) {
        this.inv.split(i);
        this.refreshHotbar();
        if (this.invOpen) this.refreshInventory();
      }
    });
    return slot;
  }

  // --- call from the game loop; cheap: only rebuilds when state actually changed ---
  updateHotbar() {
    let needsRefresh = false;
    if (this._lastSel !== this.inv.selected) { needsRefresh = true; }
    else {
      for (let i = 0; i < HOTBAR_SLOTS; i++) {
        const s = this.inv.slot(i);
        const el2 = this.hotbarEl.children[i];
        if (!el2) { needsRefresh = true; break; }
        const hasCount = el2.querySelector('.count');
        const expected = s ? (s.count > 1 ? String(s.count) : '') : '';
        const actual = hasCount ? hasCount.textContent : '';
        if (expected !== actual) { needsRefresh = true; break; }
      }
    }
    if (needsRefresh) this.refreshHotbar();
  }

  setHint(text) { this.hintEl.textContent = text || ''; }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(label, fn) {
  const b = el('button', 'btn', label);
  b.addEventListener('click', fn);
  return b;
}
