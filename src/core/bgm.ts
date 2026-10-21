// BGM の大きさの計算（v0.5）。始まりと終わりのフェードと、しゃべっている間に小さくするところ
import { BGM_FADE_IN, BGM_FADE_OUT, DUCK_ATTACK, DUCK_HOLD, DUCK_LEVEL, DUCK_RELEASE } from '../data/music';
import type { Project } from './project';
import { speechRanges, type VoiceLevel } from './silence';
import { rangesOnTimeline, totalDuration } from './timeline';

/**
 * 完成した動画の中で、しゃべっている範囲（時刻の順）。
 * 短い息つぎ（DUCK_HOLD より短い）はつないで、BGM が小刻みに大きくならないようにする。
 */
export function speechOnTimeline(project: Project, levels: Map<string, VoiceLevel>): [number, number][] {
  const bySource = new Map<string, [number, number][]>();
  for (const [sourceId, level] of levels) bySource.set(sourceId, speechRanges(level));
  const ranges = rangesOnTimeline(project, bySource);
  const merged: [number, number][] = [];
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] < DUCK_HOLD) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** BGM の大きさの設定（書き出しの作業場所にも渡す） */
export interface BgmEnvelope {
  duration: number;
  /** しゃべっている範囲（小さくするところ）。小さくしないときは空 */
  speech: [number, number][];
}

export function bgmEnvelope(project: Project, speech: [number, number][]): BgmEnvelope {
  return { duration: totalDuration(project), speech: project.bgm?.duck ? speech : [] };
}

/** 時刻 t の BGM の大きさの倍率（設定の大きさは含まない） */
export function bgmLevel(env: BgmEnvelope, t: number): number {
  return fadeEdge(env, t) * duckLevel(env.speech, t, findIndex(env.speech, t));
}

/** 動画の始まりと終わりのフェード */
function fadeEdge(env: BgmEnvelope, t: number): number {
  if (t < 0 || t > env.duration) return 0;
  const fadeIn = Math.min(BGM_FADE_IN, env.duration / 3);
  const fadeOut = Math.min(BGM_FADE_OUT, env.duration / 3);
  let v = 1;
  if (t < fadeIn) v = Math.min(v, t / fadeIn);
  if (t > env.duration - fadeOut) v = Math.min(v, (env.duration - t) / fadeOut);
  return v;
}

/** t より後ろで終わる最初の範囲の番号 */
function findIndex(speech: [number, number][], t: number): number {
  let lo = 0;
  let hi = speech.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (speech[mid][1] + DUCK_RELEASE <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** しゃべりの前後でなめらかに小さくする（i は findIndex の結果） */
function duckLevel(speech: [number, number][], t: number, i: number): number {
  let level = 1;
  // 近くの2つまで見れば足りる（範囲どうしは DUCK_HOLD 以上離れている）
  for (let k = Math.max(0, i - 1); k < Math.min(speech.length, i + 2); k++) {
    const [a, b] = speech[k];
    let d: number;
    if (t >= a && t <= b) d = 1;
    else if (t < a) d = t > a - DUCK_ATTACK ? 1 - (a - t) / DUCK_ATTACK : 0;
    else d = t < b + DUCK_RELEASE ? 1 - (t - b) / DUCK_RELEASE : 0;
    level = Math.min(level, 1 - (1 - DUCK_LEVEL) * d);
  }
  return level;
}

/** from 秒から count サンプル分の BGM の大きさの倍率 */
export function bgmGains(env: BgmEnvelope, from: number, count: number, sampleRate: number): Float32Array {
  const out = new Float32Array(count);
  // 10ミリ秒ごとに計算して、その間はまっすぐつなぐ
  const step = Math.max(1, Math.round(sampleRate / 100));
  let i = findIndex(env.speech, from);
  let prev = fadeEdge(env, from) * duckLevel(env.speech, from, i);
  for (let a = 0; a < count; a += step) {
    const b = Math.min(count, a + step);
    const t = from + b / sampleRate;
    while (i < env.speech.length && env.speech[i][1] + DUCK_RELEASE <= t) i++;
    const next = fadeEdge(env, t) * duckLevel(env.speech, t, i);
    for (let k = a; k < b; k++) out[k] = prev + ((next - prev) * (k - a)) / (b - a);
    prev = next;
  }
  return out;
}

/**
 * BGM の大きさが変わる点の一覧（プレビューで、音の大きさを予約するため）。from〜to 秒の分だけ。
 * 点と点の間はまっすぐ変わる。
 */
export function bgmPoints(env: BgmEnvelope, from: number, to: number): [number, number][] {
  const times = new Set<number>([from, to]);
  const add = (t: number) => {
    if (t > from && t < to) times.add(t);
  };
  const fadeIn = Math.min(BGM_FADE_IN, env.duration / 3);
  const fadeOut = Math.min(BGM_FADE_OUT, env.duration / 3);
  add(0);
  add(fadeIn);
  add(env.duration - fadeOut);
  add(env.duration);
  for (const [a, b] of env.speech) {
    if (b + DUCK_RELEASE < from) continue;
    if (a - DUCK_ATTACK > to) break;
    add(a - DUCK_ATTACK);
    add(a);
    add(b);
    add(b + DUCK_RELEASE);
  }
  return [...times].sort((x, y) => x - y).map((t) => [t, bgmLevel(env, t)]);
}
