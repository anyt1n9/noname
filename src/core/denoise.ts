// 雑音を減らす（v0.7）。エアコンの音など、ずっと鳴っている雑音の「音色」を静かな部分から調べておき、
// 音を短いかけらに分けて、高さごとに雑音の分だけ小さくする（スペクトルの引き算）。
// 少しずつ入れて少しずつ取り出せる。
import type { DenoiseStrength } from '../data/voice';
import { DENOISE_STRENGTHS } from '../data/voice';
import { fft } from './fft';

/** かけらの大きさ（サンプル数）。半分ずつ重ねる */
export const DENOISE_FRAME = 1024;
const HOP = DENOISE_FRAME / 2;

/** 雑音の音色。高さごとの平均の大きさ（0〜サンプリング周波数の半分を DENOISE_FRAME/2+1 個に分けたもの） */
export interface NoiseProfile {
  sampleRate: number;
  magnitudes: number[];
}

/** 重ねて元に戻せる窓（Hann の平方根） */
function sqrtHann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  return w;
}

/** 静かな部分の音（いくつかのかたまり）から、雑音の音色を調べる */
export function measureNoise(pieces: Float32Array[], sampleRate: number): NoiseProfile | null {
  const w = sqrtHann(DENOISE_FRAME);
  const sum = new Float64Array(DENOISE_FRAME / 2 + 1);
  let frames = 0;
  const re = new Float64Array(DENOISE_FRAME);
  const im = new Float64Array(DENOISE_FRAME);
  for (const piece of pieces) {
    for (let start = 0; start + DENOISE_FRAME <= piece.length; start += HOP) {
      for (let i = 0; i < DENOISE_FRAME; i++) {
        re[i] = piece[start + i] * w[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let i = 0; i <= DENOISE_FRAME / 2; i++) sum[i] += Math.hypot(re[i], im[i]);
      frames++;
    }
  }
  if (frames === 0) return null;
  return { sampleRate, magnitudes: Array.from(sum, (v) => v / frames) };
}

/** 別の速さ（サンプリング周波数）で使うときは、高さを合わせて読み替える */
function profileFor(profile: NoiseProfile, sampleRate: number): Float64Array {
  const half = DENOISE_FRAME / 2;
  const out = new Float64Array(half + 1);
  for (let i = 0; i <= half; i++) {
    const hz = (i / DENOISE_FRAME) * sampleRate;
    const pos = (hz / profile.sampleRate) * DENOISE_FRAME;
    const a = Math.floor(pos);
    const frac = pos - a;
    const m = profile.magnitudes;
    const va = m[Math.min(a, half)] ?? 0;
    const vb = m[Math.min(a + 1, half)] ?? va;
    out[i] = a > half ? m[half] : va + (vb - va) * frac;
  }
  return out;
}

export class NoiseReducer {
  private readonly window = sqrtHann(DENOISE_FRAME);
  private readonly noise: Float64Array;
  private readonly over: number;
  private readonly floor: number;
  /** 入力のたまり（チャンネルごと）と、重ねている途中の出力 */
  private input: Float32Array[];
  private filled = 0;
  private acc: Float64Array[];
  private gains = new Float64Array(DENOISE_FRAME / 2 + 1).fill(1);
  private started = false;
  /** はじめの半かけら分は、出力が遅れて出てくる。その分を最後に詰める */
  private pending = 0;

  constructor(
    private channels: number,
    sampleRate: number,
    profile: NoiseProfile,
    strength: DenoiseStrength,
  ) {
    this.noise = profileFor(profile, sampleRate);
    const s = DENOISE_STRENGTHS.find((x) => x.value === strength) ?? DENOISE_STRENGTHS[0];
    this.over = s.over;
    this.floor = s.floor;
    this.input = Array.from({ length: channels }, () => new Float32Array(DENOISE_FRAME));
    this.acc = Array.from({ length: channels }, () => new Float64Array(DENOISE_FRAME));
    // 最初の半かけらは、前に何もないものとして始める
    this.filled = HOP;
  }

  /** 入力を足し、できた分の出力を返す（入れた量と出てくる量は、最後に flush すれば同じになる） */
  push(data: Float32Array[]): Float32Array[] {
    const n = data[0]?.length ?? 0;
    const outs: Float32Array[][] = [];
    let i = 0;
    while (i < n) {
      const take = Math.min(n - i, DENOISE_FRAME - this.filled);
      for (let c = 0; c < this.channels; c++) this.input[c].set((data[c] ?? data[0]).subarray(i, i + take), this.filled);
      this.filled += take;
      i += take;
      if (this.filled === DENOISE_FRAME) outs.push(this.processFrame());
    }
    this.pending += n;
    return this.collect(outs);
  }

  flush(): Float32Array[] {
    const outs: Float32Array[][] = [];
    // 残りを無音で埋めて、全部出し切る
    for (let k = 0; k < 2; k++) {
      for (let c = 0; c < this.channels; c++) this.input[c].fill(0, this.filled);
      this.filled = DENOISE_FRAME;
      outs.push(this.processFrame());
    }
    return this.collect(outs);
  }

  /** 出してよい分だけ返す（入れた量より多くは出さない） */
  private collect(outs: Float32Array[][]): Float32Array[] {
    let total = 0;
    for (const o of outs) total += o[0].length;
    // 最初の半かけらは、前の無音の分なので捨てる
    let skip = this.started ? 0 : HOP;
    if (!this.started && total > 0) this.started = true;
    const length = Math.max(0, Math.min(total - skip, this.pending));
    const result = Array.from({ length: this.channels }, () => new Float32Array(length));
    let pos = 0;
    for (const o of outs) {
      let from = 0;
      if (skip > 0) {
        from = Math.min(skip, o[0].length);
        skip -= from;
      }
      const take = Math.min(o[0].length - from, length - pos);
      if (take <= 0) continue;
      for (let c = 0; c < this.channels; c++) result[c].set(o[c].subarray(from, from + take), pos);
      pos += take;
    }
    this.pending -= length;
    return result;
  }

  /** たまった1かけらを処理し、前半の HOP サンプルを出す */
  private processFrame(): Float32Array[] {
    const N = DENOISE_FRAME;
    const half = N / 2;
    const spectra = this.input.map((buf) => {
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = buf[i] * this.window[i];
      fft(re, im);
      return { re, im };
    });
    // 高さごとに、どれだけ小さくするかを決める（全チャンネルで同じにする）
    const raw = new Float64Array(half + 1);
    for (let i = 0; i <= half; i++) {
      let mag = 0;
      for (const s of spectra) mag += Math.hypot(s.re[i], s.im[i]);
      mag /= spectra.length;
      raw[i] = Math.max(this.floor, 1 - (this.over * this.noise[i]) / Math.max(mag, 1e-9));
    }
    for (let i = 0; i <= half; i++) {
      // となりの高さとならし、時間の変化もならす（ちりちりした音が出にくい）
      const smooth = (raw[Math.max(0, i - 1)] + raw[i] * 2 + raw[Math.min(half, i + 1)]) / 4;
      const prev = this.gains[i];
      this.gains[i] = smooth > prev ? prev + (smooth - prev) * 0.7 : prev + (smooth - prev) * 0.35;
    }
    const out: Float32Array[] = [];
    for (let c = 0; c < this.channels; c++) {
      const { re, im } = spectra[c];
      for (let i = 0; i <= half; i++) {
        const g = this.gains[i];
        re[i] *= g;
        im[i] *= g;
        if (i > 0 && i < half) {
          re[N - i] = re[i];
          im[N - i] = -im[i];
        }
      }
      fft(re, im, true);
      const acc = this.acc[c];
      for (let i = 0; i < N; i++) acc[i] += re[i] * this.window[i];
      out.push(Float32Array.from(acc.subarray(0, HOP)));
      acc.copyWithin(0, HOP);
      acc.fill(0, N - HOP);
      // 後半を次のかけらの前半にする
      this.input[c].copyWithin(0, HOP);
    }
    this.filled = N - HOP;
    return out;
  }
}
