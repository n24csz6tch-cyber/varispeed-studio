/** Everything kept on this device: finished versions and the audio you brought in. */

const DB_NAME = 'varispeed-library';
const VERSIONS = 'versions';
const SOURCES = 'sources';
const VERSION = 2;

export interface SavedVersion {
  id: string;
  name: string;
  detail: string;
  duration: number;
  bytes: number;
  createdAt: number;
  blob: Blob;
}

export interface SavedSource {
  id: string;
  name: string;
  bytes: number;
  createdAt: number;
  origin: 'upload' | 'search';
  blob: Blob;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VERSIONS)) db.createObjectStore(VERSIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The library could not be opened.'));
  });
}

function readAll<T>(store: string): Promise<T[]> {
  return openDatabase().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error ?? new Error('The library could not be read.'));
      }),
  );
}

function put(store: string, value: unknown): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('That item could not be saved.'));
      }),
  );
}

function remove(store: string, id: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('That item could not be removed.'));
      }),
  );
}

export async function listVersions(): Promise<SavedVersion[]> {
  const rows = await readAll<SavedVersion>(VERSIONS);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export function saveVersion(version: SavedVersion): Promise<void> {
  return put(VERSIONS, version);
}

export function deleteVersion(id: string): Promise<void> {
  return remove(VERSIONS, id);
}

export async function listSources(): Promise<SavedSource[]> {
  const rows = await readAll<SavedSource>(SOURCES);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export function saveSource(source: SavedSource): Promise<void> {
  return put(SOURCES, source);
}

export function deleteSource(id: string): Promise<void> {
  return remove(SOURCES, id);
}
