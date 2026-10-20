import { describe, expect, it } from 'vitest';
import { combineLevels, LevelAccumulator, peakBetween, peakBinCount } from '../src/core/peaks';

describe('音の大きさの記録', () => {
  it('目盛りの数', () => {
    expect(peakBinCount(10, 0.05)).toBe(200);
    expect(peakBinCount(0, 0.05)).toBe(1);
  });

  it('目盛りごとの最大値を記録する', () => {
    const acc = new LevelAccumulator(4, 0.05);
    // 100Hz、0.05秒ごと → 5サンプルで1目盛り
    const left = new Float32Array([0.1, 0.2, 0, 0, 0, 0, -0.9, 0, 0, 0]);
    const right = new Float32Array([0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0]);
    acc.add(0, 100, [left, right]);
    expect(acc.peaks[0]).toBeCloseTo(0.5);
    expect(acc.peaks[1]).toBeCloseTo(0.9);
    expect(acc.peaks[2]).toBe(0);
  });

  it('途中から始まる音も、正しい目盛りに入る', () => {
    const acc = new LevelAccumulator(4, 0.05);
    acc.add(0.1, 100, [new Float32Array([0.3, 0, 0, 0, 0, 0.7])]);
    expect(acc.peaks[2]).toBeCloseTo(0.3);
    expect(acc.peaks[3]).toBeCloseTo(0.7);
  });

  it('平均の大きさ（同じ大きさの音なら、その大きさ）', () => {
    const acc = new LevelAccumulator(2, 0.05);
    acc.add(0, 100, [new Float32Array([0.5, -0.5, 0.5, -0.5, 0.5])]);
    // 2回に分けて足しても同じ
    acc.add(0.05, 100, [new Float32Array([0.2, -0.2])]);
    acc.add(0.07, 100, [new Float32Array([0.2, -0.2, 0.2])]);
    const rms = acc.rms();
    expect(rms[0]).toBeCloseTo(0.5);
    expect(rms[1]).toBeCloseTo(0.2);
  });

  it('範囲の中の最大値', () => {
    const peaks = new Float32Array([0.1, 0.8, 0.2, 0.4]);
    expect(peakBetween(peaks, 0.05, 0, 0.05)).toBeCloseTo(0.1);
    expect(peakBetween(peaks, 0.05, 0.1, 0.2)).toBeCloseTo(0.4);
    expect(peakBetween(peaks, 0.05, 0.06, 0.07)).toBeCloseTo(0.8);
  });

  it('複数の音を大きいほうでまとめる', () => {
    const out = combineLevels([new Float32Array([0.1, 0.5]), new Float32Array([0.3, 0.2, 0.9])]);
    expect([...out].map((v) => Math.round(v * 10) / 10)).toEqual([0.3, 0.5, 0.9]);
  });
});
