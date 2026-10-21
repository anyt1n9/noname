// 字幕の操作。字幕は録画の中の時刻で持ち、タイムラインに見える位置はかたまりから計算する
import { NEW_SUBTITLE_SECONDS } from '../data/subtitle-style';
import { breakLines, textLength, type CaptionPiece } from './captions';
import type { Project, Subtitle } from './project';
import { clipLength, locate, removeSourceRanges, sourceRangeOnTimeline } from './timeline';

/** タイムラインに見えている字幕（1つの字幕が、カットで2つ以上に分かれて見えることもある） */
export interface TimelineSubtitle {
  /** 字幕の ID */
  id: string;
  /** 見えている部分ごとに違う手がかり */
  key: string;
  from: number;
  to: number;
  text: string;
}

/** これより短く見えている部分は、ないものとする（秒） */
const MIN_VISIBLE = 0.05;

/** 字幕が、完成した動画のどこに見えるか（時刻の順） */
export function subtitlesOnTimeline(project: Project): TimelineSubtitle[] {
  const result: TimelineSubtitle[] = [];
  for (const s of project.subtitles) {
    sourceRangeOnTimeline(project, s).forEach(([from, to], i) => {
      if (to - from >= MIN_VISIBLE) result.push({ id: s.id, key: `${s.id}#${i}`, from, to, text: s.text });
    });
  }
  return result.sort((a, b) => a.from - b.from);
}

/** 録画ごとに、始まりの順に並べた字幕（時刻から字幕を探すため） */
const indexCache = new WeakMap<Subtitle[], Map<string, Subtitle[]>>();
function subtitleIndex(subtitles: Subtitle[]): Map<string, Subtitle[]> {
  let index = indexCache.get(subtitles);
  if (!index) {
    index = new Map();
    for (const s of subtitles) {
      const list = index.get(s.sourceId) ?? [];
      list.push(s);
      index.set(s.sourceId, list);
    }
    for (const list of index.values()) list.sort((a, b) => a.start - b.start);
    indexCache.set(subtitles, index);
  }
  return index;
}

/** 録画の中の時刻 t に出ている字幕 */
export function subtitleAtSource(project: Project, sourceId: string, t: number): Subtitle | null {
  const list = subtitleIndex(project.subtitles).get(sourceId);
  if (!list) return null;
  // 始まりが t 以下の最後の字幕を探す
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = found; i >= 0 && i >= found - 2; i--) {
    if (list[i].start <= t && t < list[i].end) return list[i];
  }
  return null;
}

/** 完成した動画の時刻 t に出ている字幕 */
export function subtitleAt(project: Project, t: number): Subtitle | null {
  const loc = locate(project, t);
  if (!loc) return null;
  return subtitleAtSource(project, loc.clip.sourceId, loc.sourceTime);
}

function sortSubtitles(list: Subtitle[]): Subtitle[] {
  return [...list].sort((a, b) => (a.sourceId === b.sourceId ? a.start - b.start : a.sourceId < b.sourceId ? -1 : 1));
}

/** 文字起こしの結果を足す。重なっていた字幕は新しいもので置きかえる */
export function addSubtitles(project: Project, sourceId: string, pieces: CaptionPiece[]): Project {
  if (pieces.length === 0) return project;
  let nextId = project.nextId;
  const added: Subtitle[] = pieces.map((p) => ({ id: `t${nextId++}`, sourceId, start: p.start, end: p.end, text: p.text }));
  const kept = project.subtitles.filter((s) => s.sourceId !== sourceId || !added.some((a) => a.start < s.end && s.start < a.end));
  return { ...project, subtitles: sortSubtitles([...kept, ...added]), nextId };
}

function update(project: Project, id: string, change: (s: Subtitle) => Subtitle | null): Project {
  const index = project.subtitles.findIndex((s) => s.id === id);
  if (index < 0) return project;
  const next = change(project.subtitles[index]);
  const subtitles = [...project.subtitles];
  if (next) subtitles[index] = next;
  else subtitles.splice(index, 1);
  return { ...project, subtitles };
}

export function setSubtitleText(project: Project, id: string, text: string): Project {
  return update(project, id, (s) => (s.text === text ? s : { ...s, text }));
}

/** 字幕だけを消す（動画はそのまま） */
export function removeSubtitle(project: Project, id: string): Project {
  return update(project, id, () => null);
}

/**
 * 字幕を2つに分ける。at は文字の位置（改行を除いて数える）。時間は文字数に合わせて分ける。
 */
export function splitSubtitle(project: Project, id: string, at: number): Project {
  const s = project.subtitles.find((x) => x.id === id);
  if (!s) return project;
  const flat = Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s.text.replace(/\n/g, '')), (g) => g.segment);
  if (at <= 0 || at >= flat.length) return project;
  const left = flat.slice(0, at).join('').trim();
  const right = flat.slice(at).join('').trim();
  if (!left || !right) return project;
  const mid = s.start + ((s.end - s.start) * textLength(left)) / (textLength(left) + textLength(right));
  const first: Subtitle = { ...s, end: mid, text: breakLines(left) };
  const second: Subtitle = { id: `t${project.nextId}`, sourceId: s.sourceId, start: mid, end: s.end, text: breakLines(right) };
  const subtitles = project.subtitles.flatMap((x) => (x.id === id ? [first, second] : [x]));
  return { ...project, subtitles, nextId: project.nextId + 1 };
}

/** 同じ録画で、すぐ後ろにある字幕 */
function nextOf(project: Project, s: Subtitle): Subtitle | undefined {
  return subtitleIndex(project.subtitles)
    .get(s.sourceId)
    ?.find((x) => x.start >= s.end - 1e-6 && x.id !== s.id);
}

/** 後ろの字幕とひとつにまとめる */
export function mergeWithNext(project: Project, id: string): Project {
  const s = project.subtitles.find((x) => x.id === id);
  if (!s) return project;
  const next = nextOf(project, s);
  if (!next) return project;
  const text = breakLines(s.text.replace(/\n/g, '') + next.text.replace(/\n/g, ''));
  const merged: Subtitle = { ...s, end: next.end, text };
  return { ...project, subtitles: project.subtitles.filter((x) => x.id !== next.id).map((x) => (x.id === id ? merged : x)) };
}

/** 字幕の時間を変える（録画の中の時刻）。前後の字幕とは重ならないようにする */
export function setSubtitleTime(project: Project, id: string, start: number, end: number): Project {
  const s = project.subtitles.find((x) => x.id === id);
  if (!s) return project;
  const list = subtitleIndex(project.subtitles).get(s.sourceId) ?? [];
  const i = list.findIndex((x) => x.id === id);
  const prevEnd = i > 0 ? list[i - 1].end : 0;
  const nextStart = i < list.length - 1 ? list[i + 1].start : Infinity;
  const source = project.sources.find((x) => x.id === s.sourceId);
  const a = Math.max(prevEnd, source?.startTime ?? 0, Math.min(start, end - 0.1));
  const b = Math.min(nextStart, source?.endTime ?? Infinity, Math.max(end, a + 0.1));
  if (b - a < 0.1 || (a === s.start && b === s.end)) return project;
  return update(project, id, (x) => ({ ...x, start: a, end: b }));
}

/**
 * 再生位置に字幕を足す（自動で作った字幕に抜けがあったとき）。
 * 次の字幕やかたまりの終わりまでの間で、最大 NEW_SUBTITLE_SECONDS 秒にする。足した字幕の ID も返す。
 */
export function addSubtitleAt(project: Project, t: number, text: string): { project: Project; id: string | null } {
  const loc = locate(project, t);
  if (!loc) return { project, id: null };
  const { clip, sourceTime } = loc;
  if (subtitleAtSource(project, clip.sourceId, sourceTime)) return { project, id: null };
  const list = subtitleIndex(project.subtitles).get(clip.sourceId) ?? [];
  const nextStart = list.find((x) => x.start > sourceTime)?.start ?? Infinity;
  const end = Math.min(sourceTime + NEW_SUBTITLE_SECONDS, nextStart, clip.end);
  if (end - sourceTime < 0.2 || clipLength(clip) <= 0) return { project, id: null };
  const id = `t${project.nextId}`;
  const added: Subtitle = { id, sourceId: clip.sourceId, start: sourceTime, end, text };
  return { project: { ...project, subtitles: sortSubtitles([...project.subtitles, added]), nextId: project.nextId + 1 }, id };
}

/** 範囲をまとめる（重なり・接しているものはひとつに） */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** 範囲から別の範囲を引く */
export function subtractRanges(ranges: [number, number][], remove: [number, number][]): [number, number][] {
  let result = mergeRanges(ranges);
  for (const [ra, rb] of mergeRanges(remove)) {
    const next: [number, number][] = [];
    for (const [a, b] of result) {
      if (rb <= a || ra >= b) next.push([a, b]);
      else {
        if (ra > a) next.push([a, ra]);
        if (rb < b) next.push([rb, b]);
      }
    }
    result = next;
  }
  return result;
}

/** 文字起こしを済ませた範囲を記録する */
export function markTranscribed(project: Project, sourceId: string, range: [number, number]): Project {
  const ranges = mergeRanges([...(project.transcribed[sourceId] ?? []), range]);
  return { ...project, transcribed: { ...project.transcribed, [sourceId]: ranges } };
}

/** タイムラインで使っている部分のうち、まだ文字起こしをしていない範囲（録画の中の時刻） */
export function untranscribedRanges(project: Project, sourceId: string): [number, number][] {
  const used = project.clips.filter((c) => c.sourceId === sourceId).map((c): [number, number] => [c.start, c.end]);
  return subtractRanges(used, project.transcribed[sourceId] ?? []).filter(([a, b]) => b - a >= 0.3);
}

/**
 * 文章で編集：字幕の行を消すと、その部分の動画も消える。
 * 字幕の時間（録画の中の時刻）を動画から取り除き、字幕も消す。
 */
export function cutSubtitle(project: Project, id: string): Project {
  const s = project.subtitles.find((x) => x.id === id);
  if (!s) return project;
  const cut = removeSourceRanges(project, [{ sourceId: s.sourceId, start: s.start, end: s.end }]);
  return removeSubtitle(cut, id);
}
