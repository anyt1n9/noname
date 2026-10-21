// 音の調べで、大きさのほかに記録する特徴（v0.7）。
// 目盛り（50ミリ秒）ごとに、聞こえ方に合わせた大きさ（ラウドネス用）・音色の変わり方・0 をまたぐ回数を記録する。
import { fft, hann } from './fft';
import { KWeighting } from './loudness';
import { PEAK_BIN_SECONDS } from './peaks';

/** 音色の変わり方を調べる窓の大きさ（間引いたあとのサンプル数） */
const SPECTRUM_SIZE = 256;
/** 音色を調べるときに間引く目安（だいたい 12kHz にする） */
const TARGET_RATE = 12000;

export interface TrackFeatures {
  /** 目盛りごとの、K 特性をかけた平均の二乗（左右の合計。ステレオで聞いたときの大きさ） */
  loud: Float32Array;
  /** 目盛りごとの、前の目盛りからの音色の変わり方（0〜1。のばした声では小さい） */
  flux: Float32Array;
  /** 目盛りごとの、0 をまたぐ割合（「さ」「し」などのこすれる音で大きい） */
  zcr: Float32Array;
}

export class FeatureAccumulator {
  private loud: Float64Array;
  private loudCount: Uint32Array;
  private flux: Float32Array;
  private zcr: Float32Array;
  private zcrCount: Uint32Array;
  private filters: KWeighting[] = [];
  private rate = 0;
  private decimate = 1;
  /** 間引いた声（左右を混ぜたもの）の、いまの目盛りの分 */
  private buf: Float64Array = new Float64Array(SPECTRUM_SIZE);
  private bufLength = 0;
  private bufBin = -1;
  private prevSpectrum: Float64Array | null = null;
  private decimAcc = 0;
  private decimCount = 0;
  private lastSign: number[] = [];
  private window = hann(SPECTRUM_SIZE);

  constructor(
    private bins: number,
    readonly binSeconds = PEAK_BIN_SECONDS,
  ) {
    this.loud = new Float64Array(bins);
    this.loudCount = new Uint32Array(bins);
    this.flux = new Float32Array(bins);
    this.zcr = new Float32Array(bins);
    this.zcrCount = new Uint32Array(bins);
  }

  /** startTime 秒から始まる音（チャンネルごとの配列）を足す */
  add(startTime: number, sampleRate: number, channels: Float32Array[]): void {
    if (channels.length === 0) return;
    if (this.rate !== sampleRate) {
      this.rate = sampleRate;
      this.filters = channels.map(() => new KWeighting(sampleRate));
      this.decimate = Math.max(1, Math.round(sampleRate / TARGET_RATE));
      this.lastSign = channels.map(() => 0);
    }
    while (this.filters.length < channels.length) this.filters.push(new KWeighting(sampleRate));
    const frames = channels[0].length;
    // モノラルは左右に同じ音を出すので、ステレオで聞いたときの大きさにする
    const stereoFactor = channels.length === 1 ? 2 : 2 / channels.length;
    const bs = this.binSeconds;
    const first = channels[0];
    let i = 0;
    while (i < frames) {
      // 目盛りごとにまとめて計算する（小数の誤差で目盛りがずれないよう、わずかに余裕を持たせる）
      const bin = Math.floor((startTime + i / sampleRate) / bs + 1e-9);
      const binEnd = Math.min(frames, Math.ceil(((bin + 1) * bs - startTime) * sampleRate - 1e-9));
      const until = Math.max(i + 1, binEnd);
      if (bin < 0 || bin >= this.bins) {
        i = until;
        continue;
      }
      let ms = 0;
      for (let c = 0; c < channels.length; c++) {
        const ch = channels[c];
        const f = this.filters[c];
        for (let j = i; j < until; j++) {
          const k = f.next(ch[j]);
          ms += k * k;
        }
      }
      // 0 をまたぐ回数（1つ目のチャンネルで数える）
      let crossings = 0;
      let last = this.lastSign[0];
      for (let j = i; j < until; j++) {
        const v = first[j];
        const sign = v > 0 ? 1 : v < 0 ? -1 : 0;
        if (sign !== 0) {
          if (last !== 0 && sign !== last) crossings++;
          last = sign;
        }
      }
      this.lastSign[0] = last;
      this.loud[bin] += ms * stereoFactor;
      this.loudCount[bin] += until - i;
      this.zcr[bin] += crossings;
      this.zcrCount[bin] += until - i;
      // 音色を調べるため、間引いて目盛りの始めの部分をためる
      for (let j = i; j < until; j++) {
        let mono = 0;
        for (let c = 0; c < channels.length; c++) mono += channels[c][j];
        this.decimAcc += mono / channels.length;
        this.decimCount++;
        if (this.decimCount >= this.decimate) {
          this.pushSpectrumSample(bin, this.decimAcc / this.decimCount);
          this.decimAcc = 0;
          this.decimCount = 0;
        }
      }
      i = until;
    }
  }

  private pushSpectrumSample(bin: number, v: number): void {
    if (bin !== this.bufBin) {
      this.finishSpectrum();
      this.bufBin = bin;
      this.bufLength = 0;
    }
    if (this.bufLength < SPECTRUM_SIZE) this.buf[this.bufLength++] = v;
  }

  private finishSpectrum(): void {
    if (this.bufBin < 0 || this.bufLength < SPECTRUM_SIZE / 2) return;
    const re = new Float64Array(SPECTRUM_SIZE);
    const im = new Float64Array(SPECTRUM_SIZE);
    for (let i = 0; i < this.bufLength; i++) re[i] = this.buf[i] * this.window[i];
    fft(re, im);
    const spec = new Float64Array(SPECTRUM_SIZE / 2);
    let total = 0;
    for (let i = 1; i < SPECTRUM_SIZE / 2; i++) {
      spec[i] = Math.log1p(100 * Math.hypot(re[i], im[i]));
      total += spec[i];
    }
    if (this.prevSpectrum && total > 0) {
      let diff = 0;
      for (let i = 1; i < SPECTRUM_SIZE / 2; i++) diff += Math.abs(spec[i] - this.prevSpectrum[i]);
      const prevTotal = this.prevSpectrum.reduce((a, b) => a + b, 0);
      this.flux[this.bufBin] = Math.min(1, diff / Math.max(total, prevTotal, 1e-9));
    }
    this.prevSpectrum = spec;
  }

  result(): TrackFeatures {
    this.finishSpectrum();
    const loud = new Float32Array(this.bins);
    const zcr = new Float32Array(this.bins);
    for (let i = 0; i < this.bins; i++) {
      loud[i] = this.loudCount[i] > 0 ? this.loud[i] / this.loudCount[i] : 0;
      zcr[i] = this.zcrCount[i] > 0 ? this.zcr[i] / this.zcrCount[i] : 0;
    }
    return { loud, flux: this.flux.slice(), zcr };
  }
}
