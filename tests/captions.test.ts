import { describe, expect, it } from 'vitest';
import { breakLines, cleanText, splitIntoCaptions, textLength, words } from '../src/core/captions';

const lines = (t: string) => t.split('\n');

describe('字幕の分け方', () => {
  it('短い文はそのまま1行', () => {
    const [c] = splitIntoCaptions('今日はボス戦です', 1, 3);
    expect(c).toEqual({ text: '今日はボス戦です', start: 1, end: 3 });
  });

  it('20文字を超えると2行にする。言葉の途中では改行しない', () => {
    const text = 'このボスは実は弱点があって背中を狙うと大ダメージです';
    const out = breakLines(text);
    const [a, b] = lines(out);
    expect(textLength(a)).toBeLessThanOrEqual(20);
    expect(textLength(b)).toBeLessThanOrEqual(20);
    expect(a + b).toBe(text);
    // 区切りは言葉の切れ目
    const boundaries = new Set<number>();
    let n = 0;
    for (const w of words(text)) boundaries.add((n += w.length));
    expect(boundaries.has(a.length)).toBe(true);
  });

  it('読点があれば、そこで改行しやすい', () => {
    expect(breakLines('このボス、実は弱点があって背中を狙うと大ダメージ')).toBe('このボス、実は弱点があって\n背中を狙うと大ダメージ');
  });

  it('長い話は、いくつかの字幕に分けて、時間も文字数に合わせて分ける', () => {
    const text = 'みなさんこんにちは今日はこのゲームの最初のボスを倒す方法を解説していきますまずは装備を整えるところから始めましょう';
    const pieces = splitIntoCaptions(text, 10, 20);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      const ls = lines(p.text);
      expect(ls.length).toBeLessThanOrEqual(2);
      for (const l of ls) expect(textLength(l)).toBeLessThanOrEqual(20);
    }
    expect(pieces[0].start).toBe(10);
    expect(pieces[pieces.length - 1].end).toBeCloseTo(20, 6);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].start).toBeCloseTo(pieces[i - 1].end, 6);
    expect(pieces.map((p) => p.text.replace(/\n/g, '')).join('')).toBe(text);
  });

  it('文の終わりで字幕を分け、終わりの「。」は出さない', () => {
    const pieces = splitIntoCaptions('こんにちは。今日は晴れです！', 0, 4);
    expect(pieces.map((p) => p.text)).toEqual(['こんにちは', '今日は晴れです！']);
  });

  it('空白を整える', () => {
    expect(cleanText('  えーと 、 今日は  ')).toBe('えーと、今日は');
    expect(splitIntoCaptions('   ', 0, 1)).toEqual([]);
  });

  it('区切りのない長い言葉は、文字数で区切る', () => {
    const out = breakLines('x'.repeat(30));
    expect(lines(out).map(textLength)).toEqual([20, 10]);
  });
});
