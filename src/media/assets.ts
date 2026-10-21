// 画像・曲を作品に入れる。中身はブラウザの中（IndexedDB）に保存し、作品ファイルにも入れる
import type { AssetData } from '../core/project-file';
import type { Asset } from '../core/project';
import { IMAGE_EXTENSIONS, IMAGE_TYPES, MAX_IMAGE_BYTES } from '../data/images';
import { MAX_MUSIC_BYTES, MAX_MUSIC_SECONDS, MUSIC_EXTENSIONS } from '../data/music';
import { formatBytes } from '../core/time';
import { openInput } from './probe';
import { loadAssetBlob, removeAssetsExcept, saveAssetBlob } from './storage';

/** 開いている間の中身の置き場（id → 中身） */
const blobs = new Map<string, Blob>();

/** 中身から手がかり（SHA-256 の16進数）を作る。同じファイルなら同じ id になる */
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type AssetResult = { ok: true; asset: Asset; blob: Blob } | { ok: false; reason: string };

/** 画像を調べて、作品に入れられる形にする */
export async function readImageFile(file: File): Promise<AssetResult> {
  if (!IMAGE_TYPES.includes(file.type) && !IMAGE_EXTENSIONS.test(file.name)) {
    return { ok: false, reason: '読み込める画像は PNG・JPEG・WebP です。' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `画像が大きすぎます（${formatBytes(MAX_IMAGE_BYTES)}まで）。` };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const asset: Asset = {
      id: await hashBlob(file),
      kind: 'image',
      name: file.name,
      type: file.type || 'image/png',
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
      duration: 0,
    };
    bitmap.close();
    return { ok: true, asset, blob: file };
  } catch {
    return { ok: false, reason: '画像を読み取れませんでした。壊れているか、読めない形式です。' };
  }
}

/** 曲を調べて、作品に入れられる形にする */
export async function readMusicFile(file: File): Promise<AssetResult> {
  if (!MUSIC_EXTENSIONS.test(file.name) && !file.type.startsWith('audio/')) {
    return { ok: false, reason: '読み込める曲は MP3・M4A・WAV・OGG・FLAC などです。' };
  }
  if (file.size > MAX_MUSIC_BYTES) {
    return { ok: false, reason: `曲のファイルが大きすぎます（${formatBytes(MAX_MUSIC_BYTES)}まで）。` };
  }
  const input = openInput(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return { ok: false, reason: 'このファイルの音は読めませんでした。' };
    const duration = await input.computeDuration();
    if (!(duration > 0.5)) return { ok: false, reason: '曲が短すぎます。' };
    if (duration > MAX_MUSIC_SECONDS) return { ok: false, reason: `曲が長すぎます（${MAX_MUSIC_SECONDS / 60}分まで）。` };
    const asset: Asset = {
      id: await hashBlob(file),
      kind: 'music',
      name: file.name,
      type: file.type || 'audio/mpeg',
      size: file.size,
      width: 0,
      height: 0,
      duration,
    };
    return { ok: true, asset, blob: file };
  } catch {
    return { ok: false, reason: '曲を読み取れませんでした。壊れているか、読めない形式です。' };
  } finally {
    input.dispose();
  }
}

/** 中身を覚え、ブラウザの中にも保存する */
export async function keepAsset(id: string, blob: Blob): Promise<void> {
  blobs.set(id, blob);
  await saveAssetBlob(id, blob).catch((e) => console.warn('画像・曲を保存できませんでした', e));
}

/** 中身を取り出す。なければ null */
export async function assetBlob(id: string): Promise<Blob | null> {
  const cached = blobs.get(id);
  if (cached) return cached;
  const saved = await loadAssetBlob(id);
  if (saved) blobs.set(id, saved);
  return saved;
}

/** 作品で使っていない中身を、ブラウザの中から消す */
export async function forgetAssetsExcept(keep: Set<string>): Promise<void> {
  for (const id of [...blobs.keys()]) if (!keep.has(id)) blobs.delete(id);
  await removeAssetsExcept(keep);
}

/** 作品ファイルに入れるため、中身を文字（base64）にする */
export async function encodeAssets(assets: Asset[]): Promise<{ data: AssetData; missing: Asset[] }> {
  const data: AssetData = {};
  const missing: Asset[] = [];
  for (const asset of assets) {
    const blob = await assetBlob(asset.id);
    if (!blob) {
      missing.push(asset);
      continue;
    }
    data[asset.id] = await toBase64(blob);
  }
  return { data, missing };
}

/** 作品ファイルに入っていた中身を取り出して保存する。中身がなかった画像・曲を返す */
export async function decodeAssets(assets: Asset[], data: AssetData): Promise<Asset[]> {
  const missing: Asset[] = [];
  for (const asset of assets) {
    const text = data[asset.id];
    if (!text) {
      if (!(await assetBlob(asset.id))) missing.push(asset);
      continue;
    }
    await keepAsset(asset.id, fromBase64(text, asset.type));
  }
  return missing;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function fromBase64(text: string, type: string): Blob {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
