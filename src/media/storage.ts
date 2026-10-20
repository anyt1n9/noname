// ブラウザの中への自動保存（IndexedDB）。編集内容と、録画の場所（ファイルの手がかり）だけを保存する
import type { Project } from '../core/project';
import { readProject } from '../core/project-file';

const DB_NAME = 'teroppa';
const DB_VERSION = 1;
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= openDb();
  return dbPromise;
}

async function put(key: string, value: unknown): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise<T | undefined>((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export interface SavedWork {
  project: Project;
  /** 録画の ID → ファイルの手がかり */
  handles: Record<string, FileSystemFileHandle>;
}

export async function saveWork(work: SavedWork): Promise<void> {
  await put('work', { project: work.project, handles: work.handles });
}

/** 自動保存した作品を読む。なければ（または壊れていれば）null */
export async function loadWork(): Promise<SavedWork | null> {
  try {
    const raw = await get<{ project: unknown; handles: Record<string, FileSystemFileHandle> }>('work');
    if (!raw) return null;
    const project = readProject(raw.project);
    if (!project) return null;
    return { project, handles: raw.handles ?? {} };
  } catch {
    return null;
  }
}

/** 音の形（波形）の保存。同じ録画なら作り直さない */
export interface SavedPeaks {
  binSeconds: number;
  peaks: Float32Array;
}

export function peaksKey(name: string, size: number, lastModified: number): string {
  return `peaks:${name}:${size}:${lastModified}`;
}

export async function savePeaks(key: string, value: SavedPeaks): Promise<void> {
  await put(key, value).catch(() => undefined);
}

export async function loadPeaks(key: string): Promise<SavedPeaks | null> {
  try {
    return (await get<SavedPeaks>(key)) ?? null;
  } catch {
    return null;
  }
}
