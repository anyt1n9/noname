// 録画ごとの音の形（波形）を用意する。1本ずつ順番に作り、できた分から画面に出す
import { PEAK_BIN_SECONDS } from '../core/peaks';
import type { SourceInfo } from '../core/project';
import type { PeaksEvent, PeaksRequest } from './peaks-worker';
import { loadPeaks, peaksKey, savePeaks } from './storage';

export interface PeaksEntry {
  peaks: Float32Array;
  /** 0〜1。1 ならできあがり */
  progress: number;
}

interface Job {
  source: SourceInfo;
  file: File;
}

export class PeaksStore {
  private entries = new Map<string, PeaksEntry>();
  private queue: Job[] = [];
  private requested = new Set<string>();
  private busy = false;

  constructor(private onChange: () => void) {}

  readonly binSeconds = PEAK_BIN_SECONDS;

  get(sourceId: string): PeaksEntry | undefined {
    return this.entries.get(sourceId);
  }

  /** 録画の波形を用意する（すでに用意していれば何もしない） */
  request(source: SourceInfo, file: File): void {
    if (this.requested.has(source.id)) return;
    this.requested.add(source.id);
    this.queue.push({ source, file });
    void this.next();
  }

  private async next(): Promise<void> {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      await this.build(job);
    } finally {
      this.busy = false;
      void this.next();
    }
  }

  private async build({ source, file }: Job): Promise<void> {
    const key = peaksKey(source.name, source.size, source.lastModified);
    const saved = await loadPeaks(key);
    if (saved && saved.binSeconds === PEAK_BIN_SECONDS) {
      this.entries.set(source.id, { peaks: saved.peaks, progress: 1 });
      this.onChange();
      return;
    }
    await new Promise<void>((resolve) => {
      const worker = new Worker(new URL('./peaks-worker.ts', import.meta.url), { type: 'module' });
      const finish = () => {
        worker.terminate();
        resolve();
      };
      worker.onmessage = (e: MessageEvent<PeaksEvent>) => {
        const ev = e.data;
        if (ev.type === 'partial') {
          this.entries.set(source.id, { peaks: ev.peaks, progress: ev.progress });
          this.onChange();
        } else if (ev.type === 'done') {
          this.entries.set(source.id, { peaks: ev.peaks, progress: 1 });
          this.onChange();
          void savePeaks(key, { binSeconds: PEAK_BIN_SECONDS, peaks: ev.peaks });
          finish();
        } else {
          if (ev.type === 'error') console.warn('音の形を作れませんでした', ev.message);
          finish();
        }
      };
      worker.onerror = () => finish();
      const req: PeaksRequest = { file, endTime: source.endTime };
      worker.postMessage(req);
    });
  }
}
