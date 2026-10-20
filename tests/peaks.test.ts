import { describe, expect, it } from 'vitest';
import { addToPeaks, peakBetween, peakBinCount } from '../src/core/peaks';

describe('音の形', () => {
  it('目盛りの数', () => {
    expect(peakBinCount(10, 0.05)).toBe(200);
    expect(peakBinCount(0, 0.05)).toBe(1);
  });

  it('目盛りごとの最大値を記録する', () => {
    const peaks = new Float32Array(4);
    // 100Hz、0.05秒ごと → 5サンプルで1目盛り
    const left = new Float32Array([0.1, 0.2, 0, 0, 0, 0, -0.9, 0, 0, 0]);
    const right = new Float32Array([0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0]);
    addToPeaks(peaks, 0.05, 0, 100, [left, right]);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.9);
    expect(peaks[2]).toBe(0);
  });

  it('途中から始まる音も、正しい目盛りに入る', () => {
    const peaks = new Float32Array(4);
    addToPeaks(peaks, 0.05, 0.1, 100, [new Float32Array([0.3, 0, 0, 0, 0, 0.7])]);
    expect(peaks[2]).toBeCloseTo(0.3);
    expect(peaks[3]).toBeCloseTo(0.7);
  });

  it('範囲の中の最大値', () => {
    const peaks = new Float32Array([0.1, 0.8, 0.2, 0.4]);
    expect(peakBetween(peaks, 0.05, 0, 0.05)).toBeCloseTo(0.1);
    expect(peakBetween(peaks, 0.05, 0.1, 0.2)).toBeCloseTo(0.4);
    expect(peakBetween(peaks, 0.05, 0.06, 0.07)).toBeCloseTo(0.8);
  });
});
