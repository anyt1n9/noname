// 文字起こしの計画。しゃべっている部分だけを、30秒以内のまとまりにして AI に渡す
import { findSilences, type VoiceLevel } from './silence';
import { subtractRanges } from './subtitles';

/** AI に一度に渡す長さの上限（秒）。Whisper は30秒ずつ聞き取る */
export const MAX_WINDOW_SECONDS = 28;

/** 文字起こしで使う「間」の見つけ方（字幕のための、ゆるめの基準） */
const SPEECH_SETTINGS = { label: '文字起こし', minSilence: 0.6, padding: 0.25 };

/**
 * ranges（録画の中の時刻。まだ文字起こししていない、使っている部分）のうち、しゃべっている部分を
 * 長さ MAX_WINDOW_SECONDS 秒以内のまとまりに分ける。長く続くしゃべりは、一番静かなところで分ける。
 * level がなければ（音を調べ終わっていなければ）、範囲をそのまま区切る。
 */
export function speechWindows(
  ranges: [number, number][],
  level: VoiceLevel | undefined,
  startTime: number,
  endTime: number,
  maxWindow = MAX_WINDOW_SECONDS,
): [number, number][] {
  const silences = level ? findSilences(level, SPEECH_SETTINGS, startTime, endTime) : [];
  const speech = subtractRanges(ranges, silences).filter(([a, b]) => b - a >= 0.2);
  const windows: [number, number][] = [];
  let current: [number, number] | null = null;
  for (const [a0, b] of speech) {
    let a = a0;
    // 長いしゃべりは分ける
    while (b - a > maxWindow) {
      if (current) {
        windows.push(current);
        current = null;
      }
      const cut = quietestPoint(level, a + maxWindow * 0.7, a + maxWindow);
      windows.push([a, cut]);
      a = cut;
    }
    if (current && b - current[0] <= maxWindow) {
      current[1] = b;
    } else {
      if (current) windows.push(current);
      current = [a, b];
    }
  }
  if (current) windows.push(current);
  return windows;
}

/** from〜to のうち、一番静かな時刻（音を調べていなければ to） */
function quietestPoint(level: VoiceLevel | undefined, from: number, to: number): number {
  if (!level) return to;
  const a = Math.max(0, Math.floor(from / level.binSeconds));
  const b = Math.min(level.rms.length, Math.ceil(to / level.binSeconds));
  let best = b;
  let bestValue = Infinity;
  for (let i = a; i < b; i++) {
    if (level.rms[i] < bestValue) {
      bestValue = level.rms[i];
      best = i;
    }
  }
  return Math.min(to, Math.max(from, best * level.binSeconds));
}

/** AI が返した1つの言葉のまとまり（まとまりの中の時刻） */
export interface WhisperChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * AI の結果を、録画の中の時刻に直す。終わりの時刻がないものは、次の始まりかまとまりの終わりにする。
 * 同じ言葉がくり返し続く（AI の聞き間違いによくある）ときは、1つにする。
 */
export function chunksToSegments(chunks: WhisperChunk[], windowStart: number, windowEnd: number): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  chunks.forEach((c, i) => {
    const text = c.text.trim();
    if (!text) return;
    const start = windowStart + Math.max(0, c.timestamp[0]);
    const rawEnd = c.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? windowEnd - windowStart;
    const end = Math.min(windowEnd, windowStart + rawEnd);
    if (end - start < 0.05) return;
    const last = out[out.length - 1];
    if (last && last.text === text) {
      last.end = Math.max(last.end, end);
      return;
    }
    out.push({ text, start, end });
  });
  return out;
}
