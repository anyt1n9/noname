// 音の大きさ（ラウドネス）の計算。ITU-R BS.1770 の方法（K 特性で聞こえ方に合わせ、ゲートで静かな部分を除く）
import { MAX_VOICE_BOOST_DB, MAX_VOICE_CUT_DB, VOICE_TARGET_LUFS } from '../data/voice';

/** 2次のフィルター（係数は a0 = 1 にそろえたもの） */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}
  next(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** 聞こえ方に合わせるフィルター（K 特性）。どの速さ（サンプリング周波数）でも同じ形になるよう係数を計算する */
export class KWeighting {
  private shelf: Biquad;
  private highPass: Biquad;
  constructor(sampleRate: number) {
    {
      const f0 = 1681.974450955533;
      const G = 3.999843853973347;
      const Q = 0.7071752369554196;
      const K = Math.tan((Math.PI * f0) / sampleRate);
      const Vh = Math.pow(10, G / 20);
      const Vb = Math.pow(Vh, 0.4996667741545416);
      const a0 = 1 + K / Q + K * K;
      this.shelf = new Biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
    }
    {
      const f0 = 38.13547087602444;
      const Q = 0.5003270373238773;
      const K = Math.tan((Math.PI * f0) / sampleRate);
      const a0 = 1 + K / Q + K * K;
      this.highPass = new Biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
    }
  }
  next(x: number): number {
    return this.highPass.next(this.shelf.next(x));
  }
}

/** 平均の二乗（K 特性をかけたもの）から LUFS */
export function toLufs(meanSquare: number): number {
  return -0.691 + 10 * Math.log10(Math.max(meanSquare, 1e-12));
}

/**
 * 全体の大きさ（統合ラウドネス、LUFS）。loud は目盛り（binSeconds 秒）ごとの、K 特性をかけた平均の二乗。
 * 400ミリ秒のかたまりを100ミリ秒ずつずらして調べ、-70 LUFS より静かなところと、平均より 10 LU 以上静かなところを除く。
 * 音がまったくなければ null。
 */
export function integratedLoudness(loud: Float32Array, binSeconds: number): number | null {
  const per = Math.max(1, Math.round(0.4 / binSeconds));
  const step = Math.max(1, Math.round(0.1 / binSeconds));
  const blocks: number[] = [];
  for (let i = 0; i + per <= loud.length; i += step) {
    let sum = 0;
    for (let k = i; k < i + per; k++) sum += loud[k];
    blocks.push(sum / per);
  }
  const absolute = blocks.filter((ms) => toLufs(ms) > -70);
  if (absolute.length === 0) return null;
  const relative = toLufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const gated = absolute.filter((ms) => toLufs(ms) > relative);
  if (gated.length === 0) return null;
  return toLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** 声の大きさを目標にそろえるための倍率（いまの大きさ measured LUFS から） */
export function gainToTarget(measured: number, target = VOICE_TARGET_LUFS): number {
  const db = Math.min(MAX_VOICE_BOOST_DB, Math.max(-MAX_VOICE_CUT_DB, target - measured));
  return Math.pow(10, db / 20);
}

export function toDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-6));
}
