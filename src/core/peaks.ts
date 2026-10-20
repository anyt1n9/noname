// 音の大きさの記録（波形の表示と、「間」を見つけるのに使う）。
// 一定の時間（1目盛り）ごとに、いちばん大きい値（peaks）と平均の大きさ（rms）を記録する。

/** 波形の1目盛りの長さ（秒） */
export const PEAK_BIN_SECONDS = 0.05;

export function peakBinCount(endTime: number, binSeconds = PEAK_BIN_SECONDS): number {
  return Math.max(1, Math.ceil(endTime / binSeconds));
}

/** 音のかたまりを順に足していき、目盛りごとの大きさを求める */
export class LevelAccumulator {
  readonly peaks: Float32Array;
  private sumSquares: Float64Array;
  private counts: Uint32Array;

  constructor(
    bins: number,
    readonly binSeconds = PEAK_BIN_SECONDS,
  ) {
    this.peaks = new Float32Array(bins);
    this.sumSquares = new Float64Array(bins);
    this.counts = new Uint32Array(bins);
  }

  /** startTime 秒から始まる音（チャンネルごとの配列）を足す。チャンネルはまとめて扱う */
  add(startTime: number, sampleRate: number, channels: Float32Array[]): void {
    if (channels.length === 0) return;
    const frames = channels[0].length;
    const bs = this.binSeconds;
    let i = 0;
    while (i < frames) {
      // 小数の誤差で目盛りがずれないよう、わずかに余裕を持たせる
      const bin = Math.floor((startTime + i / sampleRate) / bs + 1e-9);
      // この目盛りが終わるサンプルの位置
      const binEnd = Math.min(frames, Math.ceil(((bin + 1) * bs - startTime) * sampleRate - 1e-9));
      const until = Math.max(i + 1, binEnd);
      let max = 0;
      let sum = 0;
      for (const ch of channels) {
        for (let j = i; j < until; j++) {
          const v = ch[j];
          const a = v < 0 ? -v : v;
          if (a > max) max = a;
          sum += v * v;
        }
      }
      if (bin >= 0 && bin < this.peaks.length) {
        if (max > this.peaks[bin]) this.peaks[bin] = Math.min(1, max);
        this.sumSquares[bin] += sum / channels.length;
        this.counts[bin] += until - i;
      }
      i = until;
    }
  }

  /** 目盛りごとの平均の大きさ（0〜1） */
  rms(): Float32Array {
    const out = new Float32Array(this.peaks.length);
    for (let i = 0; i < out.length; i++) {
      out[i] = this.counts[i] > 0 ? Math.sqrt(this.sumSquares[i] / this.counts[i]) : 0;
    }
    return out;
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

/** 複数の音の大きさを、目盛りごとに大きいほうでまとめる（声が2つの音に入っているときなど） */
export function combineLevels(levels: Float32Array[]): Float32Array {
  if (levels.length === 1) return levels[0];
  const length = Math.max(0, ...levels.map((l) => l.length));
  const out = new Float32Array(length);
  for (const l of levels) for (let i = 0; i < l.length; i++) if (l[i] > out[i]) out[i] = l[i];
  return out;
}
