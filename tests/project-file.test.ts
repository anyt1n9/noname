import { describe, expect, it } from 'vitest';
import { activeTracks, addSources, baseName, emptyProject, setSourceAudio, updateSource, usedSources, voiceTracks } from '../src/core/project';
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
    expect(result).toEqual({ ok: true, project: p, assetData: {} });
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

describe('音の設定', () => {
  it('音が1つの録画はそのまま、複数の録画は1つ目を声にして確かめてもらう', () => {
    const p = addSources(emptyProject(), [
      { name: 'a', size: 1, lastModified: 0, startTime: 0, endTime: 5, width: 1, height: 1, frameRate: 30, videoCodec: null, audioTrackCount: 1 },
      { name: 'b', size: 1, lastModified: 0, startTime: 0, endTime: 5, width: 1, height: 1, frameRate: 30, videoCodec: null, audioTrackCount: 3 },
    ]);
    expect(p.audio.s1).toEqual({ roles: ['voice'], voiceGain: 1, otherGain: 1, confirmed: true });
    expect(p.audio.s3.roles).toEqual(['voice', 'off', 'off']);
    expect(p.audio.s3.confirmed).toBe(false);
  });

  it('鳴らす音と声の音', () => {
    const audio = { roles: ['off', 'voice', 'other'] as const, voiceGain: 1.5, otherGain: 0.5, confirmed: true };
    expect(activeTracks({ ...audio, roles: [...audio.roles] })).toEqual([
      { index: 1, gain: 1.5 },
      { index: 2, gain: 0.5 },
    ]);
    expect(voiceTracks({ ...audio, roles: [...audio.roles] })).toEqual([1]);
    expect(voiceTracks({ ...audio, roles: ['off', 'other', 'other'] })).toEqual([1, 2]);
  });

  it('v0.1 で保存した作品（音の設定がない）も開ける', () => {
    const p = sample();
    const { audio: _audio, ...old } = p;
    const text = JSON.stringify({ format: 'teroppa-project', version: 1, project: old });
    const result = parseProject(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.audio.s1.roles).toEqual(['voice', 'off']);
  });

  it('音の設定も保存して読み込める', () => {
    const p = setSourceAudio(sample(), 's1', { roles: ['off', 'voice'], voiceGain: 2, otherGain: 0, confirmed: true });
    const result = parseProject(serializeProject(p, 'x'));
    expect(result.ok && result.project.audio.s1).toEqual({ roles: ['off', 'voice'], voiceGain: 2, otherGain: 0, confirmed: true });
  });
});
