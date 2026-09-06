// Keyboard + mouse state. Other systems read this; they never bind listeners.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false };
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      // Don't swallow devtools / reload combos
      if (e.metaKey || e.ctrlKey) return;
      this.keys.add(e.code);
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  releaseMouse() {
    this.mouse.left = false;
    this.mouse.right = false;
  }

  down(code) { return this.keys.has(code); }
  axis() {
    let a = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) a -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) a += 1;
    return a;
  }
  jumpHeld() { return this.down('Space') || this.down('KeyW') || this.down('ArrowUp'); }
}
