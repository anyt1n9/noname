// つなぎ目のフェード（v0.5）。つなぎ目の前で暗く・静かになり、後ろで明るく・元の大きさに戻る
import { END_FADE_SECONDS, JOIN_FADE_SECONDS } from '../data/fades';
import type { Project } from './project';
import { clipLength, clipStarts, totalDuration } from './timeline';

/** 明るさ（音の大きさ）が変わる区間。from で level0、to で level1 */
export interface FadeWindow {
  from: number;
  to: number;
  level0: number;
  level1: number;
}

let memo: { clips: Project['clips']; joinFades: string[]; endFade: boolean; windows: FadeWindow[] } | null = null;

/** フェードの区間（時刻の順） */
export function fadeWindows(project: Project): FadeWindow[] {
  if (memo && memo.clips === project.clips && memo.joinFades === project.joinFades && memo.endFade === project.endFade) {
    return memo.windows;
  }
  const windows: FadeWindow[] = [];
  const fades = new Set(project.joinFades);
  const starts = clipStarts(project);
  project.clips.forEach((clip, i) => {
    if (!fades.has(clip.id)) return;
    const t = starts[i];
    if (i > 0) {
      const d = Math.min(JOIN_FADE_SECONDS, clipLength(project.clips[i - 1]) / 2);
      windows.push({ from: t - d, to: t, level0: 1, level1: 0 });
    }
    const d = Math.min(JOIN_FADE_SECONDS, clipLength(clip) / 2);
    windows.push({ from: t, to: t + d, level0: 0, level1: 1 });
  });
  if (project.endFade && project.clips.length > 0) {
    const total = totalDuration(project);
    const d = Math.min(END_FADE_SECONDS, clipLength(project.clips[project.clips.length - 1]) / 2);
    // 最後のかたまりの始まりのフェードと重なるときは、後ろにずらす
    const last = windows[windows.length - 1];
    const from = Math.max(total - d, last ? last.to : 0);
    if (total - from > 0.01) windows.push({ from, to: total, level0: 1, level1: 0 });
  }
  windows.sort((a, b) => a.from - b.from);
  memo = { clips: project.clips, joinFades: project.joinFades, endFade: project.endFade, windows };
  return windows;
}

/** 時刻 t の明るさ（音の大きさ）。1 でそのまま、0 で真っ暗・無音 */
export function fadeLevel(project: Project, t: number): number {
  const windows = fadeWindows(project);
  for (const w of windows) {
    if (t < w.from) break;
    if (t < w.to) return w.level0 + ((w.level1 - w.level0) * (t - w.from)) / (w.to - w.from);
  }
  return 1;
}

/**
 * 完成した動画の from 秒から count サンプル分の、音の大きさの倍率。
 * フェードがかからない範囲なら null（そのまま使えばよい）。
 */
export function fadeGains(project: Project, from: number, count: number, sampleRate: number): Float32Array | null {
  const to = from + count / sampleRate;
  const windows = fadeWindows(project).filter((w) => w.to > from && w.from < to);
  if (windows.length === 0) return null;
  const gains = new Float32Array(count).fill(1);
  for (const w of windows) {
    const a = Math.max(0, Math.floor((w.from - from) * sampleRate));
    const b = Math.min(count, Math.ceil((w.to - from) * sampleRate));
    for (let i = a; i < b; i++) {
      const t = from + i / sampleRate;
      const p = Math.min(1, Math.max(0, (t - w.from) / (w.to - w.from)));
      gains[i] = w.level0 + (w.level1 - w.level0) * p;
    }
  }
  return gains;
}

/** つなぎ目のフェードを入れる・やめる（clipId はつなぎ目の後ろのかたまり） */
export function toggleJoinFade(project: Project, clipId: string): Project {
  if (!project.clips.some((c) => c.id === clipId)) return project;
  const has = project.joinFades.includes(clipId);
  return { ...project, joinFades: has ? project.joinFades.filter((id) => id !== clipId) : [...project.joinFades, clipId] };
}

/** 録画が切り替わるつなぎ目すべてにフェードを入れる。入れた数も返す */
export function fadeSourceChanges(project: Project): { project: Project; count: number } {
  const add: string[] = [];
  project.clips.forEach((clip, i) => {
    if (i > 0 && project.clips[i - 1].sourceId !== clip.sourceId && !project.joinFades.includes(clip.id)) add.push(clip.id);
  });
  if (add.length === 0) return { project, count: 0 };
  return { project: { ...project, joinFades: [...project.joinFades, ...add] }, count: add.length };
}

/** いま使っているかたまりのつなぎ目だけを残す（消えたかたまりの ID を除く） */
export function activeJoinFades(project: Project): string[] {
  const ids = new Set(project.clips.map((c) => c.id));
  return project.joinFades.filter((id) => ids.has(id));
}

/** 時刻 t に一番近いつなぎ目（動画の始まりも含む） */
export function nearestJoin(project: Project, t: number): { clipId: string; index: number; time: number } | null {
  const starts = clipStarts(project);
  let best: { clipId: string; index: number; time: number } | null = null;
  project.clips.forEach((clip, i) => {
    if (!best || Math.abs(starts[i] - t) < Math.abs(best.time - t)) best = { clipId: clip.id, index: i, time: starts[i] };
  });
  return best;
}
