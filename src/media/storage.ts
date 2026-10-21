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

async function remove(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    for (const key of keys) tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function keysWithPrefix(prefix: string): Promise<string[]> {
  const d = await db();
  return new Promise<string[]>((resolve, reject) => {
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys(range);
    req.onsuccess = () => resolve(req.result.map(String));
    req.onerror = () => reject(req.error);
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

/** 音の大きさの記録の保存。同じ録画なら作り直さない */
export interface SavedLevels {
  binSeconds: number;
  peaks: Float32Array;
  rms: Float32Array;
}

/** 録画（名前・大きさ・更新日時）と音の番号で、記録を見分ける */
export function levelsKey(source: { name: string; size: number; lastModified: number }, track: number): string {
  return `levels:v2:${source.name}:${source.size}:${source.lastModified}:${track}`;
}

export async function saveLevels(key: string, value: SavedLevels): Promise<void> {
  await put(key, value).catch(() => undefined);
}

export async function loadLevels(key: string): Promise<SavedLevels | null> {
  try {
    return (await get<SavedLevels>(key)) ?? null;
  } catch {
    return null;
  }
}

/** 画像・曲の中身。作品のデータとは別に、中身の手がかり（id）で保存する */
const ASSET_PREFIX = 'asset:';

export async function saveAssetBlob(id: string, blob: Blob): Promise<void> {
  await put(`${ASSET_PREFIX}${id}`, blob);
}

export async function loadAssetBlob(id: string): Promise<Blob | null> {
  try {
    return (await get<Blob>(`${ASSET_PREFIX}${id}`)) ?? null;
  } catch {
    return null;
  }
}

/** keep 以外の画像・曲の中身を消す（作品から外したもの） */
export async function removeAssetsExcept(keep: Set<string>): Promise<void> {
  try {
    const keys = await keysWithPrefix(ASSET_PREFIX);
    await remove(keys.filter((k) => !keep.has(k.slice(ASSET_PREFIX.length))));
  } catch {
    // 消せなくても困らない
  }
}
