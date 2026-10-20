// 文字起こしを始める・やめる（画面側）。AI の部品の大きさを調べ、ダウンロードの了承を覚えておく
import { DTYPE_SUFFIX, MODEL_HOST, type ModelId, type WhisperModel } from '../data/models';
import type { TranscribeEvent, TranscribeRequest } from './transcribe-protocol';

export interface GpuInfo {
  /** グラフィックボードを使った計算（WebGPU）ができるか */
  webgpu: boolean;
  /** 16ビットの計算ができるか（標準の AI に必要） */
  f16: boolean;
}

export async function detectGpu(): Promise<GpuInfo> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return { webgpu: false, f16: false };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { webgpu: false, f16: false };
    return { webgpu: true, f16: adapter.features.has('shader-f16') };
  } catch {
    return { webgpu: false, f16: false };
  }
}

/** このパソコンに合う AI */
export function recommendedModel(gpu: GpuInfo): ModelId {
  return gpu.webgpu && gpu.f16 ? 'standard' : 'light';
}

export function canUseModel(model: WhisperModel, gpu: GpuInfo): boolean {
  return !model.needsGpu || (gpu.webgpu && gpu.f16);
}

/**
 * ダウンロードする大きさ（バイト）を配布元に問い合わせる。分からなければ null。
 * 問い合わせでは、どの AI の部品かだけを伝える（録画や声は送らない）。
 */
export async function fetchModelSize(model: WhisperModel): Promise<number | null> {
  try {
    const res = await fetch(`https://${MODEL_HOST}/api/models/${model.repo}/tree/main/onnx`);
    if (!res.ok) return null;
    const files = (await res.json()) as { path: string; size?: number; lfs?: { size?: number } }[];
    let total = 0;
    for (const [part, dtype] of Object.entries(model.dtype)) {
      const base = `onnx/${part}${DTYPE_SUFFIX[dtype] ?? ''}.onnx`;
      for (const f of files) {
        if (f.path === base || f.path.startsWith(`${base}_data`)) total += f.lfs?.size ?? f.size ?? 0;
      }
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

const CONSENT_KEY = 'teroppa.modelConsent';

/** この AI の部品のダウンロードを、前に了承してもらったか */
export function hasConsent(model: WhisperModel): boolean {
  try {
    return (JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '[]') as string[]).includes(model.repo);
  } catch {
    return false;
  }
}

export function saveConsent(model: WhisperModel): void {
  try {
    const list = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '[]') as string[];
    if (!list.includes(model.repo)) list.push(model.repo);
    localStorage.setItem(CONSENT_KEY, JSON.stringify(list));
  } catch {
    // 覚えられなくても、次にもう一度聞くだけ
  }
}

export class TranscribeJob {
  private worker: Worker;
  private finished = false;

  constructor(private onEvent: (e: TranscribeEvent) => void) {
    this.worker = new Worker(new URL('./transcribe-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<TranscribeEvent>) => {
      const ev = e.data;
      if (ev.type === 'done' || ev.type === 'canceled' || ev.type === 'error') this.finish();
      this.onEvent(ev);
    };
    this.worker.onerror = (e) => {
      this.finish();
      this.onEvent({ type: 'error', message: e.message || '文字起こしの作業場所が止まりました' });
    };
  }

  start(req: Omit<TranscribeRequest, 'type'>): void {
    this.worker.postMessage({ type: 'start', ...req } satisfies TranscribeRequest);
  }

  cancel(): void {
    this.worker.postMessage({ type: 'cancel' });
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    // 次の文字起こしのために、少し待ってから止める（最後の結果を受け取るため）
    setTimeout(() => this.worker.terminate(), 100);
  }
}
