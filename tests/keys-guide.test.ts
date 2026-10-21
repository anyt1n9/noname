import { describe, expect, it } from 'vitest';
import { guideMessage } from '../src/core/guide';
import { actionForKey, type KeyInput } from '../src/core/keys';
import { addSources, emptyProject } from '../src/core/project';
import { formatBytes, formatClock, formatLength } from '../src/core/time';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('キーボード操作', () => {
  it('仕様書のキーが使える', () => {
    expect(actionForKey(key(' '), false)).toBe('playPause');
    expect(actionForKey(key('ArrowLeft'), false)).toBe('back');
    expect(actionForKey(key('ArrowRight', { shiftKey: true }), false)).toBe('forwardLong');
    expect(actionForKey(key('Delete'), false)).toBe('deleteSelection');
    expect(actionForKey(key('z', { ctrlKey: true }), false)).toBe('undo');
    expect(actionForKey(key('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo');
    expect(actionForKey(key('y', { ctrlKey: true }), false)).toBe('redo');
    expect(actionForKey(key('s', { ctrlKey: true }), false)).toBe('saveFile');
    expect(actionForKey(key('+'), false)).toBe('zoomIn');
    expect(actionForKey(key('-'), false)).toBe('zoomOut');
    expect(actionForKey(key('?'), false)).toBe('showKeys');
  });

  it('文字を入力しているときは何もしない', () => {
    expect(actionForKey(key(' '), true)).toBeNull();
    expect(actionForKey(key('z', { ctrlKey: true }), true)).toBeNull();
  });

  it('関係ないキーは何もしない', () => {
    expect(actionForKey(key('a'), false)).toBeNull();
    expect(actionForKey(key('c', { ctrlKey: true }), false)).toBeNull();
  });
});

describe('案内', () => {
  const ctx = { step: 'import' as const, hasSelection: false, missingSources: 0 };

  it('録画がないときは読み込みを案内する', () => {
    expect(guideMessage(emptyProject(), ctx).title).toContain('録画を入れ');
  });

  it('録画があるときは、消し方と長さを伝える', () => {
    const p = addSources(emptyProject(), [
      { name: 'a', size: 1, lastModified: 0, startTime: 0, endTime: 192, width: 1, height: 1, frameRate: 30, videoCodec: null, audioTrackCount: 1 },
    ]);
    const m = guideMessage(p, ctx);
    expect(m.title).toContain('消し');
    expect(m.detail).toContain('3分12秒');
    expect(guideMessage(p, { ...ctx, hasSelection: true }).title).toContain('なぞった範囲');
  });

  it('開けない録画があれば、それを最優先で伝える', () => {
    expect(guideMessage(emptyProject(), { ...ctx, missingSources: 2 }).detail).toContain('2本');
  });
});

describe('時間の表示', () => {
  it('再生位置', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(125.7)).toBe('2:05');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(65.25, true)).toBe('1:05.2');
  });

  it('文章の中の長さ', () => {
    expect(formatLength(12)).toBe('12秒');
    expect(formatLength(192)).toBe('3分12秒');
    expect(formatLength(3723)).toBe('1時間2分3秒');
  });

  it('ファイルの大きさ', () => {
    expect(formatBytes(1.24e9)).toBe('1.2GB');
    expect(formatBytes(350e6)).toBe('350MB');
    expect(formatBytes(10)).toBe('1KB');
  });
});

describe('版の番号の表示', () => {
  it('短い版の番号（候補の版は印を付ける）', async () => {
    const { shortVersion } = await import('../src/version');
    expect(shortVersion('0.9.0')).toBe('v0.9');
    expect(shortVersion('1.0.0-rc.1')).toBe('v1.0-rc.1');
  });
});
