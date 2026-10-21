// タイムラインの計算（切る・並べ替える・時刻の変換）
import type { Clip, Project, SourceRange } from './project';

export type { SourceRange } from './project';

/** これより短いかけらは残さない（なぞった範囲の端がわずかにずれたときのため） */
export const MIN_CLIP_SECONDS = 0.01;

export function clipLength(clip: Clip): number {
  return clip.end - clip.start;
}

/** 完成した動画の長さ（秒） */
export function totalDuration(project: Project): number {
  let total = 0;
  for (const c of project.clips) total += clipLength(c);
  return total;
}

/** 各かたまりが、完成した動画の何秒目から始まるか */
export function clipStarts(project: Project): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of project.clips) {
    starts.push(t);
    t += clipLength(c);
  }
  return starts;
}

export interface Location {
  /** かたまりの番号 */
  index: number;
  clip: Clip;
  /** そのかたまりが完成した動画の何秒目から始まるか */
  clipStart: number;
  /** 録画の中の時刻 */
  sourceTime: number;
}

/**
 * 完成した動画の時刻 t が、どの録画のどの時刻にあたるかを調べる。
 * かたまりの境目ちょうどは、後ろのかたまりとして扱う。動画の終わり以降は最後のかたまりの終わり。
 */
export function locate(project: Project, t: number): Location | null {
  const clips = project.clips;
  if (clips.length === 0) return null;
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const len = clipLength(clip);
    if (t < start + len || i === clips.length - 1) {
      const offset = Math.min(Math.max(0, t - start), len);
      return { index: i, clip, clipStart: start, sourceTime: clip.start + offset };
    }
    start += len;
  }
  return null;
}

/** なぞった範囲を、小さい順・動画の長さの中に直す */
export function normalizeRange(a: number, b: number, total: number): [number, number] {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(total, Math.max(a, b));
  return [lo, Math.max(lo, hi)];
}

/** 完成した動画の from〜to 秒を消す。かかっているかたまりは切り分ける */
export function deleteRange(project: Project, from: number, to: number): Project {
  const [lo, hi] = normalizeRange(from, to, totalDuration(project));
  if (hi - lo < MIN_CLIP_SECONDS) return project;
  let nextId = project.nextId;
  const result: Clip[] = [];
  let start = 0;
  for (const clip of project.clips) {
    const len = clipLength(clip);
    const end = start + len;
    if (end <= lo || start >= hi) {
      // 消す範囲にかかっていない
      result.push(clip);
    } else {
      // 前に残る部分
      const keepBefore = lo - start;
      if (keepBefore >= MIN_CLIP_SECONDS) {
        result.push({ ...clip, end: clip.start + keepBefore });
      }
      // 後ろに残る部分（前の部分も残るときは新しい ID を付ける）
      const keepAfter = end - hi;
      if (keepAfter >= MIN_CLIP_SECONDS) {
        const id = keepBefore >= MIN_CLIP_SECONDS ? `c${nextId++}` : clip.id;
        result.push({ ...clip, id, start: clip.end - keepAfter });
      }
    }
    start = end;
  }
  return { ...project, clips: result, nextId };
}

/** かたまりの順番を変える。to は移動したあとの番号 */
export function moveClip(project: Project, from: number, to: number): Project {
  const clips = [...project.clips];
  if (from < 0 || from >= clips.length) return project;
  const target = Math.max(0, Math.min(clips.length - 1, to));
  if (target === from) return project;
  const [moved] = clips.splice(from, 1);
  clips.splice(target, 0, moved);
  return { ...project, clips };
}

/**
 * ドラッグで並べ替えるとき、落とした位置 t（完成した動画の秒）から移動先の番号を決める。
 * 各かたまりの真ん中より前に落としたら、そのかたまりの前に入る。
 */
export function dropIndex(project: Project, from: number, t: number): number {
  const starts = clipStarts(project);
  let insertBefore = project.clips.length;
  for (let i = 0; i < project.clips.length; i++) {
    const mid = starts[i] + clipLength(project.clips[i]) / 2;
    if (t < mid) {
      insertBefore = i;
      break;
    }
  }
  // 自分より後ろへ動かすときは、自分が抜けた分だけ番号が1つ減る
  return insertBefore > from ? insertBefore - 1 : insertBefore;
}

/** 時刻をコマの切れ目に合わせる */
export function snapToFrame(t: number, frameRate: number): number {
  if (!(frameRate > 0)) return t;
  return Math.round(t * frameRate) / frameRate;
}

/**
 * 録画の中の範囲をまとめて取り除く（無音カットや、字幕の行を消すときに使う）。
 * タイムライン上の位置ではなく録画の時刻で指定するので、並べ替えや前のカットに左右されない。
 */
export function removeSourceRanges(project: Project, ranges: SourceRange[]): Project {
  if (ranges.length === 0) return project;
  const bySource = new Map<string, SourceRange[]>();
  for (const r of ranges) {
    if (r.end - r.start <= 0) continue;
    const list = bySource.get(r.sourceId) ?? [];
    list.push(r);
    bySource.set(r.sourceId, list);
  }
  for (const list of bySource.values()) list.sort((a, b) => a.start - b.start);
  let nextId = project.nextId;
  let changed = false;
  const clips: Clip[] = [];
  for (const clip of project.clips) {
    const cuts = bySource.get(clip.sourceId)?.filter((r) => r.end > clip.start && r.start < clip.end) ?? [];
    if (cuts.length === 0) {
      clips.push(clip);
      continue;
    }
    changed = true;
    let cursor = clip.start;
    let first = true;
    const pieces: [number, number][] = [];
    for (const r of cuts) {
      if (r.start > cursor) pieces.push([cursor, Math.min(r.start, clip.end)]);
      cursor = Math.max(cursor, r.end);
    }
    if (cursor < clip.end) pieces.push([cursor, clip.end]);
    for (const [start, end] of pieces) {
      if (end - start < MIN_CLIP_SECONDS) continue;
      clips.push({ ...clip, id: first ? clip.id : `c${nextId++}`, start, end });
      first = false;
    }
  }
  if (!changed) return project;
  return { ...project, clips, nextId };
}

/** 録画の中の範囲が、完成した動画のどこに見えているか（かたまりごとに分かれることがある） */
export function sourceRangeOnTimeline(project: Project, range: SourceRange): [number, number][] {
  const result: [number, number][] = [];
  let t = 0;
  for (const clip of project.clips) {
    const len = clipLength(clip);
    if (clip.sourceId === range.sourceId) {
      const a = Math.max(clip.start, range.start);
      const b = Math.min(clip.end, range.end);
      if (b > a) result.push([t + (a - clip.start), t + (b - clip.start)]);
    }
    t += len;
  }
  return result;
}

/** 完成した動画の from〜to 秒が、どの録画のどこにあたるか（かたまりごとに分かれる） */
export function timelineToSource(project: Project, from: number, to: number): SourceRange[] {
  const result: SourceRange[] = [];
  let t = 0;
  for (const clip of project.clips) {
    const len = clipLength(clip);
    const a = Math.max(from, t);
    const b = Math.min(to, t + len);
    if (b - a >= MIN_CLIP_SECONDS) result.push({ sourceId: clip.sourceId, start: clip.start + (a - t), end: clip.start + (b - t) });
    t += len;
  }
  return result;
}

/** 録画の中の範囲（いくつも）が、完成した動画のどこに見えているか（時刻の順にまとめる） */
export function sourceRangesOnTimeline(project: Project, ranges: SourceRange[]): [number, number][] {
  const out: [number, number][] = [];
  for (const r of ranges) out.push(...sourceRangeOnTimeline(project, r));
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of out) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/**
 * 録画ごとの範囲の一覧（録画の中の時刻・始まりの順）を、完成した動画の時刻に直す。
 * 長い録画で範囲がたくさんあっても速く計算できるよう、かたまりごとに必要な部分だけを探す。
 */
export function rangesOnTimeline(project: Project, bySource: Map<string, [number, number][]>): [number, number][] {
  const out: [number, number][] = [];
  let t = 0;
  for (const clip of project.clips) {
    const list = bySource.get(clip.sourceId);
    if (list && list.length > 0) {
      // 終わりが clip.start より後ろの最初の範囲
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid][1] <= clip.start) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < list.length && list[i][0] < clip.end; i++) {
        const a = Math.max(list[i][0], clip.start);
        const b = Math.min(list[i][1], clip.end);
        if (b > a) out.push([t + (a - clip.start), t + (b - clip.start)]);
      }
    }
    t += clipLength(clip);
  }
  return out;
}

/** 完成した動画の、かたまりのつなぎ目の時刻（最初のかたまりの始まりは 0） */
export function joinTimes(project: Project): { clipId: string; time: number }[] {
  const starts = clipStarts(project);
  return project.clips.map((c, i) => ({ clipId: c.id, time: starts[i] }));
}
