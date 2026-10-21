// AI に渡す質問文を作る・AI の答えを読む（v0.8）。
// 「AIに聞く」（使う人が AI のサイトに貼る）と、Chrome に入っている AI の両方で同じ質問文を使う。
import { formatChapters, type Chapter } from './chapters';
import type { Project } from './project';
import { subtitlesOnTimeline } from './subtitles';
import { formatClock } from './time';
import { totalDuration } from './timeline';

/** 完成した動画の字幕を、時刻つきの行にする（1つの字幕は1行。カットで分かれたものは最初の部分の時刻） */
export function transcriptLines(project: Project): { id: string; time: number; text: string }[] {
  const seen = new Set<string>();
  const out: { id: string; time: number; text: string }[] = [];
  for (const s of subtitlesOnTimeline(project)) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, time: s.from, text: s.text.replace(/\n/g, '') });
  }
  return out;
}

export function transcriptText(lines: { time: number; text: string }[]): string {
  return lines.map((l) => `[${formatClock(l.time)}] ${l.text}`).join('\n');
}

const CHECK_NOTE = '分からないこと・不確かなことは、そう書いてください。';

/** 動画の内容の調べもの */
export function researchPrompt(topic: string): string {
  return [
    `YouTube で「${topic.trim()}」についての動画を作ります。`,
    '視聴者に正しく伝えるために、次のことを箇条書きで教えてください。',
    '1. 押さえておくべき要点',
    '2. よくある誤解や、まちがえやすいところ',
    '3. 動画で言う前に確かめるべき事実と、その確かめ方（公式の資料など、元の情報の探し方）',
    CHECK_NOTE,
  ].join('\n');
}

/** 台本の下書き（録画の前に、話す流れを考える） */
export function scriptPrompt(topic: string, minutes: number, kind: string): string {
  return [
    `YouTube の${kind}動画（約${minutes}分）の台本の下書きを作ってください。テーマは「${topic.trim()}」です。`,
    '「はじめに」「本題」「まとめ」の順に、見出しと、そこで話すことの要点を書いてください。',
    'しゃべる人が自分の言葉で話せるよう、文章は短く、箇条書きにしてください。',
    'それぞれの部分の時間の目安も書いてください。',
    CHECK_NOTE,
  ].join('\n');
}

/** 字幕の誤字直し。lines は番号つきで渡す */
export function typoPrompt(lines: { no: number; text: string }[]): string {
  return [
    '次は動画の字幕です。自動の文字起こしなので、聞き間違いや誤字があります。',
    '意味が通るように直してください。言い回しは変えすぎないでください。',
    '直した行だけを「番号: 直した文」の形で、1行ずつ書いてください。ほかのことは書かないでください。',
    '直すところがなければ「なし」とだけ書いてください。',
    '',
    ...lines.map((l) => `${l.no}: ${l.text}`),
  ].join('\n');
}

/** タイトルと概要欄の案 */
export function titlePrompt(transcript: string): string {
  return [
    '次の動画の字幕（または要点）をもとに、YouTube のタイトルの案を3つと、概要欄の文章の案を書いてください。',
    '内容と合っていて、大げさすぎないものにしてください。',
    '形式：',
    'タイトル案：',
    '1. （タイトル）',
    '2. （タイトル）',
    '3. （タイトル）',
    '概要欄：',
    '（文章）',
    '',
    transcript,
  ].join('\n');
}

/** チャプター（目次）の案 */
export function chaptersPrompt(transcript: string, duration: number): string {
  return [
    `次は長さ${formatClock(duration)}の動画の字幕です（[ ] の中は動画の時刻）。`,
    'YouTube の概要欄に貼るチャプター（目次）の案を作ってください。',
    'ルール：最初は 0:00。3つ以上。時刻の順。それぞれ10秒以上。字幕の時刻に合わせる。',
    '形式：「0:00 見出し」を1行ずつ。ほかのことは書かないでください。',
    '',
    transcript,
  ].join('\n');
}

/** Chrome に入っている AI 用：長い字幕の一部の要点 */
export function summaryPrompt(part: string): string {
  return ['次は動画の字幕の一部です。話している内容の要点を、日本語で1〜2文にまとめてください。まとめだけを書いてください。', '', part].join('\n');
}

/** Chrome に入っている AI 用：チャプター1つ分の見出し */
export function headingPrompt(part: string): string {
  return ['次は動画の字幕の一部です。この部分の内容を表す、15文字以内の見出しを1つ書いてください。見出しだけを書いてください。', '', part].join('\n');
}

/** 誤字直しの答え（「番号: 直した文」）を読む */
export function parseTypoAnswer(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*[*-]?\s*(\d+)\s*[:：.．、)）]\s*(.+?)\s*$/.exec(raw);
    if (m) out.set(Number(m[1]), m[2].replace(/^[「『"]|[」』"]$/g, ''));
  }
  return out;
}

/** タイトルと概要欄の答えを読む */
export function parseTitleAnswer(text: string): { titles: string[]; description: string } {
  const lines = text.split(/\r?\n/);
  const titles: string[] = [];
  const desc: string[] = [];
  let mode: 'none' | 'title' | 'desc' = 'none';
  for (const raw of lines) {
    const line = raw.trim().replace(/^[#*]+\s*|\s*[*]+$/g, '');
    if (/^タイトル(案)?[:：]?\s*$/.test(line)) {
      mode = 'title';
      continue;
    }
    if (/^概要欄(の文章)?(案)?[:：]?\s*/.test(line)) {
      mode = 'desc';
      const rest = line.replace(/^概要欄(の文章)?(案)?[:：]?\s*/, '');
      if (rest) desc.push(rest);
      continue;
    }
    if (mode === 'title' && line) titles.push(line.replace(/^\d+[.．、)）]\s*/, '').replace(/^[「『]|[」』]$/g, ''));
    else if (mode === 'desc') desc.push(raw.trimEnd());
  }
  if (titles.length === 0 && desc.length === 0) {
    // 形式どおりでなければ、最初の行をタイトル、残りを概要欄とみなす
    const body = lines.map((l) => l.trim()).filter((l) => l !== '');
    return { titles: body.slice(0, 1), description: body.slice(1).join('\n') };
  }
  return { titles: titles.slice(0, 5), description: desc.join('\n').trim() };
}

/** チャプターの文字（概要欄に貼るもの） */
export function chaptersText(project: Project, chapters: Chapter[]): string {
  return formatChapters(chapters, totalDuration(project));
}
