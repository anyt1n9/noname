// 書き出しの設定を決める計算
import type { QualityPreset } from '../data/quality';
import type { Project } from './project';
import { clipLength, totalDuration } from './timeline';

/** よく使われるコマ数。これに近ければ合わせる */
const STANDARD_FRAME_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120];

export const DEFAULT_FRAME_RATE = 30;

/** 測ったコマ数を、近いよく使われる値に直す（1%以内なら合わせる） */
export function normalizeFrameRate(measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return DEFAULT_FRAME_RATE;
  let best = STANDARD_FRAME_RATES[0];
  for (const fps of STANDARD_FRAME_RATES) {
    if (Math.abs(measured - fps) < Math.abs(measured - best)) best = fps;
  }
  if (Math.abs(measured - best) / best <= 0.01) return best;
  return Math.min(120, Math.max(1, Math.round(measured)));
}

/**
 * 書き出すコマ数を決める。録画ごとに違うときは、タイムラインで一番長く使われている録画に合わせる。
 */
export function chooseFrameRate(project: Project): number {
  const used = new Map<string, number>();
  for (const c of project.clips) used.set(c.sourceId, (used.get(c.sourceId) ?? 0) + clipLength(c));
  let best: string | null = null;
  let bestLength = -1;
  for (const s of project.sources) {
    const length = used.get(s.id) ?? 0;
    if (length > bestLength) {
      best = s.id;
      bestLength = length;
    }
  }
  const source = project.sources.find((s) => s.id === best);
  return normalizeFrameRate(source?.frameRate ?? DEFAULT_FRAME_RATE);
}

export interface ExportPlan {
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: number;
  audioBitrate: number;
  /** 完成した動画の長さ（秒） */
  duration: number;
  /** 書き出すコマの数 */
  frameCount: number;
  /** ファイルの大きさの目安（バイト） */
  estimatedBytes: number;
}

/** MP4 の入れ物の分などの上乗せ */
const CONTAINER_OVERHEAD = 1.02;

export function planExport(project: Project, preset: QualityPreset): ExportPlan {
  const frameRate = chooseFrameRate(project);
  const duration = totalDuration(project);
  const videoBitrate = frameRate > 30.5 ? preset.videoBitrateHighFps : preset.videoBitrate;
  const audioBitrate = preset.audioBitrate;
  return {
    width: preset.width,
    height: preset.height,
    frameRate,
    videoBitrate,
    audioBitrate,
    duration,
    frameCount: frameCount(duration, frameRate),
    estimatedBytes: Math.round(((videoBitrate + audioBitrate) * duration * CONTAINER_OVERHEAD) / 8),
  };
}

/** 長さ duration 秒を frameRate で書き出したときのコマの数 */
export function frameCount(duration: number, frameRate: number): number {
  return Math.max(0, Math.ceil(duration * frameRate - 1e-6));
}

/**
 * 書き出しにかかる時間の目安（秒）。前回の書き出しの速さ（動画の1秒を何秒で書き出せたか）が
 * 分かっていれば、それをもとにする。分からなければ null。
 */
export function estimateExportSeconds(duration: number, secondsPerVideoSecond: number | null): number | null {
  if (secondsPerVideoSecond === null || !(secondsPerVideoSecond > 0)) return null;
  return duration * secondsPerVideoSecond;
}

/** 書き出し中の残り時間の目安（秒）。進み具合が少ないうちは null */
export function remainingSeconds(elapsed: number, progress: number): number | null {
  if (progress < 0.02 || elapsed < 2) return null;
  return (elapsed / progress) * (1 - progress);
}
