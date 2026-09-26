import { INVENTORY } from '../config';
import { ITEMS } from './items';

export interface Stack {
  item: string;
  count: number;
}

/** Slots 0..HOTBAR-1 are the hotbar; the rest is the backpack. */
export class Inventory {
  readonly slots: (Stack | null)[];
  selected = 0;
  /** Bumped on every change so UIs can re-render lazily. */
  version = 0;

  constructor(size: number = INVENTORY.SLOTS) {
    this.slots = new Array(size).fill(null);
  }

  get held(): Stack | null {
    return this.slots[this.selected];
  }

  select(i: number): void {
    this.selected = ((i % INVENTORY.HOTBAR) + INVENTORY.HOTBAR) % INVENTORY.HOTBAR;
    this.version++;
  }

  count(item: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.count;
    return n;
  }

  /** Add items (filling existing stacks, then empty slots, hotbar first). Returns how many didn't fit. */
  add(item: string, count: number): number {
    const max = ITEMS[item]?.maxStack ?? INVENTORY.MAX_STACK;
    for (const s of this.slots) {
      if (count <= 0) break;
      if (!s || s.item !== item || s.count >= max) continue;
      const n = Math.min(count, max - s.count);
      s.count += n;
      count -= n;
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(count, max);
      this.slots[i] = { item, count: n };
      count -= n;
    }
    this.version++;
    return count;
  }

  /** Remove up to `count` items; returns how many were removed. */
  remove(item: string, count: number): number {
    let removed = 0;
    // Take from the backpack first so hotbar stacks last longer.
    for (let k = this.slots.length - 1; k >= 0 && removed < count; k--) {
      const s = this.slots[k];
      if (!s || s.item !== item) continue;
      const n = Math.min(s.count, count - removed);
      s.count -= n;
      removed += n;
      if (s.count === 0) this.slots[k] = null;
    }
    this.version++;
    return removed;
  }

  /** Use one of the held item (e.g. placing a block). */
  consumeHeld(): void {
    const s = this.held;
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.version++;
  }

  /**
   * Minecraft-style click on a slot with a "cursor" stack: pick up, put down, merge or swap.
   * `half` (right click) picks up half a stack or puts down one item. Returns the new cursor.
   */
  click(i: number, cursor: Stack | null, half = false): Stack | null {
    const slot = this.slots[i];
    this.version++;
    if (!cursor) {
      if (!slot) return null;
      if (!half) {
        this.slots[i] = null;
        return slot;
      }
      const take = Math.ceil(slot.count / 2);
      slot.count -= take;
      if (slot.count === 0) this.slots[i] = null;
      return { item: slot.item, count: take };
    }
    const max = ITEMS[cursor.item]?.maxStack ?? INVENTORY.MAX_STACK;
    if (!slot) {
      const n = half ? 1 : cursor.count;
      this.slots[i] = { item: cursor.item, count: n };
      cursor.count -= n;
      return cursor.count > 0 ? cursor : null;
    }
    if (slot.item === cursor.item) {
      const n = Math.min(half ? 1 : cursor.count, max - slot.count);
      slot.count += n;
      cursor.count -= n;
      return cursor.count > 0 ? cursor : null;
    }
    this.slots[i] = cursor;
    return slot;
  }

  /** Shift-click: move a stack between the hotbar and the backpack. */
  quickMove(i: number): void {
    const s = this.slots[i];
    if (!s) return;
    const toHotbar = i >= INVENTORY.HOTBAR;
    const [lo, hi] = toHotbar ? [0, INVENTORY.HOTBAR] : [INVENTORY.HOTBAR, this.slots.length];
    const max = ITEMS[s.item]?.maxStack ?? INVENTORY.MAX_STACK;
    for (let k = lo; k < hi && s.count > 0; k++) {
      const t = this.slots[k];
      if (t && t.item === s.item && t.count < max) {
        const n = Math.min(s.count, max - t.count);
        t.count += n;
        s.count -= n;
      }
    }
    for (let k = lo; k < hi && s.count > 0; k++) {
      if (this.slots[k]) continue;
      this.slots[k] = { item: s.item, count: s.count };
      s.count = 0;
    }
    if (s.count === 0) this.slots[i] = null;
    this.version++;
  }

  serialize(): (Stack | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  load(data: (Stack | null)[], selected = 0): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = data[i];
      this.slots[i] = s && ITEMS[s.item] && s.count > 0 ? { item: s.item, count: s.count } : null;
    }
    this.selected = selected;
    this.version++;
  }
}
