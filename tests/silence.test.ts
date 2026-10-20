import { describe, expect, it } from 'vitest';
import { CUT_STRENGTHS, DEFAULT_CUT_STRENGTH } from '../src/data/silence';
import { addSources, emptyProject, type SourceInfo } from '../src/core/project';
import { applyCandidates, candidateOnTimeline, candidatesLength, findCandidates, findSilences, speechThreshold, type VoiceLevel } from '../src/core/silence';
import { deleteRange, moveClip, removeSourceRanges, sourceRangeOnTimeline, totalDuration } from '../src/core/timeline';

const BIN = 0.05;
const normal = CUT_STRENGTHS[DEFAULT_CUT_STRENGTH];

/** [しゃべっているか, 秒] の並びから、声の大きさを作る */
function level(pattern: [boolean, number][], noise = 0.001, voice = 0.2): VoiceLevel {
  const values: number[] = [];
  for (const [speaking, seconds] of pattern) {
    for (let i = 0; i < Math.round(seconds / BIN); i++) values.push(speaking ? voice : noise);
  }
  return { binSeconds: BIN, rms: Float32Array.from(values) };
}

function source(name: string, duration: number): Omit<SourceInfo, 'id'> {
  return { name, size: 1, lastModified: 0, startTime: 0, endTime: duration, width: 1280, height: 720, frameRate: 30, videoCodec: 'vp9', audioTrackCount: 1 };
}

describe('しゃべっているかの基準', () => {
  it('静かな部分としゃべっている部分の間に置く', () => {
    const t = speechThreshold(level([[false, 5], [true, 5]]).rms);
    expect(t).toBeGreaterThan(-60);
    expect(t).toBeLessThan(-14);
  });
});

describe('「間」を見つける', () => {
  it('しゃべりの前後に余白を残して切る', () => {
    const lv = level([[true, 2], [false, 1], [true, 2]]);
    const cuts = findSilences(lv, normal, 0, 5);
    expect(cuts).toHaveLength(1);
    expect(cuts[0][0]).toBeCloseTo(2 + normal.padding, 5);
    expect(cuts[0][1]).toBeCloseTo(3 - normal.padding, 5);
  });

  it('短い「間」は候補にしない', () => {
    expect(findSilences(level([[true, 2], [false, 0.3], [true, 2]]), normal, 0, 4.3)).toHaveLength(0);
  });

  it('強くすると、短い「間」も候補になる', () => {
    const strong = CUT_STRENGTHS[4];
    expect(findSilences(level([[true, 2], [false, 0.3], [true, 2]]), strong, 0, 4.3)).toHaveLength(1);
  });

  it('録画の最初と最後の「間」は、余白を残さずに切る', () => {
    const cuts = findSilences(level([[false, 1], [true, 2], [false, 1]]), normal, 0, 4);
    expect(cuts[0][0]).toBe(0);
    expect(cuts[0][1]).toBeCloseTo(1 - normal.padding, 5);
    expect(cuts[1][1]).toBe(4);
  });

  it('「間」の中の短い物音は無視する', () => {
    const cuts = findSilences(level([[true, 2], [false, 0.5], [true, 0.05], [false, 0.5], [true, 2]]), normal, 0, 5.05);
    expect(cuts).toHaveLength(1);
  });
});

describe('作品の中の候補', () => {
  it('タイムラインに残っている部分だけを候補にする', () => {
    let p = addSources(emptyProject(), [source('a', 5)]);
    const levels = new Map([['s1', level([[true, 2], [false, 1], [true, 2]])]]);
    expect(findCandidates(p, levels, normal)).toHaveLength(1);
    // 「間」を含む部分を先に手で消すと、候補はなくなる
    p = deleteRange(p, 1.5, 3.5);
    expect(findCandidates(p, levels, normal)).toHaveLength(0);
  });

  it('まとめて切ると短くなり、残すと決めた候補は残る', () => {
    const p = addSources(emptyProject(), [source('a', 9)]);
    const levels = new Map([['s1', level([[true, 2], [false, 1], [true, 2], [false, 2], [true, 2]])]]);
    const candidates = findCandidates(p, levels, normal);
    expect(candidates).toHaveLength(2);
    const all = applyCandidates(p, candidates, new Set());
    expect(totalDuration(all)).toBeCloseTo(9 - candidatesLength(candidates, new Set()), 5);
    const keepFirst = new Set([candidates[0].id]);
    const some = applyCandidates(p, candidates, keepFirst);
    expect(totalDuration(some)).toBeCloseTo(9 - (candidates[1].end - candidates[1].start), 5);
  });

  it('並べ替えたあとでも、候補の位置はタイムラインに合わせて出る', () => {
    let p = addSources(emptyProject(), [source('a', 5), source('b', 3)]);
    p = moveClip(p, 1, 0);
    const levels = new Map([['s1', level([[true, 2], [false, 1], [true, 2]])]]);
    const [c] = findCandidates(p, levels, normal);
    const span = candidateOnTimeline(p, c)!;
    expect(span[0]).toBeCloseTo(3 + 2 + normal.padding, 5);
  });
});

describe('録画の範囲を取り除く', () => {
  it('1つのかたまりから複数の範囲を取り除く', () => {
    const p = removeSourceRanges(addSources(emptyProject(), [source('a', 10)]), [
      { sourceId: 's1', start: 2, end: 3 },
      { sourceId: 's1', start: 5, end: 6 },
    ]);
    expect(p.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [3, 5],
      [6, 10],
    ]);
    expect(new Set(p.clips.map((c) => c.id)).size).toBe(3);
  });

  it('ほかの録画には影響しない', () => {
    const p = addSources(emptyProject(), [source('a', 4), source('b', 4)]);
    const q = removeSourceRanges(p, [{ sourceId: 's3', start: 1, end: 2 }]);
    expect(q.clips[0]).toEqual(p.clips[0]);
    expect(totalDuration(q)).toBeCloseTo(7, 5);
  });

  it('何も取り除かないなら、そのままの作品を返す', () => {
    const p = addSources(emptyProject(), [source('a', 4)]);
    expect(removeSourceRanges(p, [{ sourceId: 's1', start: 5, end: 6 }])).toBe(p);
  });

  it('録画の範囲が、タイムラインのどこに見えているか', () => {
    let p = addSources(emptyProject(), [source('a', 10)]);
    p = deleteRange(p, 4, 6);
    expect(sourceRangeOnTimeline(p, { sourceId: 's1', start: 3, end: 8 })).toEqual([
      [3, 4],
      [4, 6],
    ]);
  });
});
