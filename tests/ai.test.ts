import { describe, expect, it } from 'vitest';
import { chapterTime, fixChapters, formatChapters, parseChapters } from '../src/core/chapters';
import { addSources, emptyProject } from '../src/core/project';
import { parseProject, serializeProject } from '../src/core/project-file';
import { chaptersPrompt, parseTitleAnswer, parseTypoAnswer, transcriptLines, transcriptText, typoPrompt } from '../src/core/prompts';
import { addSubtitles } from '../src/core/subtitles';
import { deleteRange } from '../src/core/timeline';

describe('チャプター', () => {
  it('時刻の形（1時間を超えたら時間も付ける）', () => {
    expect(chapterTime(0, false)).toBe('0:00');
    expect(chapterTime(75.9, false)).toBe('1:15');
    expect(chapterTime(3723, true)).toBe('1:02:03');
    expect(chapterTime(65, true)).toBe('0:01:05');
    expect(formatChapters([{ time: 0, title: 'はじめに' }, { time: 90, title: 'ボス戦' }], 600)).toBe('0:00 はじめに\n1:30 ボス戦');
  });

  it('AI の答えから、いろいろな書き方のチャプターを読む', () => {
    const text = ['ここに案を書きます：', '0:00 はじめに', '- 1:05 - 武器の選び方', '[02:30] 「ボス戦」', '3. 1:02:03：まとめ', 'ほかの行'].join('\n');
    expect(parseChapters(text)).toEqual([
      { time: 0, title: 'はじめに' },
      { time: 65, title: '武器の選び方' },
      { time: 150, title: 'ボス戦' },
      { time: 3723, title: 'まとめ' },
    ]);
  });

  it('YouTube のルールに合うように直す', () => {
    const r = fixChapters(
      [
        { time: 30, title: '準備' },
        { time: 5, title: 'あいさつ' },
        { time: 33, title: '短すぎる' },
        { time: 120, title: 'ボス戦' },
        { time: 999, title: '長さを超える' },
      ],
      200,
    );
    expect(r.chapters).toEqual([
      { time: 0, title: 'あいさつ' },
      { time: 30, title: '準備' },
      { time: 120, title: 'ボス戦' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.fixes.length).toBeGreaterThanOrEqual(3);
  });

  it('最初が 10 秒より後なら「はじめに」を足す。3つに足りなければ知らせる', () => {
    const r = fixChapters([{ time: 40, title: '本題' }], 100);
    expect(r.chapters).toEqual([
      { time: 0, title: 'はじめに' },
      { time: 40, title: '本題' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('3つ以上');
    expect(fixChapters([{ time: 0, title: 'a' }], 20).problem).toContain('短すぎ');
  });

  it('最後のチャプターも、動画の終わりまで10秒以上にする', () => {
    const r = fixChapters([{ time: 0, title: 'a' }, { time: 30, title: 'b' }, { time: 60, title: 'c' }, { time: 95, title: 'd' }], 100);
    expect(r.chapters.map((c) => c.title)).toEqual(['a', 'b', 'c']);
  });
});

describe('AI に渡す質問文と答え', () => {
  const project = () => {
    const p = addSources(emptyProject(), [{ name: 'a', size: 1, lastModified: 0, startTime: 0, endTime: 60, width: 1, height: 1, frameRate: 30, videoCodec: null, audioTrackCount: 1 }]);
    return addSubtitles(p, 's1', [
      { start: 2, end: 4, text: 'こんにちは' },
      { start: 30, end: 33, text: '今日はボス戦\nです' },
    ]);
  };

  it('字幕は、カットしたあとの時刻で渡す', () => {
    const p = deleteRange(project(), 10, 20);
    const lines = transcriptLines(p);
    expect(lines.map((l) => [l.time, l.text])).toEqual([
      [2, 'こんにちは'],
      [20, '今日はボス戦です'],
    ]);
    expect(transcriptText(lines)).toBe('[0:02] こんにちは\n[0:20] 今日はボス戦です');
    expect(chaptersPrompt(transcriptText(lines), 50)).toContain('最初は 0:00');
  });

  it('誤字直しの答えを読む', () => {
    expect(typoPrompt([{ no: 1, text: 'きょうわ' }])).toContain('1: きょうわ');
    const r = parseTypoAnswer('1: 今日は\n3：ボス戦です\nなし\n4. 「いくぞ」');
    expect([...r]).toEqual([
      [1, '今日は'],
      [3, 'ボス戦です'],
      [4, 'いくぞ'],
    ]);
  });

  it('タイトルと概要欄の答えを読む', () => {
    const r = parseTitleAnswer('タイトル案：\n1. ボスの弱点を解説\n2. 「最速で倒す方法」\n概要欄：\nこの動画では…\n2行目');
    expect(r.titles).toEqual(['ボスの弱点を解説', '最速で倒す方法']);
    expect(r.description).toBe('この動画では…\n2行目');
    // 形式どおりでないとき
    expect(parseTitleAnswer('いいタイトル\n説明です')).toEqual({ titles: ['いいタイトル'], description: '説明です' });
  });

  it('タイトル・概要欄・チャプターも作品ファイルに保存できる', () => {
    const p = { ...project(), publish: { title: 'ボス戦', description: '説明', chapters: [{ time: 0, title: 'はじめに' }] } };
    const r = parseProject(serializeProject(p, 'x'));
    expect(r.ok && r.project.publish).toEqual(p.publish);
  });
});
