// プレビューで鳴らす BGM・効果音の用意。作った音は覚えておき、2回目からはすぐ鳴らす
import { renderSound } from '../core/sfx';
import type { SoundId } from '../data/sfx';
import { assetBlob } from './assets';
import type { SoundRequest, SoundResponse } from './sound-worker';

/** プレビュー用の音の速さ（パソコンの設定が違っても、ブラウザが合わせて鳴らす） */
const RATE = 48000;

let worker: Worker | null = null;
let nextRequest = 1;
const waiting = new Map<number, (r: SoundResponse) => void>();

function renderInWorker(trackId: string): Promise<SoundResponse> {
  if (!worker) {
    worker = new Worker(new URL('./sound-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SoundResponse>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
  }
  const id = nextRequest++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, trackId, sampleRate: RATE } satisfies SoundRequest);
  });
}

const musicCache = new Map<string, Promise<AudioBuffer | null>>();
const effectCache = new Map<SoundId, AudioBuffer>();

/** 入っている曲（くり返し1回分） */
export function builtinMusic(trackId: string): Promise<AudioBuffer | null> {
  let p = musicCache.get(`builtin:${trackId}`);
  if (!p) {
    p = renderInWorker(trackId).then((r) => {
      if (!r.ok) return null;
      const buffer = new AudioBuffer({ length: r.left.length, numberOfChannels: 2, sampleRate: RATE });
      buffer.copyToChannel(r.left as Float32Array<ArrayBuffer>, 0);
      buffer.copyToChannel(r.right as Float32Array<ArrayBuffer>, 1);
      return buffer;
    });
    musicCache.set(`builtin:${trackId}`, p);
  }
  return p;
}

/** 自分で用意した曲 */
export function assetMusic(assetId: string): Promise<AudioBuffer | null> {
  let p = musicCache.get(`asset:${assetId}`);
  if (!p) {
    p = (async () => {
      const blob = await assetBlob(assetId);
      if (!blob) return null;
      const ctx = new OfflineAudioContext(2, 1, RATE);
      return ctx.decodeAudioData(await blob.arrayBuffer());
    })().catch(() => null);
    musicCache.set(`asset:${assetId}`, p);
  }
  return p;
}

/** 効果音（短いので、その場で作る） */
export function effectBuffer(sound: SoundId): AudioBuffer {
  let buffer = effectCache.get(sound);
  if (!buffer) {
    const data = renderSound(sound, RATE);
    buffer = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: RATE });
    buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    effectCache.set(sound, buffer);
  }
  return buffer;
}
