// 音の形（波形）の計算。一定の時間ごとに、音の大きさの最大値を記録する

/** 波形の1目盛りの長さ（秒） */
export const PEAK_BIN_SECONDS = 0.05;

export function peakBinCount(endTime: number, binSeconds = PEAK_BIN_SECONDS): number {
  return Math.max(1, Math.ceil(endTime / binSeconds));
}

/**
 * startTime 秒から始まる音（チャンネルごとの配列）を、peaks に書き込む。
 * 複数のチャンネルは大きいほうを使う。
 */
export function addToPeaks(
  peaks: Float32Array,
  binSeconds: number,
  startTime: number,
  sampleRate: number,
  channels: Float32Array[],
): void {
  if (channels.length === 0) return;
  const frames = channels[0].length;
  let i = 0;
  while (i < frames) {
    // 小数の誤差で目盛りがずれないよう、わずかに余裕を持たせる
    const bin = Math.floor((startTime + i / sampleRate) / binSeconds + 1e-9);
    // この目盛りが終わるサンプルの位置
    const binEnd = Math.min(frames, Math.ceil(((bin + 1) * binSeconds - startTime) * sampleRate - 1e-9));
    const until = Math.max(i + 1, binEnd);
    let max = 0;
    for (const ch of channels) {
      for (let j = i; j < until; j++) {
        const v = ch[j] < 0 ? -ch[j] : ch[j];
        if (v > max) max = v;
      }
    }
    if (bin >= 0 && bin < peaks.length && max > peaks[bin]) peaks[bin] = Math.min(1, max);
    i = until;
  }
}

/** 録画の時刻 from〜to の範囲で、一番大きい音 */
export function peakBetween(peaks: Float32Array, binSeconds: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from / binSeconds));
  const b = Math.min(peaks.length, Math.max(a + 1, Math.ceil(to / binSeconds)));
  let max = 0;
  for (let i = a; i < b; i++) if (peaks[i] > max) max = peaks[i];
  return max;
}
