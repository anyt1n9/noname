// 音をプログラムで作るための部品（効果音と、入っている曲で使う）。
// 乱数は種（シード）つきのものだけを使い、毎回まったく同じ音になるようにする。

/** 種つきの乱数（xorshift32）。-1〜1 の値を返す */
export class Noise {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x / 2147483648 - 1;
  }
}

/** 音の高さ（MIDI の番号）から周波数（Hz） */
export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

const TABLE_SIZE = 2048;

/** 1周期分の波の形（倍音の大きさから作る） */
function makeTable(harmonics: number[]): Float32Array {
  const table = new Float32Array(TABLE_SIZE + 1);
  let peak = 0;
  for (let i = 0; i < TABLE_SIZE; i++) {
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      if (harmonics[h] !== 0) v += harmonics[h] * Math.sin((2 * Math.PI * (h + 1) * i) / TABLE_SIZE);
    }
    table[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < TABLE_SIZE; i++) table[i] /= peak || 1;
  table[TABLE_SIZE] = table[0];
  return table;
}

export type WaveId = 'sine' | 'soft' | 'saw' | 'square' | 'organ';

let tables: Record<WaveId, Float32Array> | null = null;
function wave(id: WaveId): Float32Array {
  tables ??= {
    sine: makeTable([1]),
    soft: makeTable([1, 0.35, 0.12, 0.05]),
    saw: makeTable(Array.from({ length: 10 }, (_, i) => 1 / (i + 1))),
    square: makeTable(Array.from({ length: 11 }, (_, i) => (i % 2 === 0 ? 1 / (i + 1) : 0))),
    organ: makeTable([1, 0.5, 0.25, 0, 0.12, 0, 0, 0.06]),
  };
  return tables[id];
}

/** 波の形を、指定の周波数で読む係 */
export class Oscillator {
  private phase = 0;
  private table: Float32Array;
  constructor(
    id: WaveId,
    private sampleRate: number,
  ) {
    this.table = wave(id);
  }
  /** 次の1サンプル。hz は毎回変えてよい（音の高さを動かすため） */
  next(hz: number): number {
    const pos = this.phase * TABLE_SIZE;
    const i = pos | 0;
    const frac = pos - i;
    const v = this.table[i] + (this.table[i + 1] - this.table[i]) * frac;
    this.phase += hz / this.sampleRate;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);
    return v;
  }
}

/**
 * 音の大きさの形（立ち上がり・減り方・鳴らし終わり）。
 * attack 秒で最大になり、decay 秒ごとに約 1/e ずつ sustain に近づく。gate 秒で離して release 秒で消える。
 */
export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export function envelopeAt(env: Envelope, t: number, gate: number): number {
  const held = (x: number) => {
    if (x < env.attack) return env.attack > 0 ? x / env.attack : 1;
    const d = x - env.attack;
    return env.sustain + (1 - env.sustain) * Math.exp(-d / Math.max(env.decay, 1e-4));
  };
  if (t < gate) return held(t);
  const r = t - gate;
  if (r >= env.release) return 0;
  return held(gate) * (1 - r / Math.max(env.release, 1e-4));
}

/** 低い音を通す簡単なフィルター（1次） */
export class LowPass {
  private y = 0;
  private a: number;
  constructor(cutoff: number, sampleRate: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  }
  set(cutoff: number, sampleRate: number): void {
    this.a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  }
  next(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/** ある範囲の高さの音だけを通すフィルター（2次。中心の高さを毎回変えられる） */
export class BandPass {
  private low = 0;
  private band = 0;
  constructor(private sampleRate: number) {}
  next(x: number, center: number, q: number): number {
    const f = 2 * Math.sin((Math.PI * Math.min(center, this.sampleRate / 6)) / this.sampleRate);
    const high = x - this.low - this.band / q;
    this.band += f * high;
    this.low += f * this.band;
    return this.band;
  }
}

/** いちばん大きいところが peak になるよう大きさをそろえる */
export function normalizePeak(channels: Float32Array[], peak: number): void {
  let max = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i]));
  if (max <= 0) return;
  const k = peak / max;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= k;
}

/** 平均の大きさ（RMS）を rms にそろえ、はみ出しそうなところはなめらかに抑える */
export function normalizeRms(channels: Float32Array[], rms: number): void {
  let sum = 0;
  let n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    n += ch.length;
  }
  const current = Math.sqrt(sum / Math.max(n, 1));
  if (current <= 0) return;
  const k = rms / current;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = softClip(ch[i] * k);
}

/** 0.9 を超えたあたりから、なめらかに 1 までに抑える */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.9) return x;
  const over = (a - 0.9) / 0.1;
  return Math.sign(x) * (0.9 + 0.1 * Math.tanh(over));
}
