import { describe, expect, it } from 'vitest';
import { NoiseReducer, measureNoise } from '../src/core/denoise';
import { FeatureAccumulator } from '../src/core/features';
import { fft } from '../src/core/fft';
import { fillersFromSound, fillersFromSubtitles, isFillerText, type VoiceFeatures } from '../src/core/fillers';
import { Limiter } from '../src/core/limiter';
import { gainToTarget, integratedLoudness, toDb } from '../src/core/loudness';
import { LevelAccumulator, peakBinCount } from '../src/core/peaks';
import { addSources, emptyProject } from '../src/core/project';
import { Noise } from '../src/core/synth';
import { addSubtitles } from '../src/core/subtitles';

const RATE = 16000;

function analyze(signal: Float32Array, rate = RATE): VoiceFeatures & { loud: Float32Array } {
  const seconds = signal.length / rate;
  const bins = peakBinCount(seconds);
  const levels = new LevelAccumulator(bins);
  const features = new FeatureAccumulator(bins);
  for (let i = 0; i < signal.length; i += 1000) {
    const part = signal.subarray(i, i + 1000);
    levels.add(i / rate, rate, [part]);
    features.add(i / rate, rate, [part]);
  }
  const f = features.result();
  return { binSeconds: 0.05, rms: levels.rms(), flux: f.flux, zcr: f.zcr, loud: f.loud };
}

function rms(x: Float32Array, a = 0, b = x.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

describe('FFT', () => {
  it('戻すと元の音になる', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.7));
    const im = new Float64Array(64);
    const orig = re.slice();
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 64; i++) expect(re[i]).toBeCloseTo(orig[i], 9);
  });
});

describe('声の大きさ', () => {
  it('1kHz・大きさ 0.1 の音（モノラルを左右に出す）は -20 LUFS', () => {
    const x = Float32Array.from({ length: RATE * 5 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / RATE));
    expect(integratedLoudness(analyze(x).loud, 0.05)).toBeCloseTo(-20, 0);
  });

  it('静かな部分は数えない（しゃべっている部分の大きさになる）', () => {
    const x = new Float32Array(RATE * 10);
    for (let i = 0; i < RATE * 5; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
    expect(integratedLoudness(analyze(x).loud, 0.05)).toBeCloseTo(-20, 0);
    expect(integratedLoudness(new Float32Array(100), 0.05)).toBeNull();
  });

  it('目標の大きさにそろえる倍率。上げすぎ・下げすぎない', () => {
    expect(toDb(gainToTarget(-22, -16))).toBeCloseTo(6);
    expect(toDb(gainToTarget(-40, -16))).toBeCloseTo(12);
    expect(toDb(gainToTarget(0, -16))).toBeCloseTo(-12);
  });
});

describe('雑音を減らす', () => {
  const noise = (seconds: number, level: number, seed: number) => {
    const n = new Noise(seed);
    return Float32Array.from({ length: Math.round(seconds * RATE) }, () => level * n.next());
  };

  it('雑音だけのところは小さくなり、声（音）は残る', () => {
    const profile = measureNoise([noise(2, 0.05, 1)], RATE)!;
    const input = noise(3, 0.05, 2);
    // 1〜2秒に 440Hz の音を足す
    for (let i = RATE; i < RATE * 2; i++) input[i] += 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE);
    const r = new NoiseReducer(1, RATE, profile, 'strong');
    const parts: Float32Array[] = [];
    for (let i = 0; i < input.length; i += 1500) parts.push(r.push([input.subarray(i, i + 1500)])[0]);
    parts.push(r.flush()[0]);
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    expect(out.length).toBe(input.length);
    const before = rms(input, Math.round(0.3 * RATE), Math.round(0.9 * RATE));
    const after = rms(out, Math.round(0.3 * RATE), Math.round(0.9 * RATE));
    expect(after).toBeLessThan(before * 0.4);
    const tone = rms(out, Math.round(1.2 * RATE), Math.round(1.8 * RATE));
    expect(tone).toBeGreaterThan(0.3 / Math.SQRT2 * 0.8);
  });

  it('雑音がないとみなせば、音はそのまま（位置もずれない）', () => {
    const input = Float32Array.from({ length: RATE }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 300 * i) / RATE));
    const r = new NoiseReducer(1, RATE, { sampleRate: RATE, magnitudes: new Array(513).fill(0) }, 'weak');
    const a = r.push([input])[0];
    const b = r.flush()[0];
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    expect(out.length).toBe(input.length);
    for (let i = 600; i < input.length - 600; i += 97) expect(out[i]).toBeCloseTo(input[i], 3);
  });
});

describe('音が割れないように抑える', () => {
  it('大きすぎる音だけを、上限まで小さくする', () => {
    const lim = new Limiter(RATE, -1);
    const a = Float32Array.from({ length: RATE / 2 }, (_, i) => 0.2 * Math.sin(i * 0.05));
    const b = Float32Array.from({ length: RATE / 2 }, (_, i) => (i > 2000 && i < 2400 ? 1.8 : 0.2) * Math.sin(i * 0.05));
    const c = new Float32Array(RATE / 2);
    const quiet = a.slice();
    lim.process([a], [b]);
    lim.process([b], [c]);
    lim.process([c], null);
    const ceiling = Math.pow(10, -1 / 20);
    expect(Math.max(...Array.from(b, Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6);
    // 大きくない部分は変えない
    for (let i = 0; i < a.length; i += 101) expect(a[i]).toBeCloseTo(quiet[i], 6);
  });
});

describe('口ぐせの候補（試験的）', () => {
  it('字幕が口ぐせだけの行を見つける', () => {
    expect(isFillerText('えー')).toBe(true);
    expect(isFillerText('えーっと、')).toBe(false);
    expect(isFillerText('えっと、あのー')).toBe(true);
    expect(isFillerText('あのぉ…')).toBe(true);
    expect(isFillerText('あの店に行った')).toBe(false);
    let p = addSources(emptyProject(), [{ name: 'a', size: 1, lastModified: 0, startTime: 0, endTime: 20, width: 1, height: 1, frameRate: 30, videoCodec: null, audioTrackCount: 1 }]);
    p = addSubtitles(p, 's1', [
      { start: 1, end: 2, text: 'えー' },
      { start: 3, end: 5, text: '今日はボス戦です' },
    ]);
    expect(fillersFromSubtitles(p).map((c) => c.text)).toEqual(['えー']);
  });

  it('前後に「間」がある、のばした声を見つける。ふつうのしゃべりは見つけない', () => {
    const seconds = 12;
    const x = new Float32Array(RATE * seconds);
    const noise = new Noise(5);
    const put = (from: number, to: number, f: (t: number) => number) => {
      for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) x[i] += f(i / RATE);
    };
    for (let i = 0; i < x.length; i++) x[i] = 0.001 * noise.next();
    // ふつうのしゃべりの代わり：高さと音色が細かく変わる音（2秒ずつ）
    const speech = (t: number) => {
      const f0 = 140 + 60 * Math.sin(2 * Math.PI * 3 * t) + 40 * Math.sin(2 * Math.PI * 7.3 * t);
      const phase = 2 * Math.PI * f0 * t;
      const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 5 * t);
      return 0.2 * syllable * (Math.sin(phase) + 0.5 * Math.sin(phase * (2 + Math.sin(2 * Math.PI * 4 * t))) + 0.3 * noise.next() * (Math.sin(2 * Math.PI * 2.1 * t) > 0.6 ? 1 : 0));
    };
    put(0.5, 3, speech);
    put(4.5, 7, speech);
    put(9, 11.5, speech);
    // 「えー」の代わり：同じ高さ・同じ音色でのばした声（0.7秒）
    put(3.6, 4.3, (t) => 0.2 * (Math.sin(2 * Math.PI * 150 * t) + 0.5 * Math.sin(2 * Math.PI * 300 * t) + 0.3 * Math.sin(2 * Math.PI * 450 * t)));
    const found = fillersFromSound(analyze(x));
    expect(found.length).toBe(1);
    expect(found[0][0]).toBeGreaterThan(3.4);
    expect(found[0][1]).toBeLessThan(4.5);
  });
});
