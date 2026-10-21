// Chrome に入っている AI（Prompt API・Gemini Nano）を使う（v0.8）。パソコンの中で動き、文章はネットに送らない。
// 使えないブラウザ（Edge・古い Chrome・性能の足りないパソコン）では「AIに聞く」を案内する。
import { BUILTIN_CHAPTER_MAX, BUILTIN_CHAPTER_SECONDS, BUILTIN_CHUNK_CHARS, BUILTIN_TYPO_BATCH } from '../data/ai';
import type { Chapter } from '../core/chapters';
import { headingPrompt, parseTitleAnswer, parseTypoAnswer, summaryPrompt, titlePrompt, typoPrompt } from '../core/prompts';

export type BuiltinState = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

const LANGUAGE = { expectedInputs: [{ type: 'text' as const, languages: ['ja'] }], expectedOutputs: [{ type: 'text' as const, languages: ['ja'] }] };

const SYSTEM = 'あなたは YouTube 動画の編集を手伝うアシスタントです。日本語で、短く、指示された形式だけで答えてください。';

export async function builtinState(): Promise<BuiltinState> {
  const api = globalThis.LanguageModel;
  if (!api) return 'unsupported';
  try {
    return await api.availability(LANGUAGE);
  } catch {
    return 'unavailable';
  }
}

const CONSENT_KEY = 'teroppa.builtinAiConsent';

export function hasBuiltinConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function saveBuiltinConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'yes');
  } catch {
    // 覚えられなくても使える（次にまた確かめる）
  }
}

/** AI と話す準備をする。はじめての時は Chrome が AI の部品をダウンロードする（ボタンを押したときに呼ぶ） */
export async function openSession(onDownload: (progress: number) => void, signal: AbortSignal): Promise<LanguageModelSession> {
  const api = globalThis.LanguageModel;
  if (!api) throw new Error('このブラウザには、パソコンの中で動く AI が入っていません');
  return api.create({
    ...LANGUAGE,
    initialPrompts: [{ role: 'system', content: SYSTEM }],
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onDownload(e.loaded)),
    signal,
  });
}

/** 字幕の誤字直し：少しずつ区切って聞き、直した行（番号 → 直した文）を返す */
export async function builtinTypos(
  session: LanguageModelSession,
  lines: { no: number; text: string }[],
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < lines.length; i += BUILTIN_TYPO_BATCH) {
    const batch = lines.slice(i, i + BUILTIN_TYPO_BATCH);
    const answer = await session.prompt(typoPrompt(batch), { signal });
    for (const [no, text] of parseTypoAnswer(answer)) if (batch.some((l) => l.no === no)) out.set(no, text);
    onProgress(Math.min(lines.length, i + batch.length), lines.length);
  }
  return out;
}

/** 長い字幕を、AI が読める長さのかたまりに分ける */
export function chunkTranscript(lines: { time: number; text: string }[], chars = BUILTIN_CHUNK_CHARS): { time: number; text: string }[] {
  const chunks: { time: number; text: string }[] = [];
  let current: { time: number; text: string } | null = null;
  for (const l of lines) {
    if (!current || current.text.length + l.text.length > chars) {
      current = { time: l.time, text: '' };
      chunks.push(current);
    }
    current.text += `${l.text}\n`;
  }
  return chunks;
}

/** タイトルと概要欄の案。長い字幕は、かたまりごとに要点をまとめてから聞く */
export async function builtinTitle(
  session: LanguageModelSession,
  lines: { time: number; text: string }[],
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<{ titles: string[]; description: string }> {
  const chunks = chunkTranscript(lines);
  let material: string;
  if (chunks.length <= 1) {
    material = chunks[0]?.text ?? '';
  } else {
    const points: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      points.push(`・${(await session.prompt(summaryPrompt(chunks[i].text), { signal })).trim()}`);
      onProgress(i + 1, chunks.length + 1);
    }
    material = `（動画の要点）\n${points.join('\n')}`;
  }
  const answer = await session.prompt(titlePrompt(material), { signal });
  onProgress(1, 1);
  return parseTitleAnswer(answer);
}

/** チャプターの案：動画を同じくらいの長さに区切り、それぞれの見出しを聞く */
export async function builtinChapters(
  session: LanguageModelSession,
  lines: { time: number; text: string }[],
  duration: number,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Chapter[]> {
  const count = Math.max(3, Math.min(BUILTIN_CHAPTER_MAX, Math.round(duration / BUILTIN_CHAPTER_SECONDS)));
  const out: Chapter[] = [];
  for (let k = 0; k < count; k++) {
    const from = (duration * k) / count;
    const to = (duration * (k + 1)) / count;
    const part = lines.filter((l) => l.time >= from && l.time < to);
    if (part.length === 0) continue;
    const text = part
      .map((l) => l.text)
      .join('\n')
      .slice(0, BUILTIN_CHUNK_CHARS);
    const title = (await session.prompt(headingPrompt(text), { signal })).trim().split('\n')[0].replace(/^[「『"]|[」』"]$/g, '');
    // チャプターの始まりは、その部分の最初の字幕に合わせる（最初は 0:00）
    out.push({ time: k === 0 ? 0 : part[0].time, title: title || `パート${k + 1}` });
    onProgress(k + 1, count);
  }
  return out;
}
