import { describe, expect, it } from 'vitest';
import { addSources, emptyProject, type Project, type SourceInfo } from '../src/core/project';
import {
  clipStarts,
  deleteRange,
  dropIndex,
  locate,
  moveClip,
  normalizeRange,
  snapToFrame,
  totalDuration,
} from '../src/core/timeline';

function source(name: string, duration: number, frameRate = 30): Omit<SourceInfo, 'id'> {
  return { name, size: 1000, lastModified: 0, startTime: 0, endTime: duration, width: 1920, height: 1080, frameRate, videoCodec: 'avc', audioTrackCount: 1 };
}

function twoRecordings(): Project {
  return addSources(emptyProject(), [source('a.mp4', 10), source('b.mp4', 20)]);
}

describe('録画を足す', () => {
  it('読み込んだ順に、録画の全体が並ぶ', () => {
    const p = twoRecordings();
    expect(p.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 10],
      [0, 20],
    ]);
    expect(totalDuration(p)).toBe(30);
    expect(clipStarts(p)).toEqual([0, 10]);
  });

  it('作品名は最初の録画の名前になる', () => {
    expect(twoRecordings().name).toBe('a');
  });

  it('ID は重ならない', () => {
    const p = addSources(twoRecordings(), [source('c.mkv', 5)]);
    const ids = [...p.sources.map((s) => s.id), ...p.clips.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('時刻の変換', () => {
  it('完成した動画の時刻から、録画の時刻を求める', () => {
    const p = twoRecordings();
    expect(locate(p, 5)).toMatchObject({ index: 0, sourceTime: 5 });
    expect(locate(p, 12)).toMatchObject({ index: 1, sourceTime: 2, clipStart: 10 });
  });

  it('境目ちょうどは後ろのかたまり、終わりより後は最後のかたまりの終わり', () => {
    const p = twoRecordings();
    expect(locate(p, 10)).toMatchObject({ index: 1, sourceTime: 0 });
    expect(locate(p, 99)).toMatchObject({ index: 1, sourceTime: 20 });
  });

  it('空の作品では null', () => {
    expect(locate(emptyProject(), 0)).toBeNull();
  });
});

describe('なぞって消す', () => {
  it('1つのかたまりの真ん中を消すと、2つに分かれる', () => {
    const p = deleteRange(twoRecordings(), 2, 4);
    expect(p.clips.map((c) => [c.sourceId, c.start, c.end])).toEqual([
      ['s1', 0, 2],
      ['s1', 4, 10],
      ['s3', 0, 20],
    ]);
    expect(totalDuration(p)).toBe(28);
    expect(new Set(p.clips.map((c) => c.id)).size).toBe(3);
  });

  it('2つのかたまりにまたがって消せる', () => {
    const p = deleteRange(twoRecordings(), 8, 15);
    expect(p.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 8],
      [5, 20],
    ]);
  });

  it('逆向きになぞっても同じ', () => {
    expect(deleteRange(twoRecordings(), 15, 8).clips).toEqual(deleteRange(twoRecordings(), 8, 15).clips);
  });

  it('かたまり全体を消すと、そのかたまりはなくなる', () => {
    const p = deleteRange(twoRecordings(), 0, 10);
    expect(p.clips).toHaveLength(1);
    expect(p.clips[0].sourceId).toBe('s3');
  });

  it('全部消すと空になる', () => {
    expect(deleteRange(twoRecordings(), 0, 30).clips).toHaveLength(0);
  });

  it('ごく短い範囲は消さない（そのままの作品を返す）', () => {
    const p = twoRecordings();
    expect(deleteRange(p, 3, 3.001)).toBe(p);
  });

  it('端にごく短いかけらが残るときは、かけらも消す', () => {
    const p = deleteRange(twoRecordings(), 0.004, 5);
    expect(p.clips[0].start).toBe(5);
  });

  it('何度も消しても長さの計算が合う', () => {
    let p = twoRecordings();
    for (let i = 0; i < 100; i++) p = deleteRange(p, i * 0.2, i * 0.2 + 0.1);
    expect(totalDuration(p)).toBeCloseTo(20, 6);
  });
});

describe('並べ替え', () => {
  it('かたまりの順番を変えられる', () => {
    const p = moveClip(twoRecordings(), 1, 0);
    expect(p.clips.map((c) => c.sourceId)).toEqual(['s3', 's1']);
  });

  it('同じ場所なら何もしない', () => {
    const p = twoRecordings();
    expect(moveClip(p, 0, 0)).toBe(p);
  });

  it('落とした位置から移動先を決める', () => {
    const p = addSources(emptyProject(), [source('a', 10), source('b', 10), source('c', 10)]);
    // a を c の真ん中より後ろへ → 最後
    expect(dropIndex(p, 0, 27)).toBe(2);
    // c を a の真ん中より前へ → 最初
    expect(dropIndex(p, 2, 2)).toBe(0);
    // b を b の上に落とす → 動かない
    expect(dropIndex(p, 1, 14)).toBe(1);
  });
});

describe('その他', () => {
  it('なぞった範囲を直す', () => {
    expect(normalizeRange(8, 3, 30)).toEqual([3, 8]);
    expect(normalizeRange(-5, 40, 30)).toEqual([0, 30]);
  });

  it('コマの切れ目に合わせる', () => {
    expect(snapToFrame(1.01, 30)).toBeCloseTo(1, 6);
    expect(snapToFrame(1.02, 30)).toBeCloseTo(31 / 30, 6);
  });
});
