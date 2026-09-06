// Smooth-follow camera in tile space.

export class Camera {
  constructor(viewW, viewH) {
    this.x = 0; this.y = 0;      // top-left, tile units
    this.viewW = viewW;          // in tiles
    this.viewH = viewH;
  }

  follow(target, world, dt) {
    const tx = target.x - this.viewW / 2;
    const ty = target.y - target.h / 2 - this.viewH / 2;
    const k = 1 - Math.pow(0.001, dt); // framerate-independent smoothing
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.x = Math.max(0, Math.min(world.w - this.viewW, this.x));
    this.y = Math.max(0, Math.min(world.h - this.viewH, this.y));
  }

  snap(target, world) {
    this.x = target.x - this.viewW / 2;
    this.y = target.y - target.h / 2 - this.viewH / 2;
    this.x = Math.max(0, Math.min(world.w - this.viewW, this.x));
    this.y = Math.max(0, Math.min(world.h - this.viewH, this.y));
  }
}
