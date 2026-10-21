// 「えー」「あのー」などの口ぐせを、切る候補として見つける（v0.7・試験的）。
// 1. 字幕の文字が口ぐせだけの行（「えー」など）
// 2. 音：前後に「間」がある短い声で、同じ音をのばしている（音色がほとんど変わらない）もの
// どちらも、まちがえて見つけることがあるので、候補として見せて、確かめてから切ってもらう。
import { FILLER_MAX_SECONDS, FILLER_MIN_SECONDS, FILLER_PAUSE_SECONDS, FILLER_WORDS } from '../data/voice';
import type { Project } from './project';
import { speakingBins, type VoiceLevel } from './silence';
import { sourceRangeOnTimeline, type SourceRange } from './timeline';

/** 音から口ぐせを見つけるための、目盛りごとの特徴（flux：音色の変わり方、zcr：0 をまたぐ割合） */
export interface VoiceFeatures extends VoiceLevel {
  flux: Float32Array;
  zcr: Float32Array;
}

export interface FillerCandidate extends SourceRange {
  id: string;
  /** 見つけた理由（字幕の文字、または「のばした声」） */
  reason: 'text' | 'sound';
  /** 字幕から見つけたときの文字 */
  text?: string;
}

/** 句読点や記号を除いた、口ぐせかを比べるための文字（「えーっと」「あのぉ」なども同じにそろえる） */
function normalize(text: string): string {
  return text
    .replace(/[\s、。,.!?！？…・「」『』（）()]/g, '')
    .replace(/[〜~－\-ぁぃぅぇぉ]/g, 'ー')
    .replace(/ー+/g, 'ー');
}

const WORDS = new Set(FILLER_WORDS.map(normalize));

/** 字幕の文字が、口ぐせだけでできているか（「えー、あのー」なども口ぐせとみなす） */
export function isFillerText(text: string): boolean {
  const parts = text
    .split(/[\s、,。.\n]+/)
    .map(normalize)
    .filter((p) => p !== '');
  return parts.length > 0 && parts.every((p) => WORDS.has(p) || WORDS.has(p.replace(/ー$/, '')) || WORDS.has(`${p}ー`));
}

/** 字幕から、口ぐせだけの行を候補にする */
export function fillersFromSubtitles(project: Project): FillerCandidate[] {
  return project.subtitles
    .filter((s) => isFillerText(s.text))
    .map((s) => ({ id: `text:${s.id}`, reason: 'text' as const, text: s.text.replace(/\n/g, ''), sourceId: s.sourceId, start: s.start, end: s.end }));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 音から「のばした声」を見つける（録画の中の時刻）。
 * 前後に FILLER_PAUSE_SECONDS 以上「間」があり、長さが FILLER_MIN〜MAX_SECONDS のしゃべりで、
 * 音色の変わり方（flux）がその人のふだんのしゃべりの半分以下、こすれる音（zcr）も少ないもの。
 */
export function fillersFromSound(features: VoiceFeatures): [number, number][] {
  const { binSeconds, flux, zcr } = features;
  const speaking = speakingBins(features);
  const segments: [number, number][] = [];
  for (let i = 0; i < speaking.length; ) {
    if (!speaking[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < speaking.length && speaking[j]) j++;
    segments.push([i, j]);
    i = j;
  }
  // その人のふだんのしゃべりの音色の変わり方と、こすれる音の量
  const speechFlux: number[] = [];
  const speechZcr: number[] = [];
  for (const [a, b] of segments) {
    for (let k = a + 1; k < b; k++) {
      speechFlux.push(flux[k]);
      speechZcr.push(zcr[k]);
    }
  }
  const typicalFlux = median(speechFlux);
  const typicalZcr = median(speechZcr);
  if (typicalFlux <= 0) return [];
  const pause = Math.round(FILLER_PAUSE_SECONDS / binSeconds);
  const out: [number, number][] = [];
  segments.forEach(([a, b], index) => {
    const seconds = (b - a) * binSeconds;
    if (seconds < FILLER_MIN_SECONDS || seconds > FILLER_MAX_SECONDS) return;
    const prevEnd = index > 0 ? segments[index - 1][1] : -Infinity;
    const nextStart = index < segments.length - 1 ? segments[index + 1][0] : Infinity;
    if (a - prevEnd < pause || nextStart - b < pause) return;
    // 始まりと終わりの目盛りは音の出だし・消えぎわなので除いて比べる
    const inner = Array.from(flux.subarray(a + 1, Math.max(a + 2, b - 1)));
    const innerZcr = Array.from(zcr.subarray(a + 1, Math.max(a + 2, b - 1)));
    if (median(inner) > typicalFlux * 0.5) return;
    if (median(innerZcr) > Math.max(typicalZcr * 1.2, 1e-6)) return;
    out.push([a * binSeconds, b * binSeconds]);
  });
  return out;
}

/** 作品の中で、いまタイムラインに残っている部分の口ぐせの候補（字幕から・音から） */
export function findFillers(project: Project, features: Map<string, VoiceFeatures>): FillerCandidate[] {
  const result = fillersFromSubtitles(project);
  for (const source of project.sources) {
    const f = features.get(source.id);
    if (!f) continue;
    for (const [start, end] of fillersFromSound(f)) {
      // 字幕で見つけたものと重なるものは、1つにする
      if (result.some((c) => c.sourceId === source.id && c.start < end && start < c.end)) continue;
      result.push({ id: `sound:${source.id}:${Math.round(start * 1000)}`, reason: 'sound', sourceId: source.id, start, end });
    }
  }
  // タイムラインに見えているものだけ
  return result
    .filter((c) => sourceRangeOnTimeline(project, c).length > 0)
    .sort((a, b) => (sourceRangeOnTimeline(project, a)[0]?.[0] ?? 0) - (sourceRangeOnTimeline(project, b)[0]?.[0] ?? 0));
}
