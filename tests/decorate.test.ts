import { describe, expect, it } from 'vitest';
import { bgmEnvelope, bgmGains, bgmLevel, bgmPoints, speechOnTimeline } from '../src/core/bgm';
import { addEffect, effectsOnTimeline, removeEffect } from '../src/core/effects';
import { activeJoinFades, fadeGains, fadeLevel, fadeSourceChanges, fadeWindows, nearestJoin, toggleJoinFade } from '../src/core/fades';
import { addImage, imagePixels, imagesAt, imagesOnTimeline, moveImage, placeRect, removeImage, setImagePlace, setImageTime } from '../src/core/images';
import { chordNotes, chordTone, parsePattern, renderMusic } from '../src/core/music';
import { addSources, dropUnusedAssets, emptyProject, usedAssetIds, type Asset, type Project, type SourceInfo } from '../src/core/project';
import { parseProject, readProject, serializeProject } from '../src/core/project-file';
import { renderSound, soundSeconds } from '../src/core/sfx';
import { speechRanges, type VoiceLevel } from '../src/core/silence';
import { deleteRange, moveClip, rangesOnTimeline, removeSourceRanges, timelineToSource, totalDuration } from '../src/core/timeline';
import { BGM_FADE_IN, DUCK_LEVEL, MUSIC_TRACKS } from '../src/data/music';
import { SOUNDS } from '../src/data/sfx';
import { nextStep, STEPS } from '../src/data/steps';

function source(name: string, duration: number): Omit<SourceInfo, 'id'> {
  return { name, size: 1, lastModified: 0, startTime: 0, endTime: duration, width: 1280, height: 720, frameRate: 30, videoCodec: 'vp9', audioTrackCount: 1 };
}

/** 録画 a（20秒）と b（10秒）が並んだ作品 */
function twoSources(): Project {
  return addSources(emptyProject(), [source('a', 20), source('b', 10)]);
}

const picture: Asset = { id: 'ab'.repeat(32), kind: 'image', name: 'ロゴ.png', type: 'image/png', size: 100, width: 400, height: 200, duration: 0 };
const song: Asset = { id: 'cd'.repeat(32), kind: 'music', name: '曲.mp3', type: 'audio/mpeg', size: 100, width: 0, height: 0, duration: 30 };
const WIDE = 16 / 9;

describe('完成した動画の時刻と録画の時刻', () => {
  it('なぞった範囲を、かたまりごとの録画の範囲に直す', () => {
    const p = twoSources();
    expect(timelineToSource(p, 18, 22)).toEqual([
      { sourceId: 's1', start: 18, end: 20 },
      { sourceId: 's3', start: 0, end: 2 },
    ]);
    const cut = deleteRange(p, 5, 10);
    expect(timelineToSource(cut, 4, 6)).toEqual([
      { sourceId: 's1', start: 4, end: 5 },
      { sourceId: 's1', start: 10, end: 11 },
    ]);
  });

  it('録画ごとの範囲の一覧を、完成した動画の時刻に直す', () => {
    const p = deleteRange(twoSources(), 5, 10);
    const bySource = new Map<string, [number, number][]>([
      ['s1', [[1, 2], [4, 12]]],
      ['s3', [[0, 1]]],
    ]);
    expect(rangesOnTimeline(p, bySource)).toEqual([
      [1, 2],
      [4, 5],
      [5, 7],
      [15, 16],
    ]);
  });
});

describe('画像', () => {
  it('四隅・中央・画面いっぱいに置ける', () => {
    const tr = placeRect('top-right', 2, WIDE);
    expect(tr.x + tr.w / 2).toBeLessThan(1);
    expect(tr.x).toBeGreaterThan(0.5);
    expect(tr.y).toBeLessThan(0.5);
    const bl = placeRect('bottom-left', 2, WIDE);
    expect(bl.x).toBeLessThan(0.5);
    expect(bl.y).toBeGreaterThan(0.5);
    expect(placeRect('center', 2, WIDE)).toMatchObject({ x: 0.5, y: 0.5 });
    // 横長の画面に縦長の画像を「画面いっぱい」にすると、高さに合わせる
    const full = placeRect('full', 0.5, WIDE);
    expect(full.w * WIDE / 0.5).toBeCloseTo(1);
  });

  it('なぞった範囲に画像を置き、その時間だけ出る', () => {
    const r = addImage(twoSources(), picture, 2, 6, 'top-right', WIDE);
    expect(r.id).toBe('i5');
    expect(r.project.assets).toEqual([picture]);
    expect(imagesAt(r.project, 1).length).toBe(0);
    expect(imagesAt(r.project, 3).map((i) => i.id)).toEqual(['i5']);
    expect(imagesAt(r.project, 6.5).length).toBe(0);
  });

  it('前をカットしても、画像は同じ映像の上に出る', () => {
    const { project } = addImage(twoSources(), picture, 10, 12, 'center', WIDE);
    const cut = deleteRange(project, 0, 5);
    expect(imagesOnTimeline(cut)).toMatchObject([{ id: 'i5', from: 5, to: 7 }]);
    // 並べ替えても付いていく
    const moved = moveClip(cut, 1, 0);
    expect(imagesOnTimeline(moved)).toMatchObject([{ from: 15, to: 17 }]);
  });

  it('かたまりをまたいでも置ける', () => {
    const { project } = addImage(twoSources(), picture, 18, 22, 'center', WIDE);
    expect(imagesAt(project, 19).length).toBe(1);
    expect(imagesAt(project, 21).length).toBe(1);
    expect(imagesOnTimeline(project)).toMatchObject([{ from: 18, to: 22 }]);
  });

  it('置き方・位置・時間を変えられ、消せる', () => {
    const { project, id } = addImage(twoSources(), picture, 2, 6, 'top-right', WIDE);
    const placed = setImagePlace(project, id!, 'bottom-left', WIDE);
    expect(placed.images[0].place).toBe('bottom-left');
    const moved = moveImage(placed, id!, { x: 0.4, y: 0.6, w: 3 });
    expect(moved.images[0]).toMatchObject({ place: 'free', x: 0.4, y: 0.6, w: 1 });
    const timed = setImageTime(moved, id!, 8, 9);
    expect(imagesOnTimeline(timed)).toMatchObject([{ from: 8, to: 9 }]);
    expect(removeImage(timed, id!).images).toEqual([]);
  });

  it('描く四角は、画像の縦横の比を保つ', () => {
    const { project } = addImage(twoSources(), picture, 2, 6, 'center', WIDE);
    const r = imagePixels(project.images[0], picture, 1920, 1080);
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r.x + r.w / 2).toBeCloseTo(960);
  });

  it('使われなくなった画像は作品から外せる', () => {
    const { project, id } = addImage(twoSources(), picture, 2, 6, 'center', WIDE);
    const removed = removeImage(project, id!);
    expect(usedAssetIds(removed).size).toBe(0);
    expect(dropUnusedAssets(removed).assets).toEqual([]);
    expect(dropUnusedAssets(project)).toBe(project);
  });
});

describe('効果音', () => {
  it('再生位置に置き、カットしても同じ映像のところで鳴る', () => {
    const r = addEffect(twoSources(), 12, 'pikon');
    expect(r.id).toBe('e5');
    expect(effectsOnTimeline(r.project)).toEqual([{ id: 'e5', sound: 'pikon', time: 12 }]);
    const cut = deleteRange(r.project, 0, 4);
    expect(effectsOnTimeline(cut)).toEqual([{ id: 'e5', sound: 'pikon', time: 8 }]);
  });

  it('置いた場所をカットすると鳴らない。消せる', () => {
    const r = addEffect(twoSources(), 12, 'don');
    expect(effectsOnTimeline(deleteRange(r.project, 11, 13))).toEqual([]);
    expect(removeEffect(r.project, r.id!).effects).toEqual([]);
  });

  it('どの効果音も、決まった長さで、毎回同じ音になる', () => {
    for (const s of SOUNDS) {
      const a = renderSound(s.id, 48000);
      expect(a.length).toBe(Math.ceil(soundSeconds(s.id) * 48000));
      let peak = 0;
      for (const v of a) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeCloseTo(0.8, 3);
      expect(renderSound(s.id, 48000)).toEqual(a);
    }
  });
});

describe('つなぎ目のフェード', () => {
  it('つなぎ目の前で暗くなり、後ろで明るくなる', () => {
    const p = toggleJoinFade(twoSources(), 'c4');
    expect(p.joinFades).toEqual(['c4']);
    expect(fadeLevel(p, 10)).toBe(1);
    expect(fadeLevel(p, 19.8)).toBeCloseTo(0.5);
    expect(fadeLevel(p, 20)).toBeCloseTo(0);
    expect(fadeLevel(p, 20.2)).toBeCloseTo(0.5);
    expect(fadeLevel(p, 21)).toBe(1);
    // もう一度押すとやめる
    expect(toggleJoinFade(p, 'c4').joinFades).toEqual([]);
  });

  it('最初のかたまりなら動画の始まり、endFade なら終わりのフェード', () => {
    const p = { ...toggleJoinFade(twoSources(), 'c2'), endFade: true };
    expect(fadeLevel(p, 0)).toBe(0);
    expect(fadeLevel(p, 0.2)).toBeCloseTo(0.5);
    expect(fadeLevel(p, 29.5)).toBeCloseTo(0.5);
    expect(fadeWindows(p).length).toBe(2);
  });

  it('音の大きさの倍率も同じように変わる。フェードのない範囲は null', () => {
    const p = toggleJoinFade(twoSources(), 'c4');
    expect(fadeGains(p, 5, 4800, 48000)).toBeNull();
    const g = fadeGains(p, 19.5, 48000, 48000)!;
    expect(g[0]).toBe(1);
    expect(g[Math.round(0.3 * 48000)]).toBeCloseTo(0.5, 2);
    expect(g[Math.round(0.5 * 48000)]).toBeCloseTo(0, 2);
    expect(g[47999]).toBe(1);
  });

  it('切り分けても、フェードはつなぎ目に残る', () => {
    const p = toggleJoinFade(twoSources(), 'c4');
    // 後ろのかたまりの途中を切っても、始まり（c4）はそのまま
    const cut = removeSourceRanges(p, [{ sourceId: 's3', start: 4, end: 5 }]);
    expect(activeJoinFades(cut)).toEqual(['c4']);
    expect(fadeLevel(cut, 20)).toBeCloseTo(0);
    // 前のかたまりを切って新しくできたつなぎ目にはフェードがない
    const cut2 = removeSourceRanges(p, [{ sourceId: 's1', start: 5, end: 6 }]);
    expect(fadeLevel(cut2, 5)).toBe(1);
  });

  it('録画が切り替わるつなぎ目にまとめて入れる・近いつなぎ目を探す', () => {
    const cut = deleteRange(twoSources(), 5, 6);
    const r = fadeSourceChanges(cut);
    expect(r.count).toBe(1);
    expect(r.project.joinFades).toEqual(['c4']);
    expect(fadeSourceChanges(r.project).count).toBe(0);
    expect(nearestJoin(cut, 18)).toMatchObject({ clipId: 'c4', time: 19 });
    expect(nearestJoin(cut, 4)).toMatchObject({ index: 1, time: 5 });
  });
});

describe('BGM', () => {
  const BIN = 0.05;
  function level(pattern: [boolean, number][]): VoiceLevel {
    const values: number[] = [];
    for (const [speaking, seconds] of pattern) for (let i = 0; i < Math.round(seconds / BIN); i++) values.push(speaking ? 0.2 : 0.001);
    return { binSeconds: BIN, rms: Float32Array.from(values) };
  }

  it('しゃべっている範囲を見つける', () => {
    const ranges = speechRanges(level([[false, 2], [true, 3], [false, 2], [true, 1]]));
    expect(ranges.length).toBe(2);
    expect(ranges[0][0]).toBeCloseTo(2);
    expect(ranges[0][1]).toBeCloseTo(5);
  });

  it('短い息つぎはつないで、BGM が小刻みに大きくならないようにする', () => {
    const p = addSources(emptyProject(), [source('a', 12)]);
    const levels = new Map([['s1', level([[false, 2], [true, 3], [false, 0.5], [true, 2], [false, 4.5]])]]);
    const speech = speechOnTimeline(p, levels);
    expect(speech.length).toBe(1);
    expect(speech[0][0]).toBeCloseTo(2);
    expect(speech[0][1]).toBeCloseTo(7.5);
  });

  it('始まりはフェードし、しゃべっている間は小さくなる', () => {
    const p = { ...addSources(emptyProject(), [source('a', 20)]), bgm: { track: { kind: 'builtin' as const, id: 'calm' }, volume: 0.5, duck: true } };
    const env = bgmEnvelope(p, [[5, 8]]);
    expect(bgmLevel(env, 0)).toBe(0);
    expect(bgmLevel(env, BGM_FADE_IN / 2)).toBeCloseTo(0.5);
    expect(bgmLevel(env, 3)).toBe(1);
    expect(bgmLevel(env, 6)).toBeCloseTo(DUCK_LEVEL);
    expect(bgmLevel(env, 12)).toBe(1);
    expect(bgmLevel(env, 20)).toBe(0);
    // 小さくしない設定
    expect(bgmLevel(bgmEnvelope({ ...p, bgm: { ...p.bgm, duck: false } }, [[5, 8]]), 6)).toBe(1);
  });

  it('サンプルごとの倍率と、予約用の点が、同じ大きさの変わり方になる', () => {
    const p = { ...addSources(emptyProject(), [source('a', 20)]), bgm: { track: { kind: 'builtin' as const, id: 'calm' }, volume: 0.5, duck: true } };
    const env = bgmEnvelope(p, [[5, 8]]);
    const rate = 1000;
    const g = bgmGains(env, 4, 6000, rate);
    for (const t of [4, 4.9, 5.5, 8.3, 9.5]) expect(g[Math.round((t - 4) * rate)]).toBeCloseTo(bgmLevel(env, t), 2);
    const points = bgmPoints(env, 4, 10);
    expect(points[0][0]).toBe(4);
    expect(points[points.length - 1][0]).toBe(10);
    // 点と点の間はまっすぐ変わるので、途中の値も合う
    const at = (t: number) => {
      for (let i = 0; i < points.length - 1; i++) {
        const [a, va] = points[i];
        const [b, vb] = points[i + 1];
        if (t >= a && t <= b) return va + ((vb - va) * (t - a)) / (b - a);
      }
      return NaN;
    };
    for (const t of [4.85, 5.5, 8.2, 8.5]) expect(at(t)).toBeCloseTo(bgmLevel(env, t), 2);
  });

  it('入っている曲は、くり返しの長さどおりに作られ、毎回同じ音になる', () => {
    const track = MUSIC_TRACKS.find((t) => t.id === 'game')!;
    const a = renderMusic(track, 8000);
    expect(a.loopSeconds).toBeCloseTo((60 / track.bpm) * 4 * track.chords.length);
    expect(a.channels[0].length).toBe(Math.round(a.loopSeconds * 8000));
    let peak = 0;
    for (const v of a.channels[0]) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(1);
    expect(renderMusic(track, 8000).channels[1]).toEqual(a.channels[1]);
  });

  it('楽譜の書き方を読む', () => {
    expect(parsePattern('0 - 2 . c? x!')).toEqual([
      { n: 0, step: 0, len: 2, velocity: 0.8 },
      { n: 2, step: 2, len: 1, velocity: 0.8 },
      { n: -1, step: 4, len: 1, velocity: 0.5 },
      { n: 0, step: 5, len: 1, velocity: 1 },
    ]);
    expect(chordNotes('C')).toEqual([48, 52, 55]);
    expect(chordNotes('Am')).toEqual([45, 48, 52]);
    expect(chordNotes('Fmaj7')).toEqual([53, 57, 60, 64]);
    expect(chordNotes('Bb')).toEqual([46, 50, 53]);
    expect(chordTone([48, 52, 55], 4)).toBe(64);
  });
});

describe('作品ファイル（v0.5）', () => {
  function decorated(): Project {
    let p = addImage(twoSources(), picture, 2, 6, 'top-right', WIDE).project;
    p = addEffect(p, 3, 'kira').project;
    p = { ...toggleJoinFade(p, 'c4'), endFade: true, effectsVolume: 0.8 };
    return { ...p, assets: [...p.assets, song], bgm: { track: { kind: 'asset', assetId: song.id }, volume: 0.4, duck: false } };
  }

  it('画像・効果音・BGM・フェードも保存して読み込める', () => {
    const p = decorated();
    const r = parseProject(serializeProject(p, 'x', { [picture.id]: 'AAAA', [song.id]: 'BBBB' }));
    expect(r.ok && r.project).toEqual(p);
    expect(r.ok && r.assetData).toEqual({ [picture.id]: 'AAAA', [song.id]: 'BBBB' });
  });

  it('前の版の作品には、画像などがないものとして開く', () => {
    const { assets: _a, images: _i, effects: _e, bgm: _b, joinFades: _j, endFade: _f, effectsVolume: _v, ...old } = twoSources();
    const p = readProject(old);
    expect(p).toMatchObject({ assets: [], images: [], effects: [], bgm: null, joinFades: [], endFade: false, effectsVolume: 1 });
  });

  it('おかしな画像・効果音・BGM は読み飛ばす', () => {
    const p = decorated();
    const broken = {
      ...p,
      images: [...p.images, { ...p.images[0], id: 'x', assetId: 'nai' }],
      effects: [...p.effects, { id: 'y', sound: 'nai', sourceId: 's1', time: 1 }],
      bgm: { track: { kind: 'builtin', id: 'nai' }, volume: 1, duck: true },
      joinFades: ['c4', 'nai'],
    };
    const r = readProject(broken)!;
    expect(r.images.map((i) => i.id)).toEqual(['i5']);
    expect(r.effects.map((e) => e.id)).toEqual(['e6']);
    expect(r.bgm).toBeNull();
    expect(r.joinFades).toEqual(['c4']);
    expect(totalDuration(r)).toBe(30);
  });
});

describe('手順（v0.5）', () => {
  it('字幕のあとに「飾り」「音の仕上げ」が入り、最後が書き出し', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['import', 'silence', 'subtitles', 'decorate', 'sound', 'export']);
    expect(nextStep('subtitles')?.id).toBe('decorate');
    expect(nextStep('sound')?.id).toBe('export');
    expect(nextStep('export')).toBeUndefined();
  });
});
