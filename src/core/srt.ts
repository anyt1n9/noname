// 字幕ファイル（.srt）の書き出しと読み込み。YouTube の字幕機能で使える形
import { breakLines, cleanText } from './captions';
import type { Project } from './project';
import { addSubtitles, subtitlesOnTimeline } from './subtitles';
import { locate } from './timeline';

/** 00:01:02,345 の形 */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(rest, 3)}`;
}

/** 完成した動画の時刻で、字幕ファイルを作る */
export function toSrt(project: Project): string {
  return subtitlesOnTimeline(project)
    .map((s, i) => `${i + 1}\n${srtTime(s.from)} --> ${srtTime(s.to)}\n${s.text}\n`)
    .join('\n');
}

export interface SrtCue {
  start: number;
  end: number;
  text: string;
}

function parseTime(text: string): number | null {
  const m = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** 字幕ファイルを読む。おかしな部分は読み飛ばす */
export function parseSrt(text: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeLine = lines.findIndex((l) => l.includes('-->'));
    if (timeLine < 0) continue;
    const [a, b] = lines[timeLine].split('-->');
    const start = parseTime(a);
    const end = parseTime(b);
    const body = lines
      .slice(timeLine + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .join('\n');
    if (start === null || end === null || end <= start || !body) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

/**
 * 読み込んだ字幕（完成した動画の時刻）を、いまのタイムラインに合わせて録画の字幕にする。
 * かたまりの境目をまたぐ字幕は、始まりのかたまりの終わりまでにする。
 */
export function importSrt(project: Project, cues: SrtCue[]): { project: Project; count: number } {
  let p = project;
  let count = 0;
  for (const cue of cues) {
    const loc = locate(p, cue.start + 1e-6);
    if (!loc) continue;
    const end = Math.min(loc.clip.end, loc.sourceTime + (cue.end - cue.start));
    if (end - loc.sourceTime < 0.05) continue;
    const text = cue.text
      .split('\n')
      .map((l) => cleanText(l))
      .join('');
    p = addSubtitles(p, loc.clip.sourceId, [{ start: loc.sourceTime, end, text: breakLines(text) }]);
    count++;
  }
  return { project: p, count };
}
