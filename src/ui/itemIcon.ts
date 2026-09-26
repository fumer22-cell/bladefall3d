import type { Stack } from '../items/inventory';
import { ITEMS } from '../items/items';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Inner HTML for an inventory/hotbar slot showing a stack. */
export function stackHTML(s: Stack | null): string {
  if (!s) return '';
  const d = ITEMS[s.item];
  if (!d) return '';
  const count = s.count > 1 ? `<span class="count">${s.count}</span>` : '';
  const abbr = d.abbr ? `<span class="abbr">${d.abbr}</span>` : '';
  const kind = d.block !== undefined && d.id === 'torch' ? 'torch' : d.kind;
  return `<div class="icon ${kind}" style="--c:${hex(d.color)}">${abbr}</div>${count}`;
}

export function itemName(id: string): string {
  return ITEMS[id]?.name ?? id;
}
