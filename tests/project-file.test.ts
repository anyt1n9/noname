import { describe, expect, it } from 'vitest';
import { addSources, emptyProject, usedSources, baseName, updateSource } from '../src/core/project';
import { parseProject, readProject, serializeProject } from '../src/core/project-file';
import { deleteRange } from '../src/core/timeline';

const sample = () =>
  deleteRange(
    addSources(emptyProject(), [
      { name: '実況1.mkv', size: 123, lastModified: 456, startTime: 0, endTime: 60, width: 1920, height: 1080, frameRate: 60, videoCodec: 'avc', audioTrackCount: 2 },
      { name: '実況2.mp4', size: 789, lastModified: 1, startTime: 0, endTime: 30, width: 1280, height: 720, frameRate: 30, videoCodec: null, audioTrackCount: 1 },
    ]),
    10,
    20,
  );

describe('作品ファイル', () => {
  it('保存して読み込むと同じ作品に戻る', () => {
    const p = sample();
    const result = parseProject(serializeProject(p, '2026-10-20T00:00:00.000Z'));
    expect(result).toEqual({ ok: true, project: p });
  });

  it('ほかのファイルは読まない', () => {
    expect(parseProject('こんにちは')).toMatchObject({ ok: false });
    expect(parseProject('{"format":"other"}')).toMatchObject({ ok: false });
  });

  it('新しい版のファイルは、その旨を伝える', () => {
    const text = JSON.stringify({ format: 'teroppa-project', version: 99, project: sample() });
    const result = parseProject(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('新しい版');
  });

  it('壊れた中身は読まない', () => {
    const p = sample();
    expect(readProject({ ...p, clips: [{ id: 'x', sourceId: 'nai', start: 0, end: 1 }] })).toBeNull();
    expect(readProject({ ...p, clips: [{ id: 'x', sourceId: 's1', start: 5, end: 1 }] })).toBeNull();
    expect(readProject({ ...p, nextId: -1 })).toBeNull();
    expect(readProject(null)).toBeNull();
  });
});

describe('録画の情報', () => {
  it('タイムラインで使われている録画だけを数える', () => {
    const p = deleteRange(sample(), 50, 80);
    expect(usedSources(p).map((s) => s.name)).toEqual(['実況1.mkv']);
  });

  it('録画の情報を差し替える', () => {
    const p = updateSource(sample(), 's1', { size: 999 });
    expect(p.sources[0].size).toBe(999);
    expect(p.sources[1].size).toBe(789);
  });

  it('拡張子を除いた名前', () => {
    expect(baseName('実況.part1.mkv')).toBe('実況.part1');
    expect(baseName('.hidden')).toBe('.hidden');
  });
});
