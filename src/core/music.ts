// テロッパに入っている BGM を、楽譜のデータ（src/data/music.ts）からプログラムで作る。
// 曲は「くり返しの1回分」だけ作る。最後にのびた音は最初に回り込ませるので、つなぎ目なくくり返せる。
import type { Instrument, MusicTrack } from '../data/music';
import { envelopeAt, LowPass, midiToHz, Noise, normalizeRms, Oscillator, type Envelope, type WaveId } from './synth';

export interface RenderedMusic {
  sampleRate: number;
  /** 左と右 */
  channels: [Float32Array, Float32Array];
  /** くり返し1回分の長さ（秒） */
  loopSeconds: number;
}

/** 1つの音符（目盛りの単位） */
export interface NoteToken {
  /** 和音の何番目の音か。-1 なら和音すべて */
  n: number;
  step: number;
  len: number;
  velocity: number;
}

/** 並びの文字（例：'0 - 2 . c x!'）を音符に直す */
export function parsePattern(text: string): NoteToken[] {
  const tokens = text.trim().split(/\s+/);
  const notes: NoteToken[] = [];
  tokens.forEach((raw, step) => {
    if (raw === '-') {
      const last = notes[notes.length - 1];
      if (last && last.step + last.len === step) last.len++;
      return;
    }
    if (raw === '.' || raw === '') return;
    let token = raw;
    let velocity = 0.8;
    if (token.endsWith('!')) {
      velocity = 1;
      token = token.slice(0, -1);
    } else if (token.endsWith('?')) {
      velocity = 0.5;
      token = token.slice(0, -1);
    }
    if (token === 'X') velocity = 1;
    const n = token === 'c' ? -1 : token === 'x' || token === 'X' ? 0 : Number(token);
    if (!Number.isInteger(n)) return;
    notes.push({ n, step, len: 1, velocity });
  });
  return notes;
}

const NOTE_NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITIES: [string, number[]][] = [
  ['maj7', [0, 4, 7, 11]],
  ['m7', [0, 3, 7, 10]],
  ['sus4', [0, 5, 7]],
  ['7', [0, 4, 7, 10]],
  ['m', [0, 3, 7]],
  ['', [0, 4, 7]],
];

/** 和音の名前（例：'Am'・'Fmaj7'）から、音の高さ（MIDI の番号）の並び。根の音は F#2〜F3 に置く */
export function chordNotes(name: string): number[] {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  if (!m) return [48, 52, 55];
  let pc = NOTE_NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  pc = (pc + 12) % 12;
  const root = 48 + pc - (pc >= 6 ? 12 : 0);
  const intervals = QUALITIES.find(([q]) => q === m[3])?.[1] ?? [0, 4, 7];
  return intervals.map((i) => root + i);
}

/** 和音の n 番目の音（和音の音の数を超えたら1つ上の高さ） */
export function chordTone(chord: number[], n: number): number {
  const k = chord.length;
  return chord[((n % k) + k) % k] + 12 * Math.floor(n / k);
}

/** 入っている曲を作る */
export function renderMusic(track: MusicTrack, sampleRate: number): RenderedMusic {
  const beat = 60 / track.bpm;
  const bar = beat * 4;
  const loopSeconds = bar * track.chords.length;
  const length = Math.round(loopSeconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const echoL = new Float32Array(length);
  const echoR = new Float32Array(length);
  const chords = track.chords.map(chordNotes);
  let seed = 1;
  for (const part of track.parts) {
    const bars = part.bars.map(parsePattern);
    const stepSeconds = bar / part.steps;
    const pan = part.pan ?? 0;
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);
    const echo = part.echo ?? 0;
    for (let b = 0; b < chords.length; b++) {
      for (const note of bars[b % bars.length]) {
        const start = b * bar + note.step * stepSeconds;
        const gate = note.len * stepSeconds;
        const pitches = isDrum(part.instrument)
          ? [0]
          : (note.n < 0 ? chords[b] : [chordTone(chords[b], note.n)]).map((p) => p + 12 * (part.octave ?? 0));
        for (const pitch of pitches) {
          const voice = renderVoice(part.instrument, midiToHz(pitch), gate, sampleRate, seed++);
          const gain = part.gain * note.velocity * (note.n < 0 ? 1 / Math.sqrt(pitches.length) : 1);
          const at = Math.round(start * sampleRate);
          for (let i = 0; i < voice.length; i++) {
            const v = voice[i] * gain;
            const k = (at + i) % length;
            left[k] += v * panL;
            right[k] += v * panR;
            if (echo > 0) {
              echoL[k] += v * panL * echo;
              echoR[k] += v * panR * echo;
            }
          }
        }
      }
    }
  }
  addEcho(left, right, echoL, echoR, Math.round(beat * 0.75 * sampleRate));
  normalizeRms([left, right], 0.13);
  return { sampleRate, channels: [left, right], loopSeconds };
}

/** やまびこ：少し遅れた音を、左右を入れかえながら小さくして重ねる（くり返しの最初に回り込む） */
function addEcho(left: Float32Array, right: Float32Array, sendL: Float32Array, sendR: Float32Array, delay: number): void {
  const length = left.length;
  let gain = 0.45;
  for (let tap = 1; tap <= 6; tap++) {
    const shift = (delay * tap) % length;
    const cross = tap % 2 === 1;
    for (let i = 0; i < length; i++) {
      const k = (i + shift) % length;
      const l = sendL[i] * gain;
      const r = sendR[i] * gain;
      if (cross) {
        left[k] += r;
        right[k] += l;
      } else {
        left[k] += l;
        right[k] += r;
      }
    }
    gain *= 0.4;
  }
}

function isDrum(instrument: Instrument): boolean {
  return instrument === 'kick' || instrument === 'snare' || instrument === 'hat' || instrument === 'openHat';
}

interface ToneSpec {
  waves: { wave: WaveId; ratio: number; gain: number }[];
  env: Envelope;
  /** 明るさ（フィルターの高さ）。brightDecay 秒で base まで下がる */
  bright: number;
  brightBase: number;
  brightDecay: number;
}

const TONES: Partial<Record<Instrument, ToneSpec>> = {
  pluck: {
    waves: [{ wave: 'saw', ratio: 1, gain: 1 }],
    env: { attack: 0.003, decay: 0.32, sustain: 0, release: 0.08 },
    bright: 4200,
    brightBase: 700,
    brightDecay: 0.15,
  },
  epiano: {
    waves: [
      { wave: 'soft', ratio: 1, gain: 1 },
      { wave: 'sine', ratio: 7, gain: 0.05 },
    ],
    env: { attack: 0.005, decay: 0.9, sustain: 0.15, release: 0.25 },
    bright: 3000,
    brightBase: 1500,
    brightDecay: 0.4,
  },
  pad: {
    waves: [
      { wave: 'saw', ratio: 0.996, gain: 0.6 },
      { wave: 'saw', ratio: 1.004, gain: 0.6 },
    ],
    env: { attack: 0.35, decay: 1, sustain: 0.8, release: 0.8 },
    bright: 1300,
    brightBase: 1300,
    brightDecay: 1,
  },
  bass: {
    waves: [{ wave: 'soft', ratio: 1, gain: 1 }],
    env: { attack: 0.004, decay: 0.3, sustain: 0.6, release: 0.06 },
    bright: 1000,
    brightBase: 700,
    brightDecay: 0.2,
  },
  chip: {
    waves: [{ wave: 'square', ratio: 1, gain: 1 }],
    env: { attack: 0.002, decay: 0.12, sustain: 0.45, release: 0.03 },
    bright: 5000,
    brightBase: 5000,
    brightDecay: 1,
  },
  chipBass: {
    waves: [{ wave: 'square', ratio: 1, gain: 1 }],
    env: { attack: 0.002, decay: 0.2, sustain: 0.7, release: 0.03 },
    bright: 1100,
    brightBase: 900,
    brightDecay: 0.2,
  },
  bell: {
    waves: [
      { wave: 'sine', ratio: 1, gain: 1 },
      { wave: 'sine', ratio: 2.76, gain: 0.25 },
    ],
    env: { attack: 0.002, decay: 0.7, sustain: 0, release: 0.3 },
    bright: 9000,
    brightBase: 9000,
    brightDecay: 1,
  },
};

/** 1つの音を作る（1チャンネル）。長さは鳴らす時間＋消えるまで */
function renderVoice(instrument: Instrument, hz: number, gate: number, sampleRate: number, seed: number): Float32Array {
  if (instrument === 'kick') return renderKick(sampleRate);
  if (instrument === 'snare') return renderSnare(sampleRate, seed);
  if (instrument === 'hat' || instrument === 'openHat') return renderHat(sampleRate, seed, instrument === 'openHat' ? 0.14 : 0.03);
  const spec = TONES[instrument]!;
  const length = Math.round((gate + spec.env.release) * sampleRate);
  const out = new Float32Array(length);
  const oscs = spec.waves.map((w) => ({ osc: new Oscillator(w.wave, sampleRate), ...w }));
  const lp = new LowPass(spec.bright, sampleRate);
  // 2段にして、高い音をしっかり落とす
  const lp2 = new LowPass(spec.bright, sampleRate);
  // ベルの高い成分は早く消す
  const partialDecay = instrument === 'bell' || instrument === 'epiano' ? 0.12 : Infinity;
  // 大きさの形などは BLOCK サンプルごとに計算し、その間はまっすぐつなぐ（速くするため）
  const BLOCK = 32;
  for (let from = 0; from < length; from += BLOCK) {
    const to = Math.min(length, from + BLOCK);
    const t0 = from / sampleRate;
    const t1 = to / sampleRate;
    if (spec.bright !== spec.brightBase) {
      const cutoff = spec.brightBase + (spec.bright - spec.brightBase) * Math.exp(-t0 / spec.brightDecay);
      lp.set(cutoff, sampleRate);
      lp2.set(cutoff, sampleRate);
    }
    const e0 = envelopeAt(spec.env, t0, gate);
    const e1 = envelopeAt(spec.env, t1, gate);
    const gains = oscs.map((o) => (o.ratio > 2 ? o.gain * Math.exp(-t0 / partialDecay) : o.gain));
    for (let i = from; i < to; i++) {
      let v = 0;
      for (let k = 0; k < oscs.length; k++) v += gains[k] * oscs[k].osc.next(hz * oscs[k].ratio);
      const e = e0 + ((e1 - e0) * (i - from)) / (to - from);
      out[i] = lp2.next(lp.next(v)) * e;
    }
  }
  return out;
}

function renderKick(sampleRate: number): Float32Array {
  const out = new Float32Array(Math.round(0.35 * sampleRate));
  const osc = new Oscillator('sine', sampleRate);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    out[i] = osc.next(48 + 90 * Math.exp(-t / 0.035)) * Math.exp(-t / 0.16) * Math.min(1, t / 0.002);
  }
  return out;
}

function renderSnare(sampleRate: number, seed: number): Float32Array {
  const out = new Float32Array(Math.round(0.25 * sampleRate));
  const noise = new Noise(seed);
  const lp = new LowPass(900, sampleRate);
  const tone = new Oscillator('sine', sampleRate);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const n = noise.next();
    const high = n - lp.next(n);
    out[i] = 0.8 * high * Math.exp(-t / 0.08) + 0.45 * tone.next(185) * Math.exp(-t / 0.045);
  }
  return out;
}

function renderHat(sampleRate: number, seed: number, decay: number): Float32Array {
  const out = new Float32Array(Math.round((decay * 4 + 0.01) * sampleRate));
  const noise = new Noise(seed);
  const lp = new LowPass(7000, sampleRate);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const n = noise.next();
    out[i] = (n - lp.next(n)) * Math.exp(-t / decay);
  }
  return out;
}
