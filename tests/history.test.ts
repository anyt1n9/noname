import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, record, redo, undo } from '../src/core/history';

describe('元に戻す・やり直す', () => {
  it('戻して、やり直せる', () => {
    let h = createHistory(1);
    h = record(h, 2);
    h = record(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
  });

  it('戻したあとに新しい操作をすると、やり直しの記録は消える', () => {
    let h = createHistory('a');
    h = record(h, 'b');
    h = undo(h);
    h = record(h, 'c');
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual(['a']);
  });

  it('同じ状態は記録しない', () => {
    const h = createHistory(1);
    expect(record(h, 1)).toBe(h);
  });

  it('上限を超えたら古いものから忘れる', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = record(h, i, 3);
    expect(h.past).toEqual([7, 8, 9]);
  });
});
