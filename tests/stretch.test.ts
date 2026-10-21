import { describe, expect, it } from 'vitest';
import { TimeStretcher } from '../src/core/stretch';

const RATE = 16000;

function sine(hz: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

/** 真ん中あたりの高さ（Hz）を、0 をまたぐ回数から数える */
function pitch(x: Float32Array): number {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let crossings = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  return crossings / ((b - a) / RATE);
}

function run(speed: number, input: Float32Array, chunk = input.length): Float32Array {
  const s = new TimeStretcher(1, RATE, speed);
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += chunk) parts.push(s.push([input.subarray(i, i + chunk)])[0]);
  parts.push(s.flush()[0]);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('速さを変える（声の高さはそのまま）', () => {
  for (const speed of [0.5, 2, 4]) {
    it(`${speed}倍にすると長さが 1/${speed} になり、高さは変わらない`, () => {
      const input = sine(220, 2);
      const out = run(speed, input);
      expect(Math.abs(out.length - input.length / speed)).toBeLessThan(0.05 * RATE);
      expect(pitch(out)).toBeGreaterThan(205);
      expect(pitch(out)).toBeLessThan(235);
    });
  }

  it('少しずつ入れても、まとめて入れても同じ音になる', () => {
    const input = sine(330, 1);
    const whole = run(2, input);
    const chunked = run(2, input, 777);
    expect(chunked.length).toBe(whole.length);
    let diff = 0;
    for (let i = 0; i < whole.length; i++) diff = Math.max(diff, Math.abs(whole[i] - chunked[i]));
    expect(diff).toBeLessThan(1e-6);
  });

  it('1倍なら、そのまま返す', () => {
    const input = sine(440, 0.5);
    expect(run(1, input)).toEqual(input);
  });

  it('つなぎ目で音が大きく欠けない（波の形が自然につながる）', () => {
    const out = run(2, sine(220, 2));
    // 真ん中の部分の大きさ（RMS）が、元の大きさ（0.5/√2）に近い
    let sum = 0;
    const a = Math.floor(out.length * 0.2);
    const b = Math.floor(out.length * 0.8);
    for (let i = a; i < b; i++) sum += out[i] * out[i];
    expect(Math.sqrt(sum / (b - a))).toBeGreaterThan(0.3);
  });
});
