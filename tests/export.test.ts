import { describe, expect, it } from 'vitest';
import { qualityPreset } from '../src/data/quality';
import { chooseFrameRate, estimateExportSeconds, frameCount, normalizeFrameRate, planExport, remainingSeconds } from '../src/core/export-plan';
import { audioSlice, FrameScheduler, samplesFor } from '../src/core/frames';
import { addSources, emptyProject, type SourceInfo } from '../src/core/project';
import { deleteRange } from '../src/core/timeline';

function source(name: string, duration: number, frameRate: number): Omit<SourceInfo, 'id'> {
  return { name, size: 1, lastModified: 0, startTime: 0, endTime: duration, width: 1280, height: 720, frameRate, videoCodec: 'vp9', audioTrackCount: 1 };
}

describe('コマ数', () => {
  it('測った値を、よく使われる値に合わせる', () => {
    expect(normalizeFrameRate(29.97)).toBe(29.97);
    expect(normalizeFrameRate(59.8)).toBe(59.94);
    expect(normalizeFrameRate(30.2)).toBe(30);
    expect(normalizeFrameRate(0)).toBe(30);
    expect(normalizeFrameRate(NaN)).toBe(30);
    expect(normalizeFrameRate(37.3)).toBe(37);
  });

  it('一番長く使われている録画に合わせる', () => {
    let p = addSources(emptyProject(), [source('a', 60, 60), source('b', 100, 30)]);
    expect(chooseFrameRate(p)).toBe(30);
    // b の大部分を消すと a のほうが長くなる
    p = deleteRange(p, 60, 150);
    expect(chooseFrameRate(p)).toBe(60);
  });

  it('録画がなければ 30', () => {
    expect(chooseFrameRate(emptyProject())).toBe(30);
  });
});

describe('書き出しの設定', () => {
  it('画質ごとの大きさとビットレート', () => {
    const p = addSources(emptyProject(), [source('a', 600, 30)]);
    const high = planExport(p, qualityPreset('high'));
    expect([high.width, high.height]).toEqual([1920, 1080]);
    expect(high.videoBitrate).toBe(10_000_000);
    expect(high.frameCount).toBe(18000);
    const light = planExport(p, qualityPreset('light'));
    expect([light.width, light.height]).toEqual([1280, 720]);
    expect(light.estimatedBytes).toBeLessThan(high.estimatedBytes);
  });

  it('コマ数が多い録画はビットレートを上げる', () => {
    const p = addSources(emptyProject(), [source('a', 60, 60)]);
    expect(planExport(p, qualityPreset('high')).videoBitrate).toBe(15_000_000);
  });

  it('ファイルの大きさの目安', () => {
    const p = addSources(emptyProject(), [source('a', 100, 30)]);
    const plan = planExport(p, qualityPreset('normal'));
    // (5Mbps + 128kbps) × 100秒 ÷ 8 ≒ 64MB
    expect(plan.estimatedBytes / 1e6).toBeCloseTo(65.4, 0);
  });

  it('時間の目安', () => {
    expect(estimateExportSeconds(600, null)).toBeNull();
    expect(estimateExportSeconds(600, 0.5)).toBe(300);
    expect(remainingSeconds(1, 0.5)).toBeNull();
    expect(remainingSeconds(10, 0.25)).toBeCloseTo(30);
  });

  it('コマの数', () => {
    expect(frameCount(10, 30)).toBe(300);
    expect(frameCount(10.01, 30)).toBe(301);
    expect(frameCount(0, 30)).toBe(0);
  });
});

describe('コマの割り当て', () => {
  it('同じコマ数ならそのまま1対1', () => {
    const s = new FrameScheduler(30);
    const got: number[][] = [];
    for (let i = 0; i < 3; i++) got.push(s.take(i / 30, (i + 1) / 30));
    expect(got).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('60コマの録画を30コマで書き出すと、1コマおきに使う', () => {
    const s = new FrameScheduler(30);
    const used: number[] = [];
    for (let i = 0; i < 8; i++) {
      const [a, b] = s.take(i / 60, (i + 1) / 60);
      if (b > a) used.push(i);
    }
    expect(used).toEqual([0, 2, 4, 6]);
    expect(s.emitted).toBe(4);
  });

  it('15コマの録画を30コマで書き出すと、1コマを2回使う', () => {
    const s = new FrameScheduler(30);
    expect(s.take(0, 1 / 15)).toEqual([0, 2]);
    expect(s.take(1 / 15, 2 / 15)).toEqual([2, 4]);
  });

  it('コマが抜けていても、出力は途切れない', () => {
    const s = new FrameScheduler(30);
    s.take(0, 1 / 30);
    // 次のコマが 3/30 から始まる（2コマ抜け）→ 抜けたところは前のコマの終わりまでで埋めるため、
    // 呼ぶ側が前のコマを 3/30 まで伸ばす
    expect(s.take(1 / 30, 3 / 30)).toEqual([1, 3]);
    expect(s.take(3 / 30, 4 / 30)).toEqual([3, 4]);
  });

  it('同じ時刻を2回渡しても、二重に割り当てない', () => {
    const s = new FrameScheduler(30);
    s.take(0, 0.1);
    expect(s.take(0, 0.1)).toEqual([3, 3]);
  });
});

describe('音の割り当て', () => {
  it('かたまりの途中から使う', () => {
    // 1秒から始まる1000サンプルのかたまりのうち、1.5秒から使う（48kHz）
    expect(audioSlice(1, 48000, 48000, 1.5, 0, 48000)).toEqual({ silence: 0, offset: 24000, count: 24000 });
  });

  it('必要な数を超えた分は使わない', () => {
    expect(audioSlice(0, 1000, 1000, 0, 900, 950)).toEqual({ silence: 0, offset: 900, count: 50 });
  });

  it('音が途切れていたら無音で埋める', () => {
    expect(audioSlice(2, 100, 100, 1, 0, 500)).toEqual({ silence: 100, offset: 0, count: 100 });
  });

  it('もう十分なら何も使わない', () => {
    expect(audioSlice(0, 100, 100, 0, 10, 10)).toEqual({ silence: 0, offset: 10, count: 0 });
  });

  it('必要なサンプル数', () => {
    expect(samplesFor(1.5, 48000)).toBe(72000);
  });
});
