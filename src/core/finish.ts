// 声の仕上げ（v0.7）：声の大きさをそろえる・雑音を調べる場所を選ぶ
import { NOISE_SAMPLE_SECONDS } from '../data/voice';
import { gainToTarget, toDb } from './loudness';
import { setSourceAudio, sourceAudio, usedSources, type Project } from './project';
import { speakingBins, type VoiceLevel } from './silence';

/**
 * 録画ごとの声の大きさ（LUFS）から、声の大きさを目標にそろえる。どれだけ変えたか（dB）も返す。
 * 声の音がない録画・調べられなかった録画（null）はそのまま。
 */
export function normalizeVoices(project: Project, loudness: Map<string, number | null>): { project: Project; changes: { sourceId: string; db: number }[] } {
  let p = project;
  const changes: { sourceId: string; db: number }[] = [];
  for (const source of usedSources(project)) {
    const measured = loudness.get(source.id);
    if (measured === null || measured === undefined) continue;
    const gain = gainToTarget(measured);
    const audio = sourceAudio(p, source.id);
    if (Math.abs(audio.voiceGain - gain) < 1e-4) continue;
    p = setSourceAudio(p, source.id, { ...audio, voiceGain: gain });
    changes.push({ sourceId: source.id, db: toDb(gain) });
  }
  return { project: p, changes };
}

/**
 * 雑音の音色を調べるための、しゃべっていない静かな部分（録画の中の時刻）。
 * しゃべりの前後 0.1 秒はよけて、静かな順に合計 seconds 秒まで選ぶ。
 */
export function quietRanges(level: VoiceLevel, seconds = NOISE_SAMPLE_SECONDS): [number, number][] {
  const { rms, binSeconds } = level;
  const speaking = speakingBins(level);
  const margin = Math.ceil(0.1 / binSeconds);
  const quiet = speaking.map((_, i) => {
    for (let k = Math.max(0, i - margin); k <= Math.min(speaking.length - 1, i + margin); k++) if (speaking[k]) return false;
    return true;
  });
  const stretches: { a: number; b: number; level: number }[] = [];
  for (let i = 0; i < quiet.length; ) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    let sum = 0;
    while (j < quiet.length && quiet[j]) sum += rms[j++];
    if ((j - i) * binSeconds >= 0.25) stretches.push({ a: i, b: j, level: sum / (j - i) });
    i = j;
  }
  stretches.sort((x, y) => x.level - y.level);
  const out: [number, number][] = [];
  let total = 0;
  for (const s of stretches) {
    if (total >= seconds) break;
    const length = Math.min((s.b - s.a) * binSeconds, seconds - total, 2);
    out.push([s.a * binSeconds, s.a * binSeconds + length]);
    total += length;
  }
  return out.sort((x, y) => x[0] - y[0]);
}
