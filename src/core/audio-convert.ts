// 音を決まった形式（サンプリングレート・チャンネル数）にそろえる。
// 録画ごとに形式が違っても（44.1kHz と 48kHz、モノラルとステレオなど）、書き出す音は1つの形式にする。

/**
 * 続けて渡した音のかたまりを、途切れなく変換する。別の範囲の音を渡す前には reset() を呼ぶ。
 * サンプリングレートの変換は、となりのサンプルの間をなめらかにつなぐ方法（線形補間）で行う。
 */
export class AudioConverter {
  /** 次に出力するサンプルの位置（いまのかたまりの先頭を 0 とした、元の音のサンプル番号） */
  private position = 0;
  /** 前のかたまりの最後のサンプル（チャンネルごと）。かたまりの境目をつなぐのに使う */
  private previous: number[] | null = null;

  constructor(
    readonly targetRate: number,
    readonly targetChannels: number,
  ) {}

  reset(): void {
    this.position = 0;
    this.previous = null;
  }

  /** 元の音（チャンネルごとの配列）を変換する。返すのは targetChannels 本の配列 */
  push(channels: Float32Array[], sourceRate: number): Float32Array[] {
    const mixed = mixChannels(channels, this.targetChannels);
    const frames = mixed[0]?.length ?? 0;
    if (frames === 0) return mixed.map(() => new Float32Array(0));
    if (sourceRate === this.targetRate && this.position === 0) {
      // 同じ形式ならそのまま使う
      this.previous = mixed.map((ch) => ch[frames - 1]);
      return mixed;
    }
    const step = sourceRate / this.targetRate;
    const count = Math.max(0, Math.floor((frames - 1 - this.position) / step) + 1);
    const out = mixed.map(() => new Float32Array(count));
    let t = this.position;
    for (let k = 0; k < count; k++) {
      const i0 = Math.floor(t);
      const frac = t - i0;
      for (let c = 0; c < mixed.length; c++) {
        const data = mixed[c];
        const s0 = i0 < 0 ? (this.previous?.[c] ?? data[0]) : data[i0];
        const s1 = i0 + 1 < frames ? data[i0 + 1] : data[frames - 1];
        out[c][k] = s0 + frac * (s1 - s0);
      }
      t += step;
    }
    this.position = t - frames;
    this.previous = mixed.map((ch) => ch[frames - 1]);
    return out;
  }
}

/**
 * チャンネル数をそろえる。モノラルは左右に同じ音を入れ、5.1ch は左右にまとめる。
 * それ以外は前から順に使い、足りなければ最初のチャンネルを使う。
 */
export function mixChannels(channels: Float32Array[], target: number): Float32Array[] {
  if (channels.length === target) return channels;
  if (channels.length === 0) return [];
  const frames = channels[0].length;
  if (target === 2 && channels.length === 6) {
    // 並びは 左・右・中央・低音・左後ろ・右後ろ
    const [l, r, c, , sl, sr] = channels;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = l[i] + Math.SQRT1_2 * (c[i] + sl[i]);
      right[i] = r[i] + Math.SQRT1_2 * (c[i] + sr[i]);
    }
    return [left, right];
  }
  if (target === 1) {
    const mono = new Float32Array(frames);
    for (const ch of channels) for (let i = 0; i < frames; i++) mono[i] += ch[i] / channels.length;
    return [mono];
  }
  const result: Float32Array[] = [];
  for (let c = 0; c < target; c++) result.push(channels[c] ?? channels[0]);
  return result;
}
