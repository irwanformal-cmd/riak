import Phaser from 'phaser';
import { World, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../systems/World';
import { Inventory, HOTBAR_SIZE } from '../systems/Inventory';
import { Player } from '../systems/Player';
import { SplicingSystem } from '../systems/Splicing';
import { ITEMS, getItem, getRarityColor, getBlockIdFromSeed } from '../data/items';
import { RECIPES } from '../data/recipes';

export class GameScene extends Phaser.Scene {
  private world!: World;
  private inventory!: Inventory;
  private player!: Player;
  private splicing!: SplicingSystem;

  // Graphics layers (rendered in order: background -> foreground -> player -> UI)
  private backgroundGraphics!: Phaser.GameObjects.Graphics;
  private foregroundGraphics!: Phaser.GameObjects.Graphics;
  private punchGraphics!: Phaser.GameObjects.Graphics;
  private breakParticles!: Phaser.GameObjects.Particles.ParticleEmitter;

  // Physics: invisible static colliders matching solid foreground tiles
  private solidGroup!: Phaser.GameObjects.Group;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { [key: string]: Phaser.Input.Keyboard.Key };
  private pointer!: Phaser.Input.Pointer;

  // UI State
  private splicePanelOpen = false;
  private spliceSlotA: string | null = null;
  private spliceSlotB: string | null = null;
  private hoverTile: { x: number; y: number } | null = null;

  // Break/place state
  private isMouseDown = false;
  private lastBreakTarget: { x: number; y: number } | null = null;

  // DOM Elements
  private hotbarEl!: HTMLDivElement;
  private splicePanelEl!: HTMLDivElement;
  private spliceSlotAEl!: HTMLDivElement;
  private spliceSlotBEl!: HTMLDivElement;
  private spliceBtnEl!: HTMLButtonElement;
  private spliceResultEl!: HTMLDivElement;
  private discoveryLogEl!: HTMLDivElement;

  constructor() {
    super('GameScene');
    console.log('[GameScene] Constructor called');
  }

  init(): void {
    console.log('[GameScene] init() called');
  }

  preload(): void {
    console.log('[GameScene] preload() started');
    this.generateTextures();
    console.log('[GameScene] preload() finished');
  }

  create(): void {
    console.log('[GameScene] create() started');
    
    try {
      this.setupUI();        // FIRST: Initialize DOM elements
      console.log('[GameScene] setupUI done');
      this.setupSystems();   // THEN: Systems that use DOM elements
      console.log('[GameScene] setupSystems done');
      this.setupInput();
      console.log('[GameScene] setupInput done');
      this.setupCamera();
      console.log('[GameScene] setupCamera done');
      this.setupParticles();
      console.log('[GameScene] setupParticles done');
      this.loadFromLocalStorage();
      console.log('[GameScene] loadFromLocalStorage done');
      console.log('[GameScene] create() finished successfully');
    } catch (e) {
      console.error('[GameScene] create() ERROR:', e);
      throw e;
    }
  }

  private generateTextures(): void {
    console.log('[GameScene] generateTextures() started');
    // Base 'player' texture must exist BEFORE Player constructor uses it.
    // Full idle/walk/jump/punch animation frames are drawn in Player.ts.
    if (!this.textures.exists('player')) {
      const playerTex = this.textures.createCanvas('player', 16, 32);
      if (!playerTex) {
        console.error('[GameScene] Failed to create player texture');
        return;
      }
      const ctx = playerTex.getContext() as CanvasRenderingContext2D;
      // Body (blue shirt)
      ctx.fillStyle = '#4A90D9';
      ctx.fillRect(4, 8, 8, 20);
      // Head (skin tone)
      ctx.fillStyle = '#FFDBAA';
      ctx.fillRect(3, 0, 10, 10);
      // Hair
      ctx.fillStyle = '#3D2B1F';
      ctx.fillRect(3, 0, 10, 4);
      // Eyes
      ctx.fillStyle = '#000';
      ctx.fillRect(5, 3, 2, 2);
      ctx.fillRect(9, 3, 2, 2);
      // Legs
      ctx.fillStyle = '#4A4A6A';
      ctx.fillRect(4, 24, 4, 8);
      ctx.fillRect(8, 24, 4, 8);
      console.log('[GameScene] Player texture created:', this.textures.exists('player'));
    }

    // Particle FX textures (must exist before setupParticles)
    if (!this.textures.exists('particle')) {
      const particleTex = this.textures.createCanvas('particle', 8, 8);
      if (particleTex) {
        const pctx = particleTex.getContext() as CanvasRenderingContext2D;
        pctx.fillStyle = '#FFD700';
        pctx.beginPath();
        pctx.arc(4, 4, 4, 0, Math.PI * 2);
        pctx.fill();
      }
    }
    if (!this.textures.exists('place_puff')) {
      const placeTex = this.textures.createCanvas('place_puff', 16, 16);
      if (placeTex) {
        const pctx = placeTex.getContext() as CanvasRenderingContext2D;
        pctx.fillStyle = '#FFFFFF';
        pctx.globalAlpha = 0.5;
        pctx.beginPath();
        pctx.arc(8, 8, 6, 0, Math.PI * 2);
        pctx.fill();
      }
    }

    console.log('[GameScene] generateTextures() finished');
  }

  private setupSystems(): void {
    console.log('[GameScene] setupSystems() started');
    this.world = new World(this);
    console.log('[GameScene] World created');
    this.inventory = new Inventory();
    console.log('[GameScene] Inventory created, slots:', this.inventory.slots.length);
    this.player = new Player(this, this.world, this.inventory);
    console.log('[GameScene] Player created, sprite:', !!this.player.sprite, 'pos:', this.player.sprite?.x, this.player.sprite?.y);
    this.splicing = new SplicingSystem();
    console.log('[GameScene] SplicingSystem created');

    // Graphics layers - background renders first (depth 0), foreground on top (depth 5)
    this.backgroundGraphics = this.add.graphics();
    this.backgroundGraphics.setDepth(0);
    
    this.foregroundGraphics = this.add.graphics();
    this.foregroundGraphics.setDepth(5);
    
    console.log('[GameScene] Graphics layers created');

    // Physics: build invisible static colliders for all solid tiles,
    // then collide the player against them (real platformer movement)
    this.solidGroup = this.world.getStaticColliders(this);
    this.physics.add.collider(this.player.sprite, this.solidGroup);
    console.log('[GameScene] Solid colliders built:', this.solidGroup.getLength());

    // Listen for inventory changes
    this.inventory.onChange(() => this.updateHotbarUI());

    // Listen for discoveries
    this.splicing.onDiscovery((itemId) => this.showDiscoveryToast(itemId));

    // Initial UI update
    this.updateHotbarUI();
    console.log('[GameScene] setupSystems() finished');
  }

  private setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D,E,Q') as any;
    this.pointer = this.input.activePointer;

    // Number keys for hotbar
    for (let i = 0; i < 10; i++) {
      const key = this.input.keyboard!.addKey(`DIGIT_${i === 0 ? 0 : i}`);
      key.on('down', () => this.inventory.selectSlot(i === 0 ? 9 : i - 1));
    }

    // E key for splice panel
    this.wasd.E?.on('down', () => this.toggleSplicePanel());
    // Q or Escape to close splice panel
    this.wasd.Q?.on('down', () => {
      if (this.splicePanelOpen) this.closeSplicePanel();
    });

    // Mouse wheel for hotbar
    this.input.on('wheel', (pointer: any, dx: number, dy: number) => {
      if (dy > 0) this.inventory.selectNext();
      else if (dy < 0) this.inventory.selectPrev();
    });

    // Mouse down state for hold-to-break
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.splicePanelOpen) return;

      this.isMouseDown = true;
      const worldX = pointer.worldX;
      const worldY = pointer.worldY;

      if (pointer.leftButtonDown()) {
        const result = this.player.tryBreakBlock(worldX, worldY);
        if (result.success) {
          this.lastBreakTarget = { x: Math.floor(worldX / TILE_SIZE), y: Math.floor(worldY / TILE_SIZE) };
          if (result.instant && result.blockId) {
            this.addItemWithPickupEffect(result.blockId, worldX, worldY);
            this.createBreakParticles(worldX, worldY);
            this.showPunchEffect(worldX, worldY);
            this.refreshColliders();
          }
        }
      } else if (pointer.rightButtonDown()) {
        const success = this.player.tryPlaceBlock(worldX, worldY);
        if (success) {
          this.createPlacePuff(worldX, worldY);
          this.refreshColliders();
        }
      }
    });

    // Mouse up — complete any pending break
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.isMouseDown = false;
      if (this.player.isCurrentlyBreaking()) {
        const dropped = this.player.completeBreak();
        if (dropped) {
          const wx = this.lastBreakTarget ? this.lastBreakTarget.x * TILE_SIZE + TILE_SIZE / 2 : pointer.worldX;
          const wy = this.lastBreakTarget ? this.lastBreakTarget.y * TILE_SIZE + TILE_SIZE / 2 : pointer.worldY;
          this.addItemWithPickupEffect(dropped, wx, wy);
          this.createBreakParticles(wx, wy);
          this.showPunchEffect(wx, wy);
          this.refreshColliders();
        }
      }
      this.lastBreakTarget = null;
    });

    // Prevent context menu
    this.input.on('contextmenu', (e: any) => e.preventDefault());

    // Hover tile tracking + cancel break if dragged off target
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const { x, y } = World.worldToTile(pointer.worldX, pointer.worldY);
      this.hoverTile = { x, y };
      if (this.isMouseDown && this.lastBreakTarget && (this.lastBreakTarget.x !== x || this.lastBreakTarget.y !== y)) {
        this.player.cancelBreak();
        this.lastBreakTarget = null;
      }
    });
  }

  private setupUI(): void {
    this.hotbarEl = document.getElementById('hotbar') as HTMLDivElement;
    this.splicePanelEl = document.getElementById('splice-panel') as HTMLDivElement;
    this.spliceSlotAEl = document.getElementById('splice-slot-a') as HTMLDivElement;
    this.spliceSlotBEl = document.getElementById('splice-slot-b') as HTMLDivElement;
    this.spliceBtnEl = document.getElementById('splice-btn') as HTMLButtonElement;
    this.spliceResultEl = document.getElementById('splice-result') as HTMLDivElement;
    this.discoveryLogEl = document.getElementById('discovery-log') as HTMLDivElement;

    // Splice panel events
    (document.getElementById('close-splice') as HTMLButtonElement).onclick = () => this.closeSplicePanel();

    this.spliceSlotAEl.onclick = () => this.pickSpliceSlot('A');
    this.spliceSlotBEl.onclick = () => this.pickSpliceSlot('B');

    this.spliceBtnEl.onclick = () => this.doSplice();

    // Drag and drop for splice slots
    [this.spliceSlotAEl, this.spliceSlotBEl].forEach(el => {
      el.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
      el.addEventListener('drop', (e: DragEvent) => this.handleSpliceDrop(e));
    });

    // Hotbar drag/drop
    this.hotbarEl.addEventListener('dragstart', (e: DragEvent) => this.handleHotbarDragStart(e));
    this.hotbarEl.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
    this.hotbarEl.addEventListener('drop', (e: DragEvent) => this.handleHotbarDrop(e));
  }

  private setupCamera(): void {
    console.log('[GameScene] setupCamera() started');
    console.log('[GameScene] World bounds:', WORLD_WIDTH * TILE_SIZE, WORLD_HEIGHT * TILE_SIZE);
    console.log('[GameScene] Player sprite for camera:', !!this.player.sprite, 'pos:', this.player.sprite?.x, this.player.sprite?.y);
    
    // Set camera bounds
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH * TILE_SIZE, WORLD_HEIGHT * TILE_SIZE);
    
    // Center camera on player
    this.cameras.main.scrollX = this.player.sprite.x - this.cameras.main.width / 2;
    this.cameras.main.scrollY = this.player.sprite.y - this.cameras.main.height / 2;
    
    // Smooth follow (lerp 0.1 = smooth camera)
    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);
    
    // ZOOM OUT - 0.6x to see more world (Growtopia style)
    this.cameras.main.setZoom(0.6);
    this.cameras.main.setBackgroundColor('#0D1B2A'); // Darker sky color
    
    console.log('[GameScene] Camera setup done, zoom:', this.cameras.main.zoom, 'scroll:', this.cameras.main.scrollX, this.cameras.main.scrollY);
  }

  private refreshColliders(): void {
    // Rebuild invisible static colliders from the world grid,
    // then re-attach the player collider. 100x60 scan is cheap.
    if (this.solidGroup) {
      this.solidGroup.clear(true, true);
    }
    this.solidGroup = this.world.getStaticColliders(this);
    this.physics.add.collider(this.player.sprite, this.solidGroup);
  }

  private setupParticles(): void {
    console.log('[GameScene] setupParticles() started');
    // Break particles - colored sparkles
    // Texture 'particle' is created in generateTextures()
    this.breakParticles = this.add.particles(0, 0, 'particle', {
      lifespan: 400,
      speed: { min: 30, max: 120 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 1, end: 0 },
      quantity: 6,
      blendMode: 'ADD',
      emitting: false,
    });
    this.breakParticles.setDepth(20);
    console.log('[GameScene] Particles created:', !!this.breakParticles);

    // Punch/highlight graphics layer (above blocks, below player)
    this.punchGraphics = this.add.graphics();
    this.punchGraphics.setDepth(8);
  }

  private createBreakParticles(x: number, y: number): void {
    // Emit gold sparkles
    this.breakParticles.emitParticleAt(x, y, 10);
  }

  private addItemWithPickupEffect(itemId: string, x: number, y: number): void {
    const added = this.inventory.addItem(itemId);
    if (added > 0) {
      const item = getItem(itemId);
      const text = this.add.text(x, y - 20, `+${added} ${item?.name}`, {
        fontSize: '11px',
        fontFamily: '"Press Start 2P", monospace',
        color: '#FFD700',
        stroke: '#000',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(30);
      this.tweens.add({
        targets: text,
        y: text.y - 40,
        alpha: 0,
        duration: 1000,
        ease: 'Power2',
        onComplete: () => text.destroy(),
      });
    }
  }

  private updateHotbarUI(): void {
    this.hotbarEl.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = this.inventory.slots[i];
      const slotEl = document.createElement('div');
      slotEl.className = 'slot' + (i === this.inventory.selectedIndex ? ' selected' : '');
      slotEl.dataset.index = i.toString();
      slotEl.draggable = true;

      if (slot.itemId) {
        const item = getItem(slot.itemId)!;
        const color = item.color;
        const rarityColor = getRarityColor(item.rarity);

        slotEl.innerHTML = `
          <div class="slot-icon" style="width:28px;height:28px;background:${color};border-radius:3px;box-shadow:inset -2px -2px 4px rgba(0,0,0,0.4), inset 2px 2px 4px rgba(255,255,255,0.2);border:1px solid ${this.shadeColor(color, -30)};"></div>
          <div class="item-name" style="font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48px;">${item.name}</div>
          <div class="count" style="font-size:11px;font-weight:bold;color:#FFD700;text-shadow:1px 1px 2px #000;">${slot.count}</div>
        `;
        slotEl.style.borderColor = rarityColor;
        slotEl.style.boxShadow = '0 0 8px ' + rarityColor + '88, inset 0 0 8px rgba(0,0,0,0.5)';
      } else {
        slotEl.innerHTML = `<div class="item-name" style="color:#666;font-size:9px;">Empty</div>`;
        slotEl.style.borderColor = '#444';
        slotEl.style.boxShadow = 'inset 0 0 8px rgba(0,0,0,0.5)';
      }

      slotEl.onclick = () => this.inventory.selectSlot(i);
      this.hotbarEl.appendChild(slotEl);
    }
  }

  // Helper to darken/lighten hex color
  private shadeColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  // === Splice Panel ===
  private toggleSplicePanel(): void {
    this.splicePanelOpen = !this.splicePanelOpen;
    this.splicePanelEl.classList.toggle('open', this.splicePanelOpen);
    if (this.splicePanelOpen) {
      this.updateSpliceUI();
    }
  }

  private closeSplicePanel(): void {
    this.splicePanelOpen = false;
    this.splicePanelEl.classList.remove('open');
  }

  private pickSpliceSlot(slot: 'A' | 'B'): void {
    const selectedItemId = this.inventory.getSelectedItemId();
    if (!selectedItemId) return;

    const item = getItem(selectedItemId);
    if (!item || item.type !== 'seed') {
      this.showToast('Only seeds can be spliced!', '#ff4444');
      return;
    }

    if (slot === 'A') {
      this.spliceSlotA = selectedItemId;
    } else {
      this.spliceSlotB = selectedItemId;
    }
    this.updateSpliceUI();
  }

  private handleSpliceDrop(e: DragEvent): void {
    e.preventDefault();
    const itemId = e.dataTransfer?.getData('text/plain');
    if (!itemId) return;

    const item = getItem(itemId);
    if (!item || item.type !== 'seed') {
      this.showToast('Only seeds can be spliced!', '#ff4444');
      return;
    }

    const target = e.currentTarget as HTMLElement;
    if (target.id === 'splice-slot-a') {
      this.spliceSlotA = itemId;
    } else if (target.id === 'splice-slot-b') {
      this.spliceSlotB = itemId;
    }
    this.updateSpliceUI();
  }

  private updateSpliceUI(): void {
    // Slot A
    if (this.spliceSlotA) {
      const item = getItem(this.spliceSlotA)!;
      this.spliceSlotAEl.classList.add('filled');
      this.spliceSlotAEl.innerHTML = `<span class="slot-label">Seed A</span><div style="width:40px;height:40px;background:${item.color};border-radius:6px;border:2px solid ${this.shadeColor(item.color, -30)};"></div>`;
    } else {
      this.spliceSlotAEl.classList.remove('filled');
      this.spliceSlotAEl.innerHTML = '<span class="slot-label">Seed A</span>';
    }

    // Slot B
    if (this.spliceSlotB) {
      const item = getItem(this.spliceSlotB)!;
      this.spliceSlotBEl.classList.add('filled');
      this.spliceSlotBEl.innerHTML = `<span class="slot-label">Seed B</span><div style="width:40px;height:40px;background:${item.color};border-radius:6px;border:2px solid ${this.shadeColor(item.color, -30)};"></div>`;
    } else {
      this.spliceSlotBEl.classList.remove('filled');
      this.spliceSlotBEl.innerHTML = '<span class="slot-label">Seed B</span>';
    }

    // Button
    this.spliceBtnEl.disabled = !(this.spliceSlotA && this.spliceSlotB);
    this.spliceResultEl.textContent = '';
  }

  private doSplice(): void {
    if (!this.spliceSlotA || !this.spliceSlotB) return;

    const result = this.splicing.trySplice(this.spliceSlotA, this.spliceSlotB);

    // Consume seeds
    this.inventory.removeItem(this.spliceSlotA, 1);
    this.inventory.removeItem(this.spliceSlotB, 1);

    if (result.success && result.outputItemId) {
      this.inventory.addItem(result.outputItemId, 1);
      this.spliceResultEl.innerHTML = `<span style="color:${getRarityColor(getItem(result.outputItemId)!.rarity)}">✨ ${result.message}</span>`;

      // Clear slots
      this.spliceSlotA = null;
      this.spliceSlotB = null;
      this.updateSpliceUI();
    } else {
      this.spliceResultEl.innerHTML = `<span style="color:#ff4444">❌ ${result.message}</span>`;
    }
  }

  // === Hotbar Drag/Drop ===
  private handleHotbarDragStart(e: DragEvent): void {
    const target = e.target as HTMLElement;
    const slotEl = target.closest('.slot') as HTMLElement;
    if (!slotEl) return;

    const index = parseInt(slotEl.dataset.index!);
    const slot = this.inventory.slots[index];
    if (!slot.itemId) return;

    e.dataTransfer!.setData('text/plain', slot.itemId);
    e.dataTransfer!.effectAllowed = 'move';
    slotEl.style.opacity = '0.5';
  }

  private handleHotbarDrop(e: DragEvent): void {
    e.preventDefault();
    // Simplified: just swap with selected
  }

  // === Toasts ===
  private showDiscoveryToast(itemId: string): void {
    const item = getItem(itemId);
    if (!item) return;

    const toast = document.createElement('div');
    toast.className = 'discovery-toast';
    toast.innerHTML = `🧬 <strong>NEW DISCOVERY!</strong> ${item.name} <span style="font-size:10px;opacity:0.8">(Rarity: ${item.rarity})</span>`;
    this.discoveryLogEl.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
  }

  private showToast(message: string, color: string = '#ffd700'): void {
    const toast = document.createElement('div');
    toast.className = 'discovery-toast';
    toast.style.background = `linear-gradient(90deg, ${color}, ${color}dd)`;
    toast.textContent = message;
    this.discoveryLogEl.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // === Save/Load ===
  private saveToLocalStorage(): void {
    const saveData = {
      inventory: this.inventory.serialize(),
      recipes: RECIPES.map(r => ({ input: r.input, output: r.output, discovered: r.discovered })),
      playerPos: { x: this.player.sprite.x, y: this.player.sprite.y },
    };
    localStorage.setItem('growtopia-proto-save', JSON.stringify(saveData));
  }

  private loadFromLocalStorage(): void {
    const data = localStorage.getItem('growtopia-proto-save');
    if (!data) return;

    try {
      const save = JSON.parse(data);
      this.inventory.deserialize(save.inventory);
      save.recipes.forEach((r: any) => {
        const recipe = RECIPES.find(rec => rec.input[0] === r.input[0] && rec.input[1] === r.input[1]);
        if (recipe) recipe.discovered = r.discovered;
      });
      this.player.sprite.setPosition(save.playerPos.x, save.playerPos.y);
    } catch (e) {
      console.warn('Failed to load save:', e);
    }
  }

  update(time: number, delta: number): void {
    this.player.update(this.cursors, this.wasd, time, delta);
    this.renderWorld();
    this.renderBreakProgress();
  }

  private renderWorld(): void {
    const bg = this.backgroundGraphics;
    const fg = this.foregroundGraphics;
    bg.clear();
    fg.clear();

    const cam = this.cameras.main;
    const viewX = cam.scrollX;
    const viewY = cam.scrollY;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;

    const tiles = this.world.getTilesInView(viewX, viewY, viewW, viewH);

    // Render each tile: background first, then foreground
    for (const { x, y, block } of tiles) {
      const wx = x * TILE_SIZE;
      const wy = y * TILE_SIZE;

      // === BACKGROUND LAYER (depth 0) ===
      if (block.background) {
        const bgItem = getItem(block.background);
        if (bgItem) {
          this.drawBackgroundBlock(bg, wx, wy, bgItem.color);
        }
      }

      // === FOREGROUND LAYER (depth 5) ===
      if (block.id) {
        const fgItem = getItem(block.id);
        if (fgItem) {
          this.drawForegroundBlock(fg, wx, wy, fgItem.color, x, y, block.id);
        }
      }
    }
  }

  private renderBreakProgress(): void {
    // Clear punch layer each frame
    this.punchGraphics.clear();

    if (!this.player.isCurrentlyBreaking()) return;

    const progress = this.player.getBreakProgress();
    if (progress <= 0 || progress >= 1) return;

    const target = this.lastBreakTarget;
    if (!target) return;

    const wx = target.x * TILE_SIZE;
    const wy = target.y * TILE_SIZE;

    // Break progress ring
    this.punchGraphics.lineStyle(3, 0xFFD700, 0.8);
    this.punchGraphics.beginPath();
    this.punchGraphics.arc(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    this.punchGraphics.strokePath();

    // Center dot
    this.punchGraphics.fillStyle(0xFFD700, 0.6);
    this.punchGraphics.fillCircle(wx + TILE_SIZE / 2, wy + TILE_SIZE / 2, 4);
  }

  private createPlacePuff(x: number, y: number): void {
    // Small white puff when placing — auto-destroy particle
    const puff = this.add.particles(x, y, 'place_puff', {
      lifespan: 300,
      speed: { min: 10, max: 40 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.7, end: 0 },
      quantity: 4,
      emitting: true,
    });
    puff.setDepth(25);
    puff.explode(4, x, y);
    this.time.delayedCall(400, () => puff.destroy());
  }

  private showPunchEffect(x: number, y: number): void {
    // Quick gold flash ring
    this.punchGraphics.lineStyle(2, 0xFFD700, 0.8);
    this.punchGraphics.strokeCircle(x, y, 18);
    this.time.delayedCall(80, () => {
      if (!this.player.isCurrentlyBreaking()) this.punchGraphics.clear();
    });
  }

  private drawBackgroundBlock(g: Phaser.GameObjects.Graphics, wx: number, wy: number, color: string): void {
    const baseColor = Phaser.Display.Color.HexStringToColor(color).color;
    const darkColor = Phaser.Display.Color.HexStringToColor(this.shadeColor(color, -20)).color;

    // Background: flat color, dimmed — no 3D, no border
    g.fillStyle(baseColor, 0.62);
    g.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);

    // Subtle weave pattern (skip for cave void)
    if (color !== '#2A2A3E') {
      g.fillStyle(darkColor, 0.08);
      for (let i = -TILE_SIZE; i < TILE_SIZE * 2; i += 10) {
        g.fillRect(wx + i, wy, 1, TILE_SIZE);
      }
    }
  }

  private drawForegroundBlock(
    g: Phaser.GameObjects.Graphics,
    wx: number,
    wy: number,
    color: string,
    tileX: number,
    tileY: number,
    blockId: string
  ): void {
    const baseColor = Phaser.Display.Color.HexStringToColor(color).color;
    const darkColor = Phaser.Display.Color.HexStringToColor(this.shadeColor(color, -30)).color;
    const lightColor = Phaser.Display.Color.HexStringToColor(this.shadeColor(color, 25)).color;
    const borderColor = Phaser.Display.Color.HexStringToColor(this.shadeColor(color, -45)).color;
    const highlightColor = Phaser.Display.Color.HexStringToColor(this.shadeColor(color, 40)).color;

    // Main fill
    g.fillStyle(baseColor, 1);
    g.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);

    // Top-left light
    g.fillStyle(lightColor, 1);
    g.fillRect(wx, wy, TILE_SIZE, 4);
    g.fillRect(wx, wy, 4, TILE_SIZE);

    // Bottom-right shadow
    g.fillStyle(darkColor, 1);
    g.fillRect(wx, wy + TILE_SIZE - 4, TILE_SIZE, 4);
    g.fillRect(wx + TILE_SIZE - 4, wy, 4, TILE_SIZE);

    // Inner top-edge gleam
    g.fillStyle(highlightColor, 0.6);
    g.fillRect(wx + 2, wy + 2, TILE_SIZE - 4, 2);
    g.fillRect(wx + 2, wy + 2, 2, TILE_SIZE - 4);

    // Border — crisp game edge, NOT debug grid
    g.lineStyle(1.5, borderColor, 1);
    g.strokeRect(wx + 0.5, wy + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

    // Hover highlight (target indicator for punch)
    if (this.hoverTile && this.hoverTile.x === tileX && this.hoverTile.y === tileY && !this.splicePanelOpen) {
      g.lineStyle(2.5, 0xFFD700, 0.95);
      g.strokeRect(wx + 2, wy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      g.fillStyle(0xFFD700, 0.15);
      g.fillRect(wx + 4, wy + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    }

    // Rarity shimmer for rare blocks
    const item = getItem(blockId);
    if (item && item.rarity >= 50) {
      const time = this.time.now / 400;
      const alpha = 0.2 + 0.15 * Math.sin(time + tileX * 0.7 + tileY * 0.5);
      g.fillStyle(Phaser.Display.Color.HexStringToColor(getRarityColor(item.rarity)).color, alpha);
      g.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);
    }
  }
}