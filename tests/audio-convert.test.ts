import { describe, expect, it } from 'vitest';
import { AudioConverter, mixChannels } from '../src/core/audio-convert';

const sine = (rate: number, freq: number, from: number, frames: number) =>
  Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * freq * (from + i)) / rate));

describe('チャンネル数をそろえる', () => {
  it('モノラルは左右に同じ音を入れる', () => {
    const mono = new Float32Array([0.1, 0.2]);
    const [l, r] = mixChannels([mono], 2);
    expect([...l]).toEqual([...mono]);
    expect([...r]).toEqual([...mono]);
  });

  it('ステレオはそのまま', () => {
    const ch = [new Float32Array([1]), new Float32Array([2])];
    expect(mixChannels(ch, 2)).toBe(ch);
  });

  it('5.1ch は左右にまとめる', () => {
    const ch = [1, 2, 3, 4, 5, 6].map((v) => new Float32Array([v]));
    const [l, r] = mixChannels(ch, 2);
    expect(l[0]).toBeCloseTo(1 + Math.SQRT1_2 * (3 + 5));
    expect(r[0]).toBeCloseTo(2 + Math.SQRT1_2 * (3 + 6));
  });
});

describe('サンプリングレートをそろえる', () => {
  it('同じ形式なら、そのまま', () => {
    const conv = new AudioConverter(48000, 2);
    const ch = [new Float32Array([0.5, 0.25]), new Float32Array([0.1, 0.2])];
    expect(conv.push(ch, 48000)).toBe(ch);
  });

  it('44.1kHz を 48kHz にすると、サンプル数が 48/44.1 倍になる', () => {
    const conv = new AudioConverter(48000, 2);
    let total = 0;
    for (let i = 0; i < 10; i++) total += conv.push([sine(44100, 440, i * 4410, 4410)], 44100)[0].length;
    // 1秒分（44100）→ 約48000
    expect(Math.abs(total - 48000)).toBeLessThanOrEqual(2);
  });

  it('かたまりの境目でも音が途切れない（なめらかな波のまま）', () => {
    const conv = new AudioConverter(48000, 1);
    const out: number[] = [];
    for (let i = 0; i < 5; i++) out.push(...conv.push([sine(44100, 440, i * 1000, 1000)], 44100)[0]);
    // 本来の波と比べる
    let maxError = 0;
    out.forEach((v, k) => {
      const expected = Math.sin((2 * Math.PI * 440 * k) / 48000);
      maxError = Math.max(maxError, Math.abs(v - expected));
    });
    expect(maxError).toBeLessThan(0.01);
  });

  it('48kHz を 44.1kHz にもできる', () => {
    const conv = new AudioConverter(44100, 1);
    const n = conv.push([sine(48000, 100, 0, 48000)], 48000)[0].length;
    expect(Math.abs(n - 44100)).toBeLessThanOrEqual(1);
  });

  it('reset で、前の音とのつながりを切る', () => {
    const conv = new AudioConverter(48000, 1);
    conv.push([new Float32Array(100).fill(1)], 44100);
    conv.reset();
    const out = conv.push([new Float32Array(10).fill(0)], 44100)[0];
    expect(out[0]).toBe(0);
  });
});
