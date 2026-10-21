import { describe, expect, it } from 'vitest';
import { addEffect, effectsOnTimeline } from '../src/core/effects';
import { addSources, emptyProject, type SourceInfo } from '../src/core/project';
import { parseProject, serializeProject } from '../src/core/project-file';
import { importSrt } from '../src/core/srt';
import { addSubtitles, subtitleAt, subtitlesOnTimeline } from '../src/core/subtitles';
import { clipLength, deleteRange, locate, setSpeed, speedAt, timelineToSource, totalDuration } from '../src/core/timeline';

function source(name: string, duration: number): Omit<SourceInfo, 'id'> {
  return { name, size: 1, lastModified: 0, startTime: 0, endTime: duration, width: 1280, height: 720, frameRate: 30, videoCodec: 'vp9', audioTrackCount: 1 };
}

const one = () => addSources(emptyProject(), [source('a', 20)]);

describe('速さを変える', () => {
  it('なぞった範囲を2倍にすると、その分だけ短くなる', () => {
    const p = setSpeed(one(), 4, 8, 2);
    expect(p.clips.map((c) => [c.start, c.end, c.speed ?? 1])).toEqual([
      [0, 4, 1],
      [4, 8, 2],
      [8, 20, 1],
    ]);
    expect(totalDuration(p)).toBe(18);
    expect(clipLength(p.clips[1])).toBe(2);
    expect(speedAt(p, 5)).toBe(2);
    expect(speedAt(p, 7)).toBe(1);
  });

  it('0.5倍にすると長くなる。4倍・1倍に戻すこともできる', () => {
    const slow = setSpeed(one(), 0, 2, 0.5);
    expect(totalDuration(slow)).toBe(22);
    const fast = setSpeed(slow, 0, 4, 4);
    expect(totalDuration(fast)).toBe(18.5);
    const back = setSpeed(fast, 0, 1, 1);
    expect(back.clips[0].speed).toBeUndefined();
    expect(totalDuration(back)).toBe(20);
  });

  it('速さを変えたかたまりでも、時刻を正しく録画の時刻に直す', () => {
    const p = setSpeed(one(), 4, 8, 2);
    expect(locate(p, 5)?.sourceTime).toBe(6);
    expect(locate(p, 6)?.sourceTime).toBe(8);
    expect(timelineToSource(p, 5, 7)).toEqual([
      { sourceId: 's1', start: 6, end: 8 },
      { sourceId: 's1', start: 8, end: 9 },
    ]);
  });

  it('範囲内の字幕・効果音の時間も、速さに合わせて自動で変わる', () => {
    let p = addSubtitles(one(), 's1', [{ start: 6, end: 8, text: '速い' }]);
    p = addEffect(p, 10, 'pon').project;
    const fast = setSpeed(p, 4, 8, 2);
    expect(subtitlesOnTimeline(fast)).toMatchObject([{ from: 5, to: 6 }]);
    expect(subtitleAt(fast, 5.5)?.text).toBe('速い');
    expect(effectsOnTimeline(fast)[0].time).toBe(8);
  });

  it('速さを変えたあとに消しても、残りの速さはそのまま', () => {
    const p = deleteRange(setSpeed(one(), 4, 8, 2), 4.5, 5);
    expect(totalDuration(p)).toBe(17.5);
    expect(p.clips.map((c) => [c.start, c.end, c.speed ?? 1])).toEqual([
      [0, 4, 1],
      [4, 5, 2],
      [6, 8, 2],
      [8, 20, 1],
    ]);
  });

  it('字幕ファイルの読み込みも、速さに合わせる', () => {
    const p = setSpeed(one(), 0, 20, 2);
    const r = importSrt(p, [{ start: 1, end: 2, text: 'はやい' }]);
    expect(r.project.subtitles[0].start).toBeCloseTo(2, 4);
    expect(r.project.subtitles[0].end).toBeCloseTo(4, 4);
  });

  it('作品ファイルに速さも保存できる', () => {
    const p = setSpeed(one(), 4, 8, 4);
    const r = parseProject(serializeProject(p, 'x'));
    expect(r.ok && r.project.clips).toEqual(p.clips);
  });
});
