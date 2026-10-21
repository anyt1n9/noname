import { describe, expect, it } from 'vitest';
import { addSources, emptyProject, type Project, type SourceInfo } from '../src/core/project';
import { parseProject, serializeProject } from '../src/core/project-file';
import { importSrt, parseSrt, srtTime, toSrt } from '../src/core/srt';
import {
  addSubtitleAt,
  addSubtitles,
  cutSubtitle,
  markTranscribed,
  mergeRanges,
  mergeWithNext,
  removeSubtitle,
  setSubtitleText,
  setSubtitleTime,
  splitSubtitle,
  subtitleAt,
  subtitlesOnTimeline,
  subtractRanges,
  untranscribedRanges,
} from '../src/core/subtitles';
import { chunksToSegments, speechWindows } from '../src/core/transcribe-plan';
import { deleteRange, moveClip, totalDuration } from '../src/core/timeline';

function source(name: string, duration: number): Omit<SourceInfo, 'id'> {
  return { name, size: 1, lastModified: 0, startTime: 0, endTime: duration, width: 1280, height: 720, frameRate: 30, videoCodec: 'vp9', audioTrackCount: 1 };
}

function withSubs(): Project {
  const p = addSources(emptyProject(), [source('a', 20), source('b', 10)]);
  return addSubtitles(p, 's1', [
    { start: 1, end: 3, text: 'こんにちは' },
    { start: 4, end: 6, text: '今日はボス戦です' },
    { start: 10, end: 12, text: 'いきます' },
  ]);
}

describe('字幕の位置', () => {
  it('録画の時刻で持つので、カットや並べ替えをしても映像とずれない', () => {
    let p = withSubs();
    expect(subtitleAt(p, 5)?.text).toBe('今日はボス戦です');
    // 前を消すと、字幕も一緒に前へずれる
    p = deleteRange(p, 0, 3.5);
    expect(subtitleAt(p, 5 - 3.5)?.text).toBe('今日はボス戦です');
    // 並べ替えても同じ
    p = moveClip(p, p.clips.length - 1, 0);
    expect(subtitleAt(p, 10 + 1)?.text).toBe('今日はボス戦です');
  });

  it('カットで消えた部分の字幕は、見えなくなる', () => {
    const p = deleteRange(withSubs(), 9, 13);
    expect(subtitlesOnTimeline(p).map((s) => s.text)).toEqual(['こんにちは', '今日はボス戦です']);
  });

  it('字幕の途中でカットすると、2つに分かれて見える', () => {
    const p = deleteRange(withSubs(), 4.5, 5);
    const parts = subtitlesOnTimeline(p).filter((s) => s.text === '今日はボス戦です');
    expect(parts.map((s) => [s.from, s.to])).toEqual([
      [4, 4.5],
      [4.5, 5.5],
    ]);
  });
});

describe('字幕の編集', () => {
  it('文字を書き換える・字幕だけを消す', () => {
    let p = setSubtitleText(withSubs(), 't5', 'やあ');
    expect(p.subtitles.find((s) => s.id === 't5')?.text).toBe('やあ');
    p = removeSubtitle(p, 't5');
    expect(p.subtitles).toHaveLength(2);
  });

  it('2つに分ける（時間は文字数に合わせる）・ひとつにまとめる', () => {
    let p = splitSubtitle(withSubs(), 't6', 3);
    const [a, b] = p.subtitles.filter((s) => s.start >= 4 && s.end <= 6);
    expect(a.text).toBe('今日は');
    expect(b.text).toBe('ボス戦です');
    expect(a.end).toBeCloseTo(4 + 2 * (3 / 8), 6);
    p = mergeWithNext(p, a.id);
    expect(p.subtitles.find((s) => s.id === a.id)).toMatchObject({ start: 4, end: 6, text: '今日はボス戦です' });
  });

  it('時間を変える。前後の字幕とは重ならない', () => {
    const p = setSubtitleTime(withSubs(), 't6', 2, 11);
    expect(p.subtitles.find((s) => s.id === 't6')).toMatchObject({ start: 3, end: 10 });
  });

  it('新しく足した字幕と重なる古い字幕は、置きかわる', () => {
    const p = addSubtitles(withSubs(), 's1', [{ start: 5, end: 7, text: '新しい' }]);
    expect(p.subtitles.map((s) => s.text)).toEqual(['こんにちは', '新しい', 'いきます']);
  });

  it('再生位置に字幕を足す（次の字幕の手前まで）', () => {
    const r = addSubtitleAt(withSubs(), 9, 'ここ');
    expect(r.id).not.toBeNull();
    expect(r.project.subtitles.find((s) => s.id === r.id)).toMatchObject({ start: 9, end: 10, text: 'ここ' });
    // すでに字幕がある場所には足さない
    expect(addSubtitleAt(withSubs(), 5, 'x').id).toBeNull();
  });
});

describe('字幕ファイル（.srt）', () => {
  it('時刻の形', () => {
    expect(srtTime(3723.456)).toBe('01:02:03,456');
  });

  it('完成した動画の時刻で書き出し、読み込める', () => {
    const p = deleteRange(withSubs(), 0, 0.5);
    const srt = toSrt(p);
    expect(srt.startsWith('1\n00:00:00,500 --> 00:00:02,500\nこんにちは\n')).toBe(true);
    const cues = parseSrt(srt);
    expect(cues).toHaveLength(3);
    const empty = { ...p, subtitles: [] };
    const r = importSrt(empty, cues);
    expect(r.count).toBe(3);
    expect(subtitlesOnTimeline(r.project).map((s) => [s.text, Math.round(s.from * 10) / 10])).toEqual([
      ['こんにちは', 0.5],
      ['今日はボス戦です', 3.5],
      ['いきます', 9.5],
    ]);
  });

  it('ほかのソフトの字幕ファイル（CRLF・ピリオドの時刻・タグ）も読める', () => {
    const cues = parseSrt('﻿1\r\n00:00:01.000 --> 00:00:02.500\r\n<i>やあ</i>\r\n\r\n2\r\n壊れた行\r\n');
    expect(cues).toEqual([{ start: 1, end: 2.5, text: 'やあ' }]);
  });
});

describe('文字起こしの計画', () => {
  it('済ませた範囲を記録し、残りだけを文字起こしする', () => {
    let p = withSubs();
    expect(untranscribedRanges(p, 's1')).toEqual([[0, 20]]);
    p = markTranscribed(p, 's1', [0, 8]);
    p = markTranscribed(p, 's1', [8, 12]);
    expect(p.transcribed.s1).toEqual([[0, 12]]);
    expect(untranscribedRanges(p, 's1')).toEqual([[12, 20]]);
  });

  it('範囲の計算', () => {
    expect(mergeRanges([[5, 6], [1, 2], [2, 3]])).toEqual([
      [1, 3],
      [5, 6],
    ]);
    expect(subtractRanges([[0, 10]], [[2, 3], [5, 6]])).toEqual([
      [0, 2],
      [3, 5],
      [6, 10],
    ]);
  });

  it('しゃべっている部分を、28秒以内のまとまりにする', () => {
    // 声の大きさ：10秒しゃべって2秒休むのを5回
    const values: number[] = [];
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < 200; i++) values.push(0.2);
      for (let i = 0; i < 40; i++) values.push(0.001);
    }
    const level = { binSeconds: 0.05, rms: Float32Array.from(values) };
    const windows = speechWindows([[0, 60]], level, 0, 60);
    for (const [a, b] of windows) expect(b - a).toBeLessThanOrEqual(28);
    // 「間」は含めすぎない（全体の長さより短い）
    const total = windows.reduce((s, [a, b]) => s + (b - a), 0);
    expect(total).toBeLessThan(60);
    expect(total).toBeGreaterThan(45);
  });

  it('長く続くしゃべりも28秒以内に分ける', () => {
    const level = { binSeconds: 0.05, rms: new Float32Array(1200).fill(0.2) };
    const windows = speechWindows([[0, 60]], level, 0, 60);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const [a, b] of windows) expect(b - a).toBeLessThanOrEqual(28 + 1e-6);
  });

  it('AI の結果を録画の時刻に直し、くり返しはまとめる', () => {
    const segs = chunksToSegments(
      [
        { text: ' こんにちは', timestamp: [0, 2] },
        { text: 'こんにちは', timestamp: [2, 3] },
        { text: '今日は', timestamp: [3.5, null] },
      ],
      100,
      110,
    );
    expect(segs).toEqual([
      { text: 'こんにちは', start: 100, end: 103 },
      { text: '今日は', start: 103.5, end: 110 },
    ]);
  });
});

describe('作品ファイルの字幕', () => {
  it('字幕と見た目も保存して読み込める', () => {
    const p = { ...markTranscribed(withSubs(), 's1', [0, 5]), subtitleStyle: { color: '#ffe14d', size: 'large' as const, position: 'top' as const } };
    const r = parseProject(serializeProject(p, 'x'));
    expect(r.ok && r.project.subtitles).toEqual(p.subtitles);
    expect(r.ok && r.project.subtitleStyle).toEqual(p.subtitleStyle);
    expect(r.ok && r.project.transcribed).toEqual({ s1: [[0, 5]] });
  });
});

describe('文章で編集（v0.4）', () => {
  it('字幕の行を消すと、その部分の動画も消える', () => {
    const p = cutSubtitle(withSubs(), 't6');
    expect(totalDuration(p)).toBeCloseTo(30 - 2, 6);
    expect(p.subtitles.map((s) => s.text)).toEqual(['こんにちは', 'いきます']);
    // 後ろの字幕は、消した分だけ前に出る
    expect(subtitleAt(p, 10 - 2 + 0.5)?.text).toBe('いきます');
  });

  it('一部がすでにカットされている字幕でも消せる', () => {
    const p = cutSubtitle(deleteRange(withSubs(), 4.5, 5), 't6');
    expect(totalDuration(p)).toBeCloseTo(30 - 2, 6);
    expect(subtitlesOnTimeline(p).some((s) => s.text === '今日はボス戦です')).toBe(false);
  });

  it('ない字幕なら何もしない', () => {
    const p = withSubs();
    expect(cutSubtitle(p, 'nai')).toBe(p);
  });
});
