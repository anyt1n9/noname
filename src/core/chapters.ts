// チャプター（YouTube の概要欄に貼る目次）。v0.8
// YouTube のルール（2026年10月に確かめた）：最初は 0:00、3つ以上、時刻の順、それぞれ10秒以上。
import { CHAPTER_MIN_COUNT, CHAPTER_MIN_SECONDS } from '../data/ai';

export interface Chapter {
  /** 完成した動画の時刻（秒） */
  time: number;
  title: string;
}

/** 0:00・1:02:03 の形の時刻（1時間を超える動画は時間も付ける） */
export function chapterTime(t: number, withHours: boolean): string {
  const s = Math.max(0, Math.floor(t + 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return withHours ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m + h * 60}:${sec}`;
}

/** 概要欄に貼る文字 */
export function formatChapters(chapters: Chapter[], duration: number): string {
  const withHours = duration >= 3600;
  return chapters.map((c) => `${chapterTime(c.time, withHours)} ${c.title}`).join('\n');
}

/** 「0:00 はじめに」「[01:02:03] ボス戦」などの行を読む（AI の答えを貼ったものなど） */
export function parseChapters(text: string): Chapter[] {
  const out: Chapter[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s\-*・●•\d.、)）]*(?=[\[(（]?\d{1,2}:\d{2})/, '').trim();
    const m = /^[[(（]?(?:(\d{1,2}):)?(\d{1,3}):(\d{2})[\])）]?\s*[-–—:：|｜]?\s*(.+)$/.exec(line);
    if (!m) continue;
    const time = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const title = m[4].replace(/^[「『"]|[」』"]$/g, '').trim();
    if (title) out.push({ time, title });
  }
  return out;
}

export interface ChapterCheck {
  chapters: Chapter[];
  /** 直したこと（使う人に知らせる） */
  fixes: string[];
  /** ルールに合っているか（直したあと） */
  ok: boolean;
  /** 合っていないときの理由 */
  problem: string | null;
}

/**
 * YouTube のルールに合うように直す：時刻の順に並べ、動画の長さを超えるものを除き、
 * 最初を 0:00 にし、10秒より短いチャプターは前のものにまとめる。
 */
export function fixChapters(input: Chapter[], duration: number): ChapterCheck {
  const fixes: string[] = [];
  let list = input
    .filter((c) => c.title.trim() !== '')
    .map((c) => ({ time: Math.max(0, Math.floor(c.time)), title: c.title.trim() }));
  const before = list.length;
  list = list.filter((c) => c.time < duration);
  if (list.length < before) fixes.push('動画の長さを超える時刻のチャプターを除きました。');
  const sorted = [...list].sort((a, b) => a.time - b.time);
  if (sorted.some((c, i) => c !== list[i])) fixes.push('時刻の順に並べました。');
  list = sorted;
  if (list.length > 0 && list[0].time !== 0) {
    if (list[0].time < CHAPTER_MIN_SECONDS) list[0] = { ...list[0], time: 0 };
    else list.unshift({ time: 0, title: 'はじめに' });
    fixes.push('最初のチャプターを 0:00 にしました。');
  }
  // 短すぎるチャプター（次のチャプターまで10秒未満）は、次のものを除いてまとめる
  const merged: Chapter[] = [];
  let mergedAny = false;
  for (const c of list) {
    const last = merged[merged.length - 1];
    if (last && c.time - last.time < CHAPTER_MIN_SECONDS) {
      mergedAny = true;
      continue;
    }
    merged.push(c);
  }
  // 最後のチャプターも、動画の終わりまで10秒以上必要
  while (merged.length > 1 && duration - merged[merged.length - 1].time < CHAPTER_MIN_SECONDS) {
    merged.pop();
    mergedAny = true;
  }
  if (mergedAny) fixes.push(`${CHAPTER_MIN_SECONDS}秒より短いチャプターを、となりとまとめました。`);
  let problem: string | null = null;
  if (merged.length < CHAPTER_MIN_COUNT) problem = `YouTube のチャプターは${CHAPTER_MIN_COUNT}つ以上必要です（いまは${merged.length}つ）。`;
  if (duration < CHAPTER_MIN_SECONDS * CHAPTER_MIN_COUNT) problem = `動画が短すぎて、チャプターを${CHAPTER_MIN_COUNT}つ作れません（それぞれ${CHAPTER_MIN_SECONDS}秒以上必要です）。`;
  return { chapters: merged, fixes, ok: problem === null, problem };
}
