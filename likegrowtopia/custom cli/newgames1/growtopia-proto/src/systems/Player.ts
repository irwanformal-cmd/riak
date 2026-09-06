import { World, TILE_SIZE } from './World';
import { Inventory } from './Inventory';
import { ITEMS, getItem } from '../data/items';

export class Player {
  public sprite: Phaser.Physics.Arcade.Sprite;
  public world: World;
  public inventory: Inventory;
  private scene: Phaser.Scene;

  private speed = 200;
  private jumpPower = -500;
  private facing: 'left' | 'right' = 'right';

  // Animation state
  private animState: 'idle' | 'walk' | 'jump' | 'fall' = 'idle';
  private animTimer = 0;

  // Break/place
  private breakCooldown = 0;
  private placeCooldown = 0;
  private breakSpeed = 180; // ms per block (fist)
  private placeSpeed = 120;
  private isBreaking = false;
  private breakTarget: { x: number; y: number } | null = null;
  private breakProgress = 0;
  private breakTotalTime = 0;

  // Punch visual
  private punchCooldown = 0;
  private punchDirection: 'left' | 'right' = 'right';

  constructor(scene: Phaser.Scene, world: World, inventory: Inventory) {
    this.scene = scene;
    this.world = world;
    this.inventory = inventory;

    const spawn = world.getSpawnPosition();
    console.log('[Player] Spawn position:', spawn);
    
    // Create player with proper sprite
    const sprite = scene.physics.add.sprite(spawn.x, spawn.y, 'player');
    if (!sprite) throw new Error('[Player] Failed to create sprite');
    this.sprite = sprite;
    
    this.sprite.setCollideWorldBounds(true);
    // Hitbox: 12x28 centered on 16x32 sprite
    (this.sprite.body as Phaser.Physics.Arcade.Body).setSize(12, 28).setOffset(2, 2);
    this.sprite.setDepth(10);
    console.log('[Player] Constructor done, sprite pos:', this.sprite.x, this.sprite.y);

    // Generate animation frames
    this.generateAnimFrames(scene);
  }

  private generateAnimFrames(scene: Phaser.Scene): void {
    // Create animation frames programmatically
    // Idle: 2 frames (breathing)
    const idleFrames: Phaser.Textures.CanvasTexture[] = [];
    for (let f = 0; f < 2; f++) {
      const tex = scene.textures.createCanvas(`player_idle_${f}`, 16, 32);
      if (tex) this.drawPlayerFrame(tex.getContext() as CanvasRenderingContext2D, 'idle', f);
      idleFrames.push(tex as any);
    }

    // Walk: 4 frames
    const walkFrames: Phaser.Textures.CanvasTexture[] = [];
    for (let f = 0; f < 4; f++) {
      const tex = scene.textures.createCanvas(`player_walk_${f}`, 16, 32);
      if (tex) this.drawPlayerFrame(tex.getContext() as CanvasRenderingContext2D, 'walk', f);
      walkFrames.push(tex as any);
    }

    // Jump: 1 frame
    const jumpTex = scene.textures.createCanvas('player_jump', 16, 32);
    if (jumpTex) this.drawPlayerFrame(jumpTex.getContext() as CanvasRenderingContext2D, 'jump', 0);

    // Fall: 1 frame
    const fallTex = scene.textures.createCanvas('player_fall', 16, 32);
    if (fallTex) this.drawPlayerFrame(fallTex.getContext() as CanvasRenderingContext2D, 'fall', 0);

    // Punch: 2 frames
    const punchFrames: Phaser.Textures.CanvasTexture[] = [];
    for (let f = 0; f < 2; f++) {
      const tex = scene.textures.createCanvas(`player_punch_${f}`, 16, 32);
      if (tex) this.drawPlayerFrame(tex.getContext() as CanvasRenderingContext2D, 'punch', f);
      punchFrames.push(tex as any);
    }

    console.log('[Player] Animation frames generated');
  }

  private drawPlayerFrame(ctx: CanvasRenderingContext2D, action: string, frame: number): void {
    ctx.clearRect(0, 0, 16, 32);
    
    const time = frame;
    const isLeft = false; // Base frames face right, flipX handles left
    
    // Colors
    const SKIN = '#FFDBAA';
    const SHIRT = '#4A90D9';
    const PANTS = '#3D3D5D';
    const SHOE = '#2A2A2A';
    const HAIR = '#3D2B1F';
    const OUTLINE = '#1A1A2E';

    // Arm swing offset for walk
    let armSwing = 0;
    let legSwing = 0;
    let bodyBob = 0;
    
    if (action === 'walk') {
      armSwing = Math.sin(frame * Math.PI / 2) * 3;
      legSwing = Math.sin(frame * Math.PI / 2) * 2;
      bodyBob = Math.abs(Math.sin(frame * Math.PI / 2)) * 1;
    } else if (action === 'idle') {
      bodyBob = Math.sin(frame * Math.PI) * 0.5;
    } else if (action === 'jump') {
      armSwing = -4;
      legSwing = 2;
    } else if (action === 'fall') {
      armSwing = 2;
      legSwing = -1;
    } else if (action === 'punch') {
      armSwing = frame === 0 ? -6 : 4; // Windup -> punch
      legSwing = frame === 0 ? 1 : -1;
    }

    // === LEGS ===
    // Left leg
    ctx.fillStyle = PANTS;
    ctx.fillRect(2, 24 + bodyBob, 5, 8 - Math.abs(legSwing));
    ctx.fillStyle = SHOE;
    ctx.fillRect(2, 30 + bodyBob - Math.abs(legSwing), 5, 2);
    
    // Right leg
    ctx.fillRect(9, 24 + bodyBob, 5, 8 - Math.abs(-legSwing));
    ctx.fillStyle = SHOE;
    ctx.fillRect(9, 30 + bodyBob - Math.abs(-legSwing), 5, 2);

    // === BODY ===
    ctx.fillStyle = SHIRT;
    ctx.fillRect(3, 8 + bodyBob, 10, 16);
    // Shirt detail
    ctx.fillStyle = '#3A70B9';
    ctx.fillRect(3, 8 + bodyBob, 10, 3); // Collar
    ctx.fillRect(5, 14 + bodyBob, 1, 8); // Button line

    // === ARMS ===
    ctx.fillStyle = SHIRT;
    // Left arm
    ctx.fillRect(isLeft ? 10 : 1, 10 + bodyBob - armSwing, 4, 14);
    // Right arm
    ctx.fillRect(isLeft ? 2 : 11, 10 + bodyBob + armSwing, 4, 14);
    // Hands
    ctx.fillStyle = SKIN;
    ctx.fillRect(isLeft ? 10 : 1, 22 + bodyBob - armSwing, 4, 4);
    ctx.fillRect(isLeft ? 2 : 11, 22 + bodyBob + armSwing, 4, 4);

    // === HEAD ===
    ctx.fillStyle = SKIN;
    ctx.fillRect(2, 1 + bodyBob, 12, 10);
    // Hair
    ctx.fillStyle = HAIR;
    ctx.fillRect(2, 1 + bodyBob, 12, 4);
    ctx.fillRect(1, 3 + bodyBob, 2, 3); // Side hair
    ctx.fillRect(13, 3 + bodyBob, 2, 3);
    // Eyes
    ctx.fillStyle = '#2A2A2A';
    const eyeOffset = action === 'punch' && frame === 1 ? 1 : 0; // Squint on punch
    ctx.fillRect(5, 4 + bodyBob + eyeOffset, 2, 2 - eyeOffset);
    ctx.fillRect(9, 4 + bodyBob + eyeOffset, 2, 2 - eyeOffset);
    // Eye highlight
    ctx.fillStyle = '#FFF';
    ctx.fillRect(5, 4 + bodyBob, 1, 1);
    ctx.fillRect(9, 4 + bodyBob, 1, 1);
    // Mouth
    ctx.fillStyle = '#8B5A4A';
    if (action === 'punch' && frame === 1) {
      ctx.fillRect(7, 9 + bodyBob, 2, 1); // Grunt
    } else {
      ctx.fillRect(7, 9 + bodyBob, 2, 1);
    }
  }

  update(
    cursors: Phaser.Types.Input.Keyboard.CursorKeys,
    wasd: { [key: string]: Phaser.Input.Keyboard.Key },
    time: number,
    delta: number
  ): void {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;

    // Horizontal movement: support both Arrow keys AND WASD (A/D)
    const leftDown = cursors.left?.isDown || wasd['A']?.isDown;
    const rightDown = cursors.right?.isDown || wasd['D']?.isDown;
    // Jump: support Up arrow, W, and Space
    const jumpDown = cursors.up?.isDown || wasd['W']?.isDown || cursors.space?.isDown || wasd['SPACE']?.isDown;

    let moving = false;
    if (leftDown) {
      body.setVelocityX(-this.speed);
      this.facing = 'left';
      this.sprite.flipX = true;
      moving = true;
    } else if (rightDown) {
      body.setVelocityX(this.speed);
      this.facing = 'right';
      this.sprite.flipX = false;
      moving = true;
    } else {
      body.setVelocityX(0);
    }

    // Jump
    if (jumpDown && body.blocked.down) {
      body.setVelocityY(this.jumpPower);
    }

    // Update animation state
    if (!body.blocked.down) {
      this.animState = body.velocity.y < 0 ? 'jump' : 'fall';
    } else if (moving) {
      this.animState = 'walk';
    } else {
      this.animState = 'idle';
    }

    // Handle punch cooldown (for visual)
    if (this.punchCooldown > 0) {
      this.punchCooldown -= delta;
      if (this.punchCooldown <= 0) {
        this.animState = this.animState; // Will reset in render
      }
    }

    // Update break/place cooldowns
    if (this.breakCooldown > 0) this.breakCooldown -= delta;
    if (this.placeCooldown > 0) this.placeCooldown -= delta;

    // Handle breaking progress
    if (this.isBreaking && this.breakTarget) {
      this.breakProgress += delta;
      if (this.breakProgress >= this.breakTotalTime) {
        // Break complete
        this.isBreaking = false;
        this.breakTarget = null;
        this.breakProgress = 0;
      }
    }

    // Update sprite texture based on animation state
    this.updateSpriteTexture();
  }

  private updateSpriteTexture(): void {
    let textureKey = 'player_idle_0';
    
    if (this.punchCooldown > 0) {
      const frame = this.punchCooldown > 100 ? 0 : 1;
      textureKey = `player_punch_${frame}`;
    } else {
      switch (this.animState) {
        case 'idle':
          textureKey = `player_idle_${Math.floor(this.animTimer / 500) % 2}`;
          break;
        case 'walk':
          textureKey = `player_walk_${Math.floor(this.animTimer / 120) % 4}`;
          break;
        case 'jump':
          textureKey = 'player_jump';
          break;
        case 'fall':
          textureKey = 'player_fall';
          break;
      }
    }

    if (this.sprite.texture.key !== textureKey && this.scene.textures.exists(textureKey)) {
      this.sprite.setTexture(textureKey);
    }

    // Update anim timer
    if (this.animState === 'walk' || this.animState === 'idle') {
      this.animTimer += 16; // Approximate delta
    } else {
      this.animTimer = 0;
    }
  }

  // Called from scene on pointer down (hold to break)
  tryBreakBlock(worldX: number, worldY: number): { success: boolean; instant: boolean; blockId: string | null; breakTime: number } {
    if (this.breakCooldown > 0) return { success: false, instant: false, blockId: null, breakTime: 0 };

    const { x, y } = World.worldToTile(worldX, worldY);
    const block = this.world.getBlock(x, y);
    if (!block || !block.id) return { success: false, instant: false, blockId: null, breakTime: 0 };

    const blockId = block.id;
    const item = getItem(blockId);
    const breakTime = this.getBreakSpeed(blockId);

    // Punch visual
    this.punchCooldown = 200;
    this.punchDirection = this.facing;

    if (breakTime <= 100) {
      // Instant break
      const dropped = this.world.breakBlock(x, y);
      if (dropped) {
        this.breakCooldown = breakTime;
        return { success: true, instant: true, blockId: dropped, breakTime };
      }
    } else {
      // Start breaking progress
      this.isBreaking = true;
      this.breakTarget = { x, y };
      this.breakProgress = 0;
      this.breakTotalTime = breakTime;
      this.breakCooldown = breakTime; // Prevent other breaks
      return { success: true, instant: false, blockId, breakTime };
    }
    return { success: false, instant: false, blockId: null, breakTime: 0 };
  }

  // Called every frame while holding mouse to update break progress
  updateBreakProgress(): number {
    if (!this.isBreaking || !this.breakTarget) return 0;
    return Math.min(1, this.breakProgress / this.breakTotalTime);
  }

  // Called when mouse released or target changed
  cancelBreak(): void {
    this.isBreaking = false;
    this.breakTarget = null;
    this.breakProgress = 0;
    this.breakTotalTime = 0;
  }

  // Complete the break (called when progress reaches 1)
  completeBreak(): string | null {
    if (!this.breakTarget) return null;
    const { x, y } = this.breakTarget;
    const dropped = this.world.breakBlock(x, y);
    this.isBreaking = false;
    this.breakTarget = null;
    this.breakProgress = 0;
    this.breakTotalTime = 0;
    return dropped;
  }

  tryPlaceBlock(worldX: number, worldY: number): boolean {
    if (this.placeCooldown > 0) return false;

    const selectedItemId = this.inventory.getSelectedItemId();
    if (!selectedItemId) return false;

    const item = getItem(selectedItemId);
    if (!item || item.type !== 'block') return false;

    const { x, y } = World.worldToTile(worldX, worldY);

    // Don't place on player
    const playerTile = World.worldToTile(this.sprite.x, this.sprite.y);
    if (x === playerTile.x && y === playerTile.y) return false;

    const success = this.world.placeBlock(x, y, selectedItemId);
    if (success) {
      this.inventory.consumeSelected(1);
      this.placeCooldown = this.placeSpeed;
      return true;
    }
    return false;
  }

  private getBreakSpeed(blockId: string): number {
    const toolId = this.getEquippedTool() ?? 'fist';
    const tool = getItem(toolId);
    let multiplier = 1;

    if (tool?.id === 'pickaxe') multiplier = 0.25;
    else if (tool?.id === 'wrench') multiplier = 0.6;
    else multiplier = 1; // fist

    const block = getItem(blockId);
    const hardness = block?.rarity ? Math.max(1, block.rarity / 8) : 1;

    return Math.max(80, this.breakSpeed * hardness * multiplier);
  }

  private getEquippedTool(): string | null {
    const selected = this.inventory.getSelectedItemId();
    if (selected) {
      const item = getItem(selected);
      if (item?.type === 'tool') return selected;
    }
    return 'fist';
  }

  getFacingDirection(): 'left' | 'right' {
    return this.facing;
  }

  getBreakTarget(worldX: number, worldY: number): { x: number; y: number } | null {
    const { x, y } = World.worldToTile(worldX, worldY);
    if (this.world.getBlock(x, y)?.id) {
      return { x, y };
    }
    return null;
  }

  isCurrentlyBreaking(): boolean {
    return this.isBreaking;
  }

  getBreakProgress(): number {
    if (!this.isBreaking || this.breakTotalTime === 0) return 0;
    return this.breakProgress / this.breakTotalTime;
  }

  getPunchDirection(): 'left' | 'right' {
    return this.punchDirection;
  }
}