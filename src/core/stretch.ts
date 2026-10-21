// 音の速さを変える（声の高さは変えない）。WSOLA という方法で、音を短いかけらに分け、
// 波の形が自然につながる位置を探しながら、間を詰めたり広げたりして重ねる。
// 少しずつ入れて少しずつ取り出せる（3時間の録画でもメモリに溜めない）。

/** かけらの長さ（秒） */
const FRAME_SECONDS = 0.03;
/** つながる位置を探す幅（秒、前後それぞれ） */
const SEARCH_SECONDS = 0.01;
/** 位置を大まかに探すときの間引き（この数ごとに比べる） */
const COARSE = 4;

export class TimeStretcher {
  private readonly frame: number;
  private readonly hop: number;
  private readonly analysisHop: number;
  private readonly tolerance: number;
  private readonly window: Float32Array;
  /** まだ使い終わっていない入力（チャンネルごと）と、その左右を混ぜたもの */
  private input: Float32Array[];
  private mono: Float32Array;
  private length = 0;
  /** input[0] が、入力の最初から何サンプル目か */
  private offset = 0;
  private totalIn = 0;
  /** 重ねている途中の出力 */
  private acc: Float32Array[];
  private k = 0;
  private prevPos = 0;
  private ended = false;

  constructor(
    private channels: number,
    sampleRate: number,
    readonly speed: number,
  ) {
    this.frame = Math.max(64, Math.round((FRAME_SECONDS * sampleRate) / 2) * 2);
    this.hop = this.frame / 2;
    this.analysisHop = this.hop * speed;
    this.tolerance = Math.round(SEARCH_SECONDS * sampleRate);
    this.window = new Float32Array(this.frame);
    for (let i = 0; i < this.frame; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frame);
    const capacity = this.frame * 8;
    this.input = Array.from({ length: channels }, () => new Float32Array(capacity));
    this.mono = new Float32Array(capacity);
    this.acc = Array.from({ length: channels }, () => new Float32Array(this.frame));
  }

  /** 入力を足し、できた分の出力を返す */
  push(data: Float32Array[]): Float32Array[] {
    const n = data[0]?.length ?? 0;
    if (this.speed === 1) return data.map((d) => d.slice());
    this.append(data, n);
    return this.process();
  }

  /** 入力が終わったら呼ぶ。残りの出力を返す */
  flush(): Float32Array[] {
    if (this.speed === 1) return Array.from({ length: this.channels }, () => new Float32Array(0));
    this.ended = true;
    const out = this.process();
    // 重ねている途中の分も出す
    const tail = this.acc.map((a) => a.slice(0, this.hop));
    return out.map((o, c) => concat(o, tail[c]));
  }

  private append(data: Float32Array[], n: number): void {
    if (this.length + n > this.mono.length) {
      const size = Math.max(this.mono.length * 2, this.length + n);
      this.input = this.input.map((buf) => grow(buf, size, this.length));
      this.mono = grow(this.mono, size, this.length);
    }
    for (let c = 0; c < this.channels; c++) this.input[c].set((data[c] ?? data[0]).subarray(0, n), this.length);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let c = 0; c < this.channels; c++) v += (data[c] ?? data[0])[i];
      this.mono[this.length + i] = v / this.channels;
    }
    this.length += n;
    this.totalIn += n;
  }

  /** 入力の絶対位置 p の値（範囲の外は 0） */
  private monoAt(p: number): number {
    const i = p - this.offset;
    return i >= 0 && i < this.length ? this.mono[i] : 0;
  }

  private process(): Float32Array[] {
    const pieces: Float32Array[][] = [];
    for (;;) {
      const ideal = Math.round(this.k * this.analysisHop);
      const needed = Math.max(ideal + this.tolerance + this.frame, this.prevPos + this.hop + this.frame);
      if (!this.ended && needed > this.totalIn) break;
      if (this.ended && ideal >= this.totalIn) break;
      const pos = this.k === 0 ? 0 : this.bestPosition(ideal, this.prevPos + this.hop);
      // かけらに窓をかけて重ねる
      for (let c = 0; c < this.channels; c++) {
        const a = this.acc[c];
        const src = this.input[c];
        for (let i = 0; i < this.frame; i++) {
          const j = pos + i - this.offset;
          if (j >= 0 && j < this.length) a[i] += src[j] * this.window[i];
        }
      }
      // 前半はもう重ならないので出す
      pieces.push(this.acc.map((a) => a.slice(0, this.hop)));
      for (const a of this.acc) {
        a.copyWithin(0, this.hop);
        a.fill(0, this.frame - this.hop);
      }
      this.prevPos = pos;
      this.k++;
      this.trim(Math.min(pos, Math.round(this.k * this.analysisHop) - this.tolerance));
    }
    return Array.from({ length: this.channels }, (_, c) => {
      const out = new Float32Array(pieces.length * this.hop);
      pieces.forEach((p, i) => out.set(p[c], i * this.hop));
      return out;
    });
  }

  /** ideal の前後で、target から続く波の形に一番よく合う位置 */
  private bestPosition(ideal: number, target: number): number {
    const lo = Math.max(0, ideal - this.tolerance);
    const hi = ideal + this.tolerance;
    const span = this.hop;
    const score = (p: number, step: number) => {
      let s = 0;
      for (let i = 0; i < span; i += step) s += this.monoAt(p + i) * this.monoAt(target + i);
      return s;
    };
    let best = Math.min(Math.max(ideal, lo), hi);
    let bestScore = -Infinity;
    for (let p = lo; p <= hi; p += COARSE) {
      const s = score(p, COARSE);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    // 近くを細かく探し直す
    const center = best;
    bestScore = -Infinity;
    for (let p = Math.max(lo, center - COARSE + 1); p <= Math.min(hi, center + COARSE - 1); p++) {
      const s = score(p, 1);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    return best;
  }

  /** 絶対位置 keepFrom より前の入力を捨てる */
  private trim(keepFrom: number): void {
    const drop = Math.min(this.length, keepFrom - this.offset);
    if (drop < this.frame * 2) return;
    for (const buf of this.input) buf.copyWithin(0, drop, this.length);
    this.mono.copyWithin(0, drop, this.length);
    this.length -= drop;
    this.offset += drop;
  }
}

function grow(buf: Float32Array, size: number, used: number): Float32Array {
  const next = new Float32Array(size);
  next.set(buf.subarray(0, used));
  return next;
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
