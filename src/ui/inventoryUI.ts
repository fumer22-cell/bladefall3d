import { INVENTORY } from '../config';
import { RECIPES, canCraft, type Recipe, type Station } from '../items/crafting';
import type { Inventory, Stack } from '../items/inventory';
import { ARMOR_SLOT_NAMES } from '../items/items';
import { itemName, stackHTML } from './itemIcon';

const STATION_NAMES: Record<Station, string> = { hand: 'Hands', campfire: 'Campfire', workbench: 'Workbench', forge: 'Forge', anvil: 'Anvil' };
const STATION_ORDER: Station[] = ['hand', 'campfire', 'workbench', 'forge', 'anvil'];

/**
 * Inventory + crafting screen. Click to pick up / put down stacks, right-click for half,
 * shift-click to move between hotbar and backpack. Recipes list what the nearby stations allow.
 */
export class InventoryUI {
  private readonly root: HTMLDivElement;
  private readonly slotEls: HTMLDivElement[] = [];
  private readonly armorEls: HTMLDivElement[] = [];
  private readonly armorStats: HTMLDivElement;
  private readonly recipeList: HTMLDivElement;
  private readonly stationLine: HTMLDivElement;
  private readonly cursorEl: HTMLDivElement;
  private cursor: Stack | null = null;
  private renderedVersion = -1;
  private stations = new Set<Station>(['hand']);
  private stationKey = '';
  private refresh = 0;
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly inv: Inventory,
    private readonly getStations: () => Set<Station>,
    private readonly onCraft: (r: Recipe, times: number) => void,
    private readonly onClose: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'inv-screen';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="inv-panel">
        <div class="inv-left">
          <h2>Inventory</h2>
          <div class="inv-armor"><div class="armor-slots"></div><div class="armor-stats"></div></div>
          <div class="inv-grid backpack"></div>
          <div class="inv-grid hotbar-row"></div>
          <p class="inv-help">Click: pick up / place · Right-click: half · Shift-click: move to hotbar/backpack, or wear armor · E, Tab or Esc: close</p>
        </div>
        <div class="inv-right">
          <h2>Crafting</h2>
          <div class="inv-stations"></div>
          <div class="recipes"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'slot inv-cursor';
    this.root.appendChild(this.cursorEl);
    this.recipeList = this.root.querySelector('.recipes')!;
    this.stationLine = this.root.querySelector('.inv-stations')!;

    this.armorStats = this.root.querySelector('.armor-stats')!;
    const armorRow = this.root.querySelector('.armor-slots')!;
    ARMOR_SLOT_NAMES.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = 'slot armor';
      el.dataset.label = name;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.shiftKey && !this.cursor) this.inv.unequip(i);
        else this.cursor = this.inv.clickArmor(i, this.cursor);
        this.render();
      });
      armorRow.appendChild(el);
      this.armorEls.push(el);
    });
    const backpack = this.root.querySelector('.backpack')!;
    const hotbar = this.root.querySelector('.hotbar-row')!;
    for (let i = 0; i < INVENTORY.SLOTS; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.addEventListener('mousedown', (e) => this.clickSlot(i, e));
      (i < INVENTORY.HOTBAR ? hotbar : backpack).appendChild(el);
      this.slotEls.push(el);
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = `${e.clientX - 23}px`;
      this.cursorEl.style.top = `${e.clientY - 23}px`;
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'KeyE' || e.code === 'Tab' || e.code === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  open(): void {
    this.isOpen = true;
    this.root.hidden = false;
    this.renderedVersion = -1;
    this.refresh = 0;
    this.update(0);
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.cursor) {
      const left = this.inv.add(this.cursor.item, this.cursor.count);
      this.cursor = left > 0 ? { item: this.cursor.item, count: left } : null;
    }
    this.isOpen = false;
    this.root.hidden = true;
    // Called from the key handler, so re-locking the pointer counts as a user gesture.
    this.onClose();
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    this.refresh -= dt;
    if (this.refresh <= 0) {
      this.refresh = 0.5;
      this.stations = this.getStations();
      const key = [...this.stations].sort().join(',');
      if (key !== this.stationKey) {
        this.stationKey = key;
        this.renderedVersion = -1;
      }
    }
    if (this.inv.version === this.renderedVersion) return;
    this.renderedVersion = this.inv.version;
    this.render();
  }

  private clickSlot(i: number, e: MouseEvent): void {
    e.preventDefault();
    if (e.shiftKey && !this.cursor) this.inv.quickMove(i);
    else this.cursor = this.inv.click(i, this.cursor, e.button === 2);
    this.cursorEl.style.left = `${e.clientX - 23}px`;
    this.cursorEl.style.top = `${e.clientY - 23}px`;
    this.render();
  }

  private render(): void {
    this.slotEls.forEach((el, i) => {
      el.innerHTML = stackHTML(this.inv.slots[i]);
      el.title = this.inv.slots[i] ? itemName(this.inv.slots[i]!.item) : '';
      el.classList.toggle('sel', i === this.inv.selected);
    });
    this.armorEls.forEach((el, i) => {
      const a = this.inv.armor[i];
      el.innerHTML = a ? stackHTML(a) : `<span class="armor-label">${ARMOR_SLOT_NAMES[i]}</span>`;
      el.title = a ? itemName(a.item) : `${ARMOR_SLOT_NAMES[i]} armor`;
    });
    this.armorStats.innerHTML = `Armor <b>${Math.round(this.inv.defense() * 100)}%</b><br>Warmth <b>+${this.inv.warmth()}°</b>`;
    this.cursorEl.innerHTML = stackHTML(this.cursor);
    this.cursorEl.hidden = !this.cursor;

    this.stationLine.innerHTML =
      'Nearby: ' +
      STATION_ORDER.map((s) => `<span class="${this.stations.has(s) ? 'on' : 'off'}">${STATION_NAMES[s]}</span>`).join(' ');

    const rows = RECIPES.map((r) => ({ r, ok: canCraft(this.inv, r, this.stations), here: this.stations.has(r.station) }));
    rows.sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.here) - Number(a.here) || STATION_ORDER.indexOf(a.r.station) - STATION_ORDER.indexOf(b.r.station));
    this.recipeList.innerHTML = '';
    for (const { r, ok, here } of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `recipe ${ok ? 'ok' : here ? 'missing' : 'nostation'}`;
      const inputs = r.inputs
        .map((i) => `<span class="${this.inv.count(i.item) >= i.count ? 'have' : 'need'}">${i.count} ${itemName(i.item)}</span>`)
        .join(' · ');
      row.innerHTML = `
        <div class="slot">${stackHTML(r.output)}</div>
        <div class="recipe-text">
          <b>${itemName(r.output.item)}${r.output.count > 1 ? ` ×${r.output.count}` : ''}</b>
          <small>${inputs}</small>
        </div>
        <span class="station">${here ? '' : `needs ${STATION_NAMES[r.station]}`}</span>`;
      row.addEventListener('click', (e) => {
        if (!ok) return;
        this.onCraft(r, e.shiftKey ? 10 : 1);
        this.render();
      });
      this.recipeList.appendChild(row);
    }
  }
}
