import { ITEMS, getItem, getBlockIdFromSeed, getSeedIdFromBlock, isSeed } from '../data/items';

export const HOTBAR_SIZE = 10;
export const MAX_STACK = 999;

export interface InventorySlot {
  itemId: string | null;
  count: number;
}

export class Inventory {
  public slots: InventorySlot[] = [];
  public selectedIndex = 0;
  private onChangeCallbacks: (() => void)[] = [];

  constructor() {
    this.slots = Array.from({ length: HOTBAR_SIZE }, () => ({ itemId: null, count: 0 }));
    // Give starter items
    this.addItem('dirt_seed', 50);
    this.addItem('cave_seed', 20);
    this.addItem('lava_seed', 5);
    this.addItem('fist', 1);
  }

  onChange(cb: () => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => {
      const idx = this.onChangeCallbacks.indexOf(cb);
      if (idx >= 0) this.onChangeCallbacks.splice(idx, 1);
    };
  }

  private emitChange(): void {
    this.onChangeCallbacks.forEach(cb => cb());
  }

  getSelectedSlot(): InventorySlot {
    return this.slots[this.selectedIndex];
  }

  getSelectedItemId(): string | null {
    return this.slots[this.selectedIndex].itemId;
  }

  selectSlot(index: number): void {
    if (index >= 0 && index < HOTBAR_SIZE) {
      this.selectedIndex = index;
      this.emitChange();
    }
  }

  selectNext(): void {
    this.selectedIndex = (this.selectedIndex + 1) % HOTBAR_SIZE;
    this.emitChange();
  }

  selectPrev(): void {
    this.selectedIndex = (this.selectedIndex - 1 + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.emitChange();
  }

  canAddItem(itemId: string, count: number = 1): boolean {
    const item = getItem(itemId);
    if (!item) return false;

    let remaining = count;
    for (const slot of this.slots) {
      if (slot.itemId === itemId) {
        const space = MAX_STACK - slot.count;
        remaining -= space;
        if (remaining <= 0) return true;
      } else if (slot.itemId === null) {
        remaining -= MAX_STACK;
        if (remaining <= 0) return true;
      }
    }
    return remaining <= 0;
  }

  addItem(itemId: string, count: number = 1): number {
    const item = getItem(itemId);
    if (!item) return 0;

    let remaining = count;
    // Try stack first
    for (const slot of this.slots) {
      if (slot.itemId === itemId && slot.count < MAX_STACK) {
        const space = MAX_STACK - slot.count;
        const add = Math.min(space, remaining);
        slot.count += add;
        remaining -= add;
        if (remaining <= 0) {
          this.emitChange();
          return count;
        }
      }
    }
    // New slots
    for (const slot of this.slots) {
      if (slot.itemId === null) {
        const add = Math.min(MAX_STACK, remaining);
        slot.itemId = itemId;
        slot.count = add;
        remaining -= add;
        if (remaining <= 0) {
          this.emitChange();
          return count;
        }
      }
    }
    this.emitChange();
    return count - remaining;
  }

  removeItem(itemId: string, count: number = 1): number {
    let remaining = count;
    for (const slot of this.slots) {
      if (slot.itemId === itemId) {
        const remove = Math.min(slot.count, remaining);
        slot.count -= remove;
        remaining -= remove;
        if (slot.count <= 0) {
          slot.itemId = null;
          slot.count = 0;
        }
        if (remaining <= 0) {
          this.emitChange();
          return count;
        }
      }
    }
    this.emitChange();
    return count - remaining;
  }

  consumeSelected(count: number = 1): boolean {
    const slot = this.getSelectedSlot();
    if (!slot.itemId || slot.count < count) return false;
    slot.count -= count;
    if (slot.count <= 0) {
      slot.itemId = null;
      slot.count = 0;
    }
    this.emitChange();
    return true;
  }

  getCount(itemId: string): number {
    return this.slots
      .filter(s => s.itemId === itemId)
      .reduce((sum, s) => sum + s.count, 0);
  }

  hasItem(itemId: string, count: number = 1): boolean {
    return this.getCount(itemId) >= count;
  }

  clear(): void {
    this.slots.forEach(s => { s.itemId = null; s.count = 0; });
    this.emitChange();
  }

  // For saving
  serialize(): InventorySlot[] {
    return this.slots.map(s => ({ ...s }));
  }

  // For loading
  deserialize(data: InventorySlot[]): void {
    this.slots = data.map(s => ({ ...s }));
    this.emitChange();
  }
}