import { SAVE } from '../config';
import { metaOf, type SaveData, type SaveMeta } from './serialize';

const STORE = 'saves';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(SAVE.DB_NAME, SAVE.DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Save database is blocked by another tab.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** Saves live in this browser's IndexedDB. Every call rejects if storage is unavailable. */
export const saveDb = {
  async list(): Promise<SaveMeta[]> {
    const all = await tx<SaveData[]>('readonly', (s) => s.getAll() as IDBRequest<SaveData[]>);
    return all.map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get(id: string): Promise<SaveData | undefined> {
    return tx<SaveData | undefined>('readonly', (s) => s.get(id) as IDBRequest<SaveData | undefined>);
  },
  async put(data: SaveData): Promise<void> {
    await tx('readwrite', (s) => s.put(data));
  },
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  },
};
