import { WORLD } from '../config';
import { saveDb } from '../save/db';
import { newSave, type SaveData, type SaveMeta } from '../save/serialize';

export type MenuChoice = { type: 'play'; save: SaveData; persist: boolean } | { type: 'arena' };

function seedFrom(text: string): number {
  const t = text.trim();
  if (!t) return WORLD.SEED || Math.floor(Math.random() * 2 ** 31);
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h | 0;
}

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function playTime(s: number): string {
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min played` : `${Math.floor(m / 60)} h ${m % 60} min played`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Title screen: create a world, continue or delete saves, or open the test arena. */
export function showMainMenu(root: HTMLElement): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'menu';
    el.innerHTML = `
      <div class="menu-panel">
        <h1>BLADEFALL</h1>
        <p class="tag">A dark fantasy of blade and block</p>
        <section>
          <h3>New world</h3>
          <form class="new">
            <input id="world-name" name="name" placeholder="World name" maxlength="32" autocomplete="off" />
            <input id="world-seed" name="seed" placeholder="Seed (optional)" maxlength="24" autocomplete="off" />
            <button type="submit">Create</button>
          </form>
        </section>
        <section>
          <h3>Your worlds</h3>
          <div class="saves"><p class="empty">Loading saves…</p></div>
        </section>
        <button type="button" class="arena">Open the movement & combat test arena</button>
      </div>`;
    root.appendChild(el);
    let persist = true;

    const finish = (c: MenuChoice) => {
      el.remove();
      resolve(c);
    };

    el.querySelector('form.new')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = (f.elements.namedItem('name') as HTMLInputElement).value;
      const seed = seedFrom((f.elements.namedItem('seed') as HTMLInputElement).value);
      finish({ type: 'play', save: newSave(name, seed), persist });
    });
    el.querySelector('.arena')!.addEventListener('click', () => finish({ type: 'arena' }));

    const list = el.querySelector('.saves') as HTMLDivElement;
    const render = (saves: SaveMeta[]) => {
      if (saves.length === 0) {
        list.innerHTML = '<p class="empty">No saved worlds yet. Create one above.</p>';
        return;
      }
      list.innerHTML = '';
      for (const s of saves) {
        const row = document.createElement('div');
        row.className = 'save';
        row.innerHTML = `
          <div class="info"><b>${esc(s.name)}</b><small>Seed ${s.seed} · ${playTime(s.playTime)} · saved ${ago(s.updatedAt)}</small></div>
          <button type="button" class="play">Play</button>
          <button type="button" class="danger del">Delete</button>`;
        row.querySelector('.play')!.addEventListener('click', async () => {
          const data = await saveDb.get(s.id).catch(() => undefined);
          if (data) finish({ type: 'play', save: data, persist: true });
        });
        const del = row.querySelector('.del') as HTMLButtonElement;
        let armed = false;
        del.addEventListener('click', async () => {
          if (!armed) {
            armed = true;
            del.textContent = 'Really delete?';
            setTimeout(() => {
              armed = false;
              del.textContent = 'Delete';
            }, 3000);
            return;
          }
          await saveDb.remove(s.id).catch(() => {});
          render(await saveDb.list().catch(() => []));
        });
        list.appendChild(row);
      }
    };
    saveDb
      .list()
      .then(render)
      .catch(() => {
        persist = false;
        list.innerHTML =
          "<p class=\"note\">Saving isn't available in this browser (storage is blocked), so worlds won't be kept after you close the page.</p>";
      });
  });
}
