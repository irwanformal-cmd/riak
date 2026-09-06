import { ITEMS, getItem, isSeed, getBlockIdFromSeed } from '../data/items';

export const TILE_SIZE = 32;
export const WORLD_WIDTH = 100;
export const WORLD_HEIGHT = 60;
export const GROUND_LEVEL = 40;

export interface WorldBlock {
  id: string | null;           // Foreground block ID (null = empty)
  background?: string | null;  // Background wall block ID (null = empty)
}

export class World {
  private tiles: (WorldBlock | null)[][] = [];
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    console.log('[World] Constructor called');
    this.generate();
    console.log('[World] Generate done, tiles:', this.tiles.length, 'x', this.tiles[0]?.length);
  }

  generate(): void {
    console.log('[World] generate() started, size:', WORLD_WIDTH, 'x', WORLD_HEIGHT);
    this.tiles = Array.from({ length: WORLD_HEIGHT }, () => Array(WORLD_WIDTH).fill(null));

    for (let x = 0; x < WORLD_WIDTH; x++) {
      // === BACKGROUND WALLS (full height) ===
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        if (y < GROUND_LEVEL - 5) {
          // Sky background - cave wall
          this.tiles[y][x] = { id: null, background: 'cave_background' };
        } else if (y < GROUND_LEVEL) {
          // Near surface - dirt background
          this.tiles[y][x] = { id: null, background: 'dirt_background' };
        } else {
          // Underground - stone/cave background
          if (y < GROUND_LEVEL + 10) {
            this.tiles[y][x] = { id: null, background: 'stone_background' };
          } else {
            this.tiles[y][x] = { id: null, background: 'cave_background' };
          }
        }
      }

      // === FOREGROUND BLOCKS ===
      // Surface grass
      this.tiles[GROUND_LEVEL][x] = { 
        id: 'grass_block', 
        background: this.tiles[GROUND_LEVEL][x]?.background || 'dirt_background' 
      };
      
      // Underground layers
      for (let y = GROUND_LEVEL + 1; y < WORLD_HEIGHT; y++) {
        let fgId: string | null = null;
        if (y < GROUND_LEVEL + 3) {
          fgId = 'dirt_block';
        } else if (y < GROUND_LEVEL + 8) {
          fgId = 'stone_block';
        } else if (y < GROUND_LEVEL + 15) {
          fgId = Math.random() < 0.1 ? 'coal_block' : 'stone_block';
        } else if (y < GROUND_LEVEL + 20) {
          fgId = Math.random() < 0.15 ? 'iron_block' : 'stone_block';
        } else {
          fgId = Math.random() < 0.05 ? 'gold_block' : 'cave_block';
        }
        
        const existing = this.tiles[y][x];
        this.tiles[y][x] = { 
          id: fgId, 
          background: existing?.background || 'cave_background' 
        };
      }

      // Trees
      if (x % 18 === 0 && x > 15 && x < WORLD_WIDTH - 15) {
        this.addTree(x);
      }
    }
    console.log('[World] generate() finished');
  }

  // Organic tree: irregular canopy + trunk taper
  private addTree(x: number): void {
    const trunkHeight = 4 + Math.floor(Math.random() * 3);
    for (let h = 1; h <= trunkHeight; h++) {
      const y = GROUND_LEVEL - h;
      if (y >= 0) {
        const existing = this.tiles[y][x];
        this.tiles[y][x] = {
          id: 'wood_block',
          background: existing?.background ?? 'cave_background'
        };
      }
    }
    // Irregular organic canopy: circle-ish with noise + droop edges
    const cx = x;
    const cy = GROUND_LEVEL - trunkHeight - 1;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const lx = cx + dx;
        const ly = cy + dy;
        if (lx < 0 || lx >= WORLD_WIDTH || ly < 0 || ly >= WORLD_HEIGHT) continue;
        const cell = this.tiles[ly][lx];
        if (cell?.id) continue;

        const dist = Math.sqrt(dx * dx * 0.8 + dy * dy * 1.2);
        const noise = Math.sin(dx * 1.7 + dy * 2.3) * 0.5 + Math.cos(dx * 0.9 - dy * 1.1) * 0.3;
        // Sparser at corners → round organic shape, denser center
        if (dist + noise < 2.6) {
          this.tiles[ly][lx] = {
            id: 'leaves_block',
            background: cell?.background ?? 'cave_background'
          };
        }
      }
    }
    // Occasional side branch with leaves
    if (Math.random() < 0.6) {
      const bx = x + (Math.random() < 0.5 ? 1 : -1);
      const by = GROUND_LEVEL - trunkHeight + 1;
      if (bx >= 0 && bx < WORLD_WIDTH && by >= 0) {
        const cell = this.tiles[by][bx];
        if (cell && !cell.id) {
          this.tiles[by][bx] = { id: 'wood_block', background: cell.background ?? 'cave_background' };
        }
      }
    }
  }

  getBlock(x: number, y: number): WorldBlock | null {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return null;
    return this.tiles[y][x];
  }

  getBlockId(x: number, y: number): string | null {
    return this.tiles[y]?.[x]?.id ?? null;
  }

  getBackgroundId(x: number, y: number): string | null {
    return this.tiles[y]?.[x]?.background ?? null;
  }

  setBlock(x: number, y: number, itemId: string | null): boolean {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return false;
    if (itemId === null) {
      this.tiles[y][x] = { id: null, background: this.tiles[y][x]?.background || null };
    } else {
      this.tiles[y][x] = { 
        id: itemId, 
        background: this.tiles[y][x]?.background || null 
      };
    }
    return true;
  }

  setBackground(x: number, y: number, backgroundId: string | null): boolean {
    if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) return false;
    if (!this.tiles[y][x]) this.tiles[y][x] = { id: null, background: null };
    this.tiles[y][x].background = backgroundId;
    return true;
  }

  breakBlock(x: number, y: number): string | null {
    const block = this.getBlock(x, y);
    if (!block || !block.id) return null;

    const itemId = block.id;
    // Keep background when breaking foreground
    this.tiles[y][x] = { id: null, background: block.background };
    return itemId;
  }

  breakBackground(x: number, y: number): string | null {
    const block = this.getBlock(x, y);
    if (!block || !block.background) return null;

    const bgId = block.background;
    this.tiles[y][x] = { id: block.id ?? null, background: null };
    return bgId;
  }

  placeBlock(x: number, y: number, itemId: string): boolean {
    const existing = this.getBlock(x, y);
    if (existing?.id) return false;

    const item = getItem(itemId);
    if (!item || item.type !== 'block') return false;

    this.tiles[y][x] = { 
      id: itemId, 
      background: existing?.background ?? null 
    };
    return true;
  }

  placeBackground(x: number, y: number, itemId: string): boolean {
    const existing = this.getBlock(x, y);
    if (existing?.background) return false;

    const item = getItem(itemId);
    if (!item || item.type !== 'block') return false;

    if (!existing) {
      this.tiles[y][x] = { id: null, background: itemId };
    } else {
      this.tiles[y][x] = { id: existing.id ?? null, background: itemId };
    }
    return true;
  }

  // For rendering - returns both foreground and background
  getTilesInView(cameraX: number, cameraY: number, width: number, height: number): Array<{x: number, y: number, block: WorldBlock}> {
    const startX = Math.max(0, Math.floor(cameraX / TILE_SIZE) - 1);
    const endX = Math.min(WORLD_WIDTH, Math.ceil((cameraX + width) / TILE_SIZE) + 1);
    const startY = Math.max(0, Math.floor(cameraY / TILE_SIZE) - 1);
    const endY = Math.min(WORLD_HEIGHT, Math.ceil((cameraY + height) / TILE_SIZE) + 1);

    const result: Array<{x: number, y: number, block: WorldBlock}> = [];
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const block = this.tiles[y][x];
        if (block && (block.id || block.background)) {
          result.push({ x, y, block });
        }
      }
    }
    return result;
  }

  // Convert world coords to tile coords
  static worldToTile(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: Math.floor(worldX / TILE_SIZE),
      y: Math.floor(worldY / TILE_SIZE),
    };
  }

  static tileToWorld(tileX: number, tileY: number): { x: number; y: number } {
    return {
      x: tileX * TILE_SIZE,
      y: tileY * TILE_SIZE,
    };
  }

  // Physics helpers — Arcade must collide with MATTER-like solid tiles.
  // We use a Phaser StaticGroup of invisible rectangles (created by GameScene).
  getStaticColliders(scene: Phaser.Scene): Phaser.GameObjects.Group {
    const group = scene.physics.add.staticGroup();
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        if (this.isSolid(x, y)) {
          const rect = scene.add.rectangle(
            x * TILE_SIZE + TILE_SIZE / 2,
            y * TILE_SIZE + TILE_SIZE / 2,
            TILE_SIZE,
            TILE_SIZE
          );
          rect.setVisible(false);
          group.add(rect);
        }
      }
    }
    return group;
  }

  // Rebuild colliders after block changes (cheap for 100x60 grid)
  refreshColliders(group: Phaser.GameObjects.Group, scene: Phaser.Scene): Phaser.GameObjects.Group {
    group.clear(true, true);
    return this.getStaticColliders(scene);
  }

  // Check if block is solid (for collision) - only foreground
  isSolid(x: number, y: number): boolean {
    const block = this.getBlock(x, y);
    if (!block || !block.id) return false;
    const item = getItem(block.id);
    return item?.type === 'block' && block.id !== 'cave_block' && block.id !== 'cave_background';
  }

  // Check if background exists at position
  hasBackground(x: number, y: number): boolean {
    const block = this.getBlock(x, y);
    return !!block?.background;
  }

  // Get spawn position (on top of ground)
  getSpawnPosition(): { x: number; y: number } {
    const spawnX = WORLD_WIDTH / 2;
    for (let y = GROUND_LEVEL - 1; y >= 0; y--) {
      if (!this.isSolid(spawnX, y)) {
        return { x: spawnX * TILE_SIZE + TILE_SIZE / 2, y: (y + 1) * TILE_SIZE };
      }
    }
    return { x: spawnX * TILE_SIZE + TILE_SIZE / 2, y: GROUND_LEVEL * TILE_SIZE };
  }
}