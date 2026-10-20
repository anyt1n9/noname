// 無音カット：しゃべっていない「間」を見つける
import { MIN_CUT_SECONDS, MIN_SPEECH_SECONDS, type CutStrength } from '../data/silence';
import type { Project } from './project';
import { removeSourceRanges, sourceRangeOnTimeline, type SourceRange } from './timeline';

/** 録画の声の大きさ。一定の時間（binSeconds）ごとの平均の大きさ（0〜1） */
export interface VoiceLevel {
  binSeconds: number;
  rms: Float32Array;
}

const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return -120;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/**
 * しゃべっているとみなす大きさ（dB）。録画ごとに、静かな部分としゃべっている部分の大きさから決める。
 * マイクやまわりの音の大きさが録画ごとに違っても、同じように見つけられる。
 */
export function speechThreshold(rms: Float32Array): number {
  const db: number[] = [];
  for (const v of rms) db.push(toDb(v));
  db.sort((a, b) => a - b);
  // 静かな部分は少ししかないこともあるので、下のほうの値を使う
  const floor = percentile(db, 0.02);
  const speech = percentile(db, 0.9);
  const range = speech - floor;
  // 静かな部分としゃべっている部分の差が小さい録画は、区別できないので「間」を出さない
  if (range < 6) return floor - 1;
  return Math.min(floor + Math.max(6, range * 0.35), speech - 6);
}

/**
 * 録画の中の「間」を、切る範囲（しゃべりの前後に余白を残したもの）として返す。
 * startTime〜endTime は録画の始まりと終わり。録画の端の「間」には余白を残さない。
 */
export function findSilences(level: VoiceLevel, strength: CutStrength, startTime: number, endTime: number): [number, number][] {
  const { rms, binSeconds } = level;
  if (rms.length === 0) return [];
  const threshold = speechThreshold(rms);
  const speaking = Array.from(rms, (v) => toDb(v) >= threshold);
  // 短すぎるしゃべり（物音など）は「間」として扱う
  const minSpeechBins = Math.max(1, Math.round(MIN_SPEECH_SECONDS / binSeconds));
  for (let i = 0; i < speaking.length; ) {
    if (!speaking[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < speaking.length && speaking[j]) j++;
    if (j - i < minSpeechBins) for (let k = i; k < j; k++) speaking[k] = false;
    i = j;
  }
  const result: [number, number][] = [];
  for (let i = 0; i < speaking.length; ) {
    if (speaking[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < speaking.length && !speaking[j]) j++;
    const a = Math.max(startTime, i * binSeconds);
    const b = Math.min(endTime, j * binSeconds);
    if (b - a >= strength.minSilence) {
      const atStart = a <= startTime + 1e-6;
      const atEnd = b >= endTime - binSeconds;
      const from = atStart ? startTime : a + strength.padding;
      const to = atEnd ? endTime : b - strength.padding;
      if (to - from >= MIN_CUT_SECONDS) result.push([from, to]);
    }
    i = j;
  }
  return result;
}

/** 切る候補。録画の中の時刻で持つ */
export interface CutCandidate extends SourceRange {
  id: string;
}

/** 作品の中で、いまタイムラインに残っている部分の「間」だけを候補にする */
export function findCandidates(project: Project, levels: Map<string, VoiceLevel>, strength: CutStrength): CutCandidate[] {
  const result: CutCandidate[] = [];
  for (const source of project.sources) {
    const level = levels.get(source.id);
    if (!level) continue;
    const clips = project.clips.filter((c) => c.sourceId === source.id);
    if (clips.length === 0) continue;
    for (const [start, end] of findSilences(level, strength, source.startTime, source.endTime)) {
      for (const clip of clips) {
        const a = Math.max(start, clip.start);
        const b = Math.min(end, clip.end);
        if (b - a >= MIN_CUT_SECONDS) {
          result.push({ id: `${source.id}:${Math.round(a * 1000)}`, sourceId: source.id, start: a, end: b });
        }
      }
    }
  }
  return result;
}

/** 候補が完成した動画のどこにあたるか */
export function candidateOnTimeline(project: Project, candidate: CutCandidate): [number, number] | null {
  const spans = sourceRangeOnTimeline(project, candidate);
  return spans[0] ?? null;
}

/** 残すと決めた候補を除いて、まとめて切る */
export function applyCandidates(project: Project, candidates: CutCandidate[], kept: Set<string>): Project {
  return removeSourceRanges(
    project,
    candidates.filter((c) => !kept.has(c.id)),
  );
}

/** 切ると何秒短くなるか */
export function candidatesLength(candidates: CutCandidate[], kept: Set<string>): number {
  let total = 0;
  for (const c of candidates) if (!kept.has(c.id)) total += c.end - c.start;
  return total;
}
