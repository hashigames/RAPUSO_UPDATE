import type { PortableProjectManifest } from '../../shared/studio';
import type { PortableCharacterManifest } from '../../shared/characters';

const DB_NAME = 'rapuso_studio_db';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';
const KEY_PROJECT_DRAFT = 'rapuso_current_project_v2';
const KEY_LOCAL_CHARACTERS = 'rapuso_local_characters_v1';
const KEY_LOCAL_RASTERS = 'rapuso_local_rasters_v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBinaryBlobLocally(key: string, data: Blob | ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    const blob = data instanceof Blob ? data : new Blob([data]);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      tx.objectStore(STORE_BLOBS).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Graceful fallback if IndexedDB disabled in private browsing
  }
}

export async function loadBinaryBlobLocally(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const req = tx.objectStore(STORE_BLOBS).get(key);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export function saveProjectDraftLocally(manifest: PortableProjectManifest): void {
  try {
    localStorage.setItem(KEY_PROJECT_DRAFT, JSON.stringify(manifest));
  } catch {
    // ignore storage quota errors gracefully
  }
}

export function loadProjectDraftLocally(): PortableProjectManifest | null {
  try {
    const raw = localStorage.getItem(KEY_PROJECT_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw) as PortableProjectManifest;
  } catch {
    return null;
  }
}

export function saveLocalCharacterManifests(list: PortableCharacterManifest[]): void {
  try {
    localStorage.setItem(KEY_LOCAL_CHARACTERS, JSON.stringify(list));
  } catch {
    // ignore quota issues
  }
}

export function loadLocalCharacterManifests(): PortableCharacterManifest[] {
  try {
    const raw = localStorage.getItem(KEY_LOCAL_CHARACTERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalRastersList(items: unknown[]): void {
  try {
    localStorage.setItem(KEY_LOCAL_RASTERS, JSON.stringify(items.slice(0, 24)));
  } catch {
    // ignore
  }
}

export function loadLocalRastersList<T>(): T[] {
  try {
    const raw = localStorage.getItem(KEY_LOCAL_RASTERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
