// 効果音をプログラムで作る（自作の音）。同じ音の ID なら、毎回まったく同じ音になる
import type { SoundId } from '../data/sfx';
import { BandPass, envelopeAt, LowPass, Noise, normalizePeak, Oscillator } from './synth';

/** 効果音（1チャンネル）。大きさの最大は 0.8 にそろえる */
export function renderSound(id: SoundId, sampleRate: number): Float32Array {
  const out = RENDER[id](sampleRate);
  normalizePeak([out], 0.8);
  return out;
}

/** 効果音の長さ（秒） */
export function soundSeconds(id: SoundId): number {
  return LENGTH[id];
}

const LENGTH: Record<SoundId, number> = {
  pikon: 0.45,
  don: 0.7,
  shu: 0.4,
  kira: 1.1,
  bubu: 0.55,
  pon: 0.25,
};

function buffer(id: SoundId, sampleRate: number): Float32Array {
  return new Float32Array(Math.ceil(LENGTH[id] * sampleRate));
}

/** 高さ hz の短い鐘のような音を、start 秒から足す */
function addBeep(out: Float32Array, sampleRate: number, start: number, hz: number, length: number, gain: number): void {
  const a = new Oscillator('sine', sampleRate);
  const b = new Oscillator('sine', sampleRate);
  const env = { attack: 0.004, decay: length / 3, sustain: 0, release: 0.02 };
  const from = Math.round(start * sampleRate);
  const count = Math.min(out.length - from, Math.round((length + 0.02) * sampleRate));
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const e = envelopeAt(env, t, length);
    out[from + i] += gain * e * (a.next(hz) + 0.25 * b.next(hz * 2));
  }
}

const RENDER: Record<SoundId, (sampleRate: number) => Float32Array> = {
  /** ピコン：短く高い音が2つ、上がっていく */
  pikon(rate) {
    const out = buffer('pikon', rate);
    addBeep(out, rate, 0, 1568, 0.09, 0.8);
    addBeep(out, rate, 0.08, 2349, 0.34, 1);
    return out;
  },

  /** ドン：低くて重い音。高さが下がりながら消える */
  don(rate) {
    const out = buffer('don', rate);
    const osc = new Oscillator('sine', rate);
    const sub = new Oscillator('sine', rate);
    const noise = new Noise(11);
    const lp = new LowPass(1800, rate);
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const hz = 42 + 130 * Math.exp(-t / 0.06);
      const body = Math.exp(-t / 0.22) * Math.min(1, t / 0.002);
      const click = Math.exp(-t / 0.008) * lp.next(noise.next());
      out[i] = body * (osc.next(hz) + 0.4 * sub.next(hz / 2)) + 0.5 * click;
    }
    return out;
  },

  /** シュッ：風を切るような音。高さが上がっていく */
  shu(rate) {
    const out = buffer('shu', rate);
    const noise = new Noise(23);
    const bp = new BandPass(rate);
    const length = out.length / rate;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const p = t / length;
      const center = 700 * Math.pow(9, p);
      const e = p < 0.35 ? p / 0.35 : Math.pow(1 - (p - 0.35) / 0.65, 2);
      out[i] = e * bp.next(noise.next(), center, 2.2);
    }
    return out;
  },

  /** キラーン：高い音が順に重なって、きらめくように消える */
  kira(rate) {
    const out = buffer('kira', rate);
    const notes = [2093, 2637, 3136, 4186];
    notes.forEach((hz, k) => addBeep(out, rate, k * 0.055, hz, 0.75 - k * 0.08, 0.7));
    // ゆらぎを足して、きらめいて聞こえるようにする
    const shimmer = new Oscillator('sine', rate);
    for (let i = 0; i < out.length; i++) out[i] *= 0.85 + 0.15 * shimmer.next(9);
    return out;
  },

  /** ブブー：低いブザーの音が2回 */
  bubu(rate) {
    const out = buffer('bubu', rate);
    const a = new Oscillator('square', rate);
    const b = new Oscillator('square', rate);
    const lp = new LowPass(2400, rate);
    const env = { attack: 0.01, decay: 1, sustain: 1, release: 0.03 };
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const second = t >= 0.26;
      const local = second ? t - 0.26 : t;
      const e = envelopeAt(env, local, second ? 0.26 : 0.19);
      out[i] = lp.next(e * (a.next(147) + 0.7 * b.next(152)));
    }
    return out;
  },

  /** ポン：軽くはじけるような短い音 */
  pon(rate) {
    const out = buffer('pon', rate);
    const osc = new Oscillator('soft', rate);
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const hz = 520 + 260 * Math.exp(-t / 0.015);
      out[i] = osc.next(hz) * Math.exp(-t / 0.05) * Math.min(1, t / 0.002);
    }
    return out;
  },
};
