// Headless check that the UI module builds a hotbar/inventory without errors.
const noop = () => {};
function makeEl(tag) {
  const listeners = {};
  return {
    tagName: tag, children: [], style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach(c => this.children.push(c)); },
    cloneNode() { return makeEl(this.tagName); },
    addEventListener(t, f) { listeners[t] = f; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text; },
    querySelector() { return null; },
  };
}
function makeCtx() {
  return {
    fillStyle:'', fillRect:noop, beginPath:noop, arc:noop, fill:noop, strokeRect:noop,
    moveTo:noop, lineTo:noop, closePath:noop, stroke:noop,
    createRadialGradient: () => ({addColorStop:noop}),
  };
}
globalThis.document = {
  createElement: (tag) => tag === 'canvas'
    ? { width:0, height:0, className:'', getContext: makeCtx, cloneNode: () => ({ width:0, height:0, className:'', getContext: makeCtx }) }
    : makeEl(tag),
  getElementById: () => makeEl('div'),
};

const { UI } = await import('../js/ui/ui.js');
const { Inventory } = await import('../js/inventory/inventory.js');

const inv = new Inventory();
inv.add('stone', 5);
inv.add('crystal', 3);
inv.select(1);

const callbacks = { onSave: noop, onNewWorld: noop, onPauseChange: noop };
try {
  const ui = new UI(inv, callbacks);
  ui.refresh();
  ui.toggleInventory(true);
  ui.updateHotbar();
  ui.toast('test');
  console.log('ui check: OK');
} catch (e) {
  console.error('UI FAIL:', e.message);
  process.exit(1);
}
