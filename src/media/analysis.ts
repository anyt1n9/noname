// 録画ごとの音の大きさの記録を用意する。1本ずつ順番に作り、できた分から画面に出す
import type { TrackFeatures } from '../core/features';
import type { VoiceFeatures } from '../core/fillers';
import { integratedLoudness } from '../core/loudness';
import { combineLevels, PEAK_BIN_SECONDS } from '../core/peaks';
import { voiceTracks, type SourceAudio, type SourceInfo } from '../core/project';
import type { VoiceLevel } from '../core/silence';
import type { AnalysisEvent, AnalysisRequest } from './analysis-worker';
import { levelsKey, loadLevels, saveLevels } from './storage';

export interface TrackLevels {
  peaks: Float32Array;
  rms: Float32Array;
  /** 0〜1。1 ならできあがり */
  progress: number;
  /** できあがったときだけ（大きさ・音色の変わり方など） */
  features?: TrackFeatures;
}

interface Job {
  key: string;
  source: SourceInfo;
  file: File;
}

/** 録画のファイルを見分ける手がかり。作品を作り直すと録画の ID は同じ番号に戻るので、ID では見分けない */
function fileKey(source: SourceInfo): string {
  return `${source.name}:${source.size}:${source.lastModified}`;
}

export class AnalysisStore {
  /** ファイルの手がかり → 音ごとの記録 */
  private entries = new Map<string, (TrackLevels | undefined)[]>();
  private finished = new Set<string>();
  /** 録画の ID → ファイルの手がかり */
  private keys = new Map<string, string>();
  private queue: Job[] = [];
  private requested = new Set<string>();
  private busy = false;

  readonly binSeconds = PEAK_BIN_SECONDS;

  constructor(private onChange: () => void) {}

  /** 録画の音を調べる（すでに調べていれば何もしない） */
  request(source: SourceInfo, file: File): void {
    const key = fileKey(source);
    this.keys.set(source.id, key);
    if (this.requested.has(key)) {
      this.onChange();
      return;
    }
    this.requested.add(key);
    this.queue.push({ key, source, file });
    void this.next();
  }

  track(sourceId: string, index: number): TrackLevels | undefined {
    const key = this.keys.get(sourceId);
    return key === undefined ? undefined : this.entries.get(key)?.[index];
  }

  /** 録画の音をすべて調べ終わったか */
  isFinished(sourceId: string): boolean {
    const key = this.keys.get(sourceId);
    return key !== undefined && this.finished.has(key);
  }

  /** タイムラインに出す波形（声の音。なければ最初の音） */
  waveform(sourceId: string, audio: SourceAudio): TrackLevels | undefined {
    const index = voiceTracks(audio)[0] ?? 0;
    return this.track(sourceId, index);
  }

  /** 「間」を見つけるための声の大きさ。声の音を調べ終わっていなければ undefined */
  voiceLevel(sourceId: string, audio: SourceAudio): VoiceLevel | undefined {
    const indices = voiceTracks(audio);
    if (indices.length === 0) return undefined;
    const levels: Float32Array[] = [];
    for (const i of indices) {
      const t = this.track(sourceId, i);
      if (!t || t.progress < 1) return undefined;
      levels.push(t.rms);
    }
    return { binSeconds: this.binSeconds, rms: combineLevels(levels) };
  }

  /** 口ぐせを見つけるための、声の特徴。声の音を調べ終わっていなければ undefined */
  voiceFeatures(sourceId: string, audio: SourceAudio): VoiceFeatures | undefined {
    const level = this.voiceLevel(sourceId, audio);
    const first = voiceTracks(audio)[0];
    const features = first === undefined ? undefined : this.track(sourceId, first)?.features;
    if (!level || !features) return undefined;
    return { ...level, flux: features.flux, zcr: features.zcr };
  }

  /** 声の大きさ（LUFS）。声の音を調べ終わっていなければ undefined、音がなければ null */
  voiceLoudness(sourceId: string, audio: SourceAudio): number | null | undefined {
    const indices = voiceTracks(audio);
    if (indices.length === 0) return null;
    let sum: Float32Array | null = null;
    for (const i of indices) {
      const loud = this.track(sourceId, i)?.features?.loud;
      if (!loud) return undefined;
      if (!sum) sum = loud.slice();
      else for (let k = 0; k < Math.min(sum.length, loud.length); k++) sum[k] += loud[k];
    }
    return sum ? integratedLoudness(sum, this.binSeconds) : null;
  }

  /** 全体の進み具合（0〜1）。調べる録画がなければ 1 */
  progress(sourceIds: string[]): number {
    if (sourceIds.length === 0) return 1;
    let sum = 0;
    for (const id of sourceIds) {
      const key = this.keys.get(id);
      if (key !== undefined && this.finished.has(key)) {
        sum += 1;
        continue;
      }
      const tracks = (key !== undefined && this.entries.get(key)) || [];
      const values = tracks.map((t) => t?.progress ?? 0);
      sum += values.length ? values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1) : 0;
    }
    return sum / sourceIds.length;
  }

  private set(key: string, index: number, levels: TrackLevels): void {
    const list = this.entries.get(key) ?? [];
    list[index] = levels;
    this.entries.set(key, list);
    this.onChange();
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

  private async build({ key, source, file }: Job): Promise<void> {
    const count = source.audioTrackCount;
    const missing: number[] = [];
    for (let i = 0; i < count; i++) {
      const saved = await loadLevels(levelsKey(source, i));
      if (saved && saved.binSeconds === PEAK_BIN_SECONDS && saved.features) {
        this.set(key, i, { peaks: saved.peaks, rms: saved.rms, progress: 1, features: saved.features });
      } else {
        missing.push(i);
      }
    }
    if (missing.length > 0) {
      await new Promise<void>((resolve) => {
        const worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), { type: 'module' });
        const finish = () => {
          worker.terminate();
          resolve();
        };
        worker.onmessage = (e: MessageEvent<AnalysisEvent>) => {
          const ev = e.data;
          if (ev.type === 'track') {
            this.set(key, ev.track, { peaks: ev.peaks, rms: ev.rms, progress: ev.done ? 1 : ev.progress, features: ev.features });
            if (ev.done && ev.features) {
              void saveLevels(levelsKey(source, ev.track), { binSeconds: PEAK_BIN_SECONDS, peaks: ev.peaks, rms: ev.rms, features: ev.features });
            }
          } else if (ev.type === 'finished') {
            finish();
          } else if (ev.type === 'error') {
            console.warn('音を調べられませんでした', ev.message);
            finish();
          }
        };
        worker.onerror = () => finish();
        const req: AnalysisRequest = { file, endTime: source.endTime, tracks: missing };
        worker.postMessage(req);
      });
    }
    this.finished.add(key);
    this.onChange();
  }
}
