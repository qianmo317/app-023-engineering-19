// 曲目与设置持久化 —— IndexedDB，刷新后不丢
import type { AppSettings, Score } from '../types';

const DB_NAME = 'app023-percussion';
const DB_VERSION = 1;
const STORE_SCORES = 'scores';
const STORE_SETTINGS = 'settings';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SCORES)) {
        const store = db.createObjectStore(STORE_SCORES, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function listScores(): Promise<Score[]> {
  const all = await tx<Score[]>(STORE_SCORES, 'readonly', (s) => s.getAll() as IDBRequest<Score[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getScore(id: string): Promise<Score | undefined> {
  return tx<Score | undefined>(STORE_SCORES, 'readonly', (s) => s.get(id) as IDBRequest<Score | undefined>);
}

export async function saveScore(score: Score): Promise<void> {
  await tx(STORE_SCORES, 'readwrite', (s) => s.put(score));
}

export async function deleteScore(id: string): Promise<void> {
  await tx(STORE_SCORES, 'readwrite', (s) => s.delete(id));
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await tx(STORE_SETTINGS, 'readwrite', (s) => s.put({ id: 'app', ...settings }));
}

export async function loadSettings(): Promise<AppSettings | undefined> {
  const rec = await tx<{ id: string } & AppSettings | undefined>(
    STORE_SETTINGS,
    'readonly',
    (s) => s.get('app') as IDBRequest<{ id: string } & AppSettings | undefined>,
  );
  if (!rec) return undefined;
  const { id: _id, ...settings } = rec;
  return settings;
}

export function newId(): string {
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
