// ============================================================================
// Player: movement, AABB collision, animation state machine.
// Logic is render-free so a future server can run the same simulation.
// Units are in TILES; the renderer scales to pixels.
//
// Feel features (sandbox-game conventions, not realism):
//   - auto step-up: walking into a 1-tile ledge climbs it
//   - coyote time / jump buffer / variable jump height
// ============================================================================

export const TILE_PX = 32;

const W = 0.7;
const H = 1.7;
const MOVE = 6.5;
const ACCEL = 40;
const FRICTION = 30;
const GRAVITY = 28;
const JUMP_VEL = 11.5;
const JUMP_CUT = 4;
const COYOTE = 0.1;
const BUFFER = 0.12;
const MAX_FALL = 22;
export const REACH = 5;

// Animation states
export const ANIM = {
  IDLE: 'idle',
  WALK: 'walk',
  JUMP: 'jump',
  FALL: 'fall',
  BREAK: 'break',
};

export class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.w = W; this.h = H;
    this.onGround = false;
    this.facing = 1;
    this.health = 20; this.maxHealth = 20;
    this.walkPhase = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this._jumpHeld = false;
    // animation
    this.anim = ANIM.IDLE;
    this.animTime = 0;
    this.expr = 'neutral'; // neutral | happy | hurt | surprised | sleepy
    this.exprTimer = 0;
    this._breaking = false;
    this.breakPhase = 0;
    this.idleTime = 0;
  }

  aabb() {
    return { x: this.x - this.w / 2, y: this.y - this.h, w: this.w, h: this.h };
  }

  collides(world, px, py) {
    const x0 = Math.floor(px - this.w / 2);
    const x1 = Math.floor(px + this.w / 2 - 1e-4);
    const y0 = Math.floor(py - this.h);
    const y1 = Math.floor(py - 1e-4);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (world.solid(tx, ty)) return true;
    return false;
  }

  setBreaking(b) {
    this._breaking = b;
    if (b) this.breakPhase += 0.05; // accumulates per frame when breaking
  }

  setExpression(expr, duration = 2) {
    this.expr = expr;
    this.exprTimer = duration;
  }

  update(dt, input, world) {
    // --- horizontal
    const ax = input.axis();
    if (ax !== 0) {
      this.vx += ax * ACCEL * dt;
      this.vx = Math.max(-MOVE, Math.min(MOVE, this.vx));
      this.facing = ax;
      this.walkPhase += Math.abs(this.vx) * dt * 2.2;
    } else {
      const s = Math.sign(this.vx);
      this.vx -= s * FRICTION * dt;
      if (Math.sign(this.vx) !== s) this.vx = 0;
    }

    // --- jumping
    const jumpNow = input.jumpHeld();
    if (jumpNow && !this._jumpHeld) this.jumpBuffer = BUFFER;
    this._jumpHeld = jumpNow;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    this.coyote = this.onGround ? COYOTE : Math.max(0, this.coyote - dt);

    if (this.jumpBuffer > 0 && (this.onGround || this.coyote > 0)) {
      this.vy = -JUMP_VEL;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.onGround = false;
    }
    if (!jumpNow && this.vy < -JUMP_CUT) this.vy = -JUMP_CUT;

    // --- gravity
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;

    // --- integrate
    this.moveAxis(world, this.vx * dt, 0);
    this.onGround = false;
    this.moveAxis(world, 0, this.vy * dt);

    // --- animation state
    this.animTime += dt;
    this.exprTimer -= dt;
    if (this.exprTimer <= 0) this.expr = 'neutral';

    if (this._breaking && Math.abs(this.vx) < 0.1) {
      this.anim = ANIM.BREAK;
      this.breakPhase += dt * 4;
    } else if (!this.onGround) {
      this.anim = this.vy < 0 ? ANIM.JUMP : ANIM.FALL;
      this.idleTime = 0;
    } else if (Math.abs(this.vx) > 0.5) {
      this.anim = ANIM.WALK;
      this.idleTime = 0;
    } else {
      this.anim = ANIM.IDLE;
      this.idleTime += dt;
      if (this.idleTime > 5) this.expr = 'sleepy';
    }
    this._breaking = false;
  }

  moveAxis(world, dx, dy) {
    if (dx !== 0) {
      this.x += dx;
      if (this.collides(world, this.x, this.y)) {
        if (this.onGround && !this.collides(world, this.x, this.y - 1)) {
          this.y -= 1;
        } else {
          this.x -= dx;
          this.vx = 0;
        }
      }
    }
    if (dy !== 0) {
      this.y += dy;
      if (this.collides(world, this.x, this.y)) {
        if (dy > 0) {
          this.y = Math.floor(this.y) - 1e-4;
          this.onGround = true;
        } else {
          this.y = Math.floor(this.y - this.h) + 1 + this.h + 1e-4;
        }
        this.vy = 0;
      }
    }
  }

  serialize() {
    return { x: this.x, y: this.y, health: this.health };
  }
  load(d) {
    if (!d) return;
    this.x = d.x; this.y = d.y;
    this.health = d.health ?? this.maxHealth;
  }
}
