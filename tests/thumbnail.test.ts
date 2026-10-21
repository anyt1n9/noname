import { describe, expect, it } from 'vitest';
import { addSources, emptyProject, type Project } from '../src/core/project';
import { parseProject, serializeProject } from '../src/core/project-file';
import { limitLines, newThumbnail, readThumbnail, setThumbnailFrame, thumbnailFrameOnTimeline, thumbnailLines } from '../src/core/thumbnail';
import { deleteRange } from '../src/core/timeline';

const project = (): Project => ({
  ...addSources(emptyProject(), [{ name: '実況.mkv', size: 1, lastModified: 0, startTime: 0, endTime: 30, width: 1920, height: 1080, frameRate: 30, videoCodec: 'vp9', audioTrackCount: 1 }]),
  publish: { title: 'ボス戦\n攻略', description: '', chapters: [] },
});

describe('サムネイル', () => {
  it('いまの場面と、タイトルの文字で作る', () => {
    const t = newThumbnail(project(), 12)!;
    expect(t).toMatchObject({ sourceId: 's1', time: 12, text: 'ボス戦\n攻略', template: 'impact' });
    expect(thumbnailLines({ ...t, text: ' a \n\n b ' })).toEqual(['a', 'b']);
    expect(limitLines('1\n2\n3\n4')).toBe('1\n2\n3');
  });

  it('場面は録画の中の時刻で持つので、前をカットしても同じ場面', () => {
    const p = project();
    const t = newThumbnail(p, 12)!;
    const cut = deleteRange(p, 0, 5);
    expect(thumbnailFrameOnTimeline(cut, t)).toBe(7);
    expect(thumbnailFrameOnTimeline(deleteRange(p, 10, 15), t)).toBeNull();
    expect(setThumbnailFrame(t, cut, 1).time).toBe(6);
  });

  it('作品ファイルに保存して読み込める。おかしな値は直す', () => {
    const p = { ...project(), thumbnail: newThumbnail(project(), 3) };
    const r = parseProject(serializeProject(p, 'x'));
    expect(r.ok && r.project.thumbnail).toEqual(p.thumbnail);
    const ids = new Set(['s1']);
    expect(readThumbnail({ sourceId: 'nai', time: 1, text: '' }, ids)).toBeNull();
    expect(readThumbnail({ sourceId: 's1', time: 1, text: 'a', template: 'x', color: 'red', size: 'x' }, ids)).toMatchObject({ template: 'impact', size: 'large', position: 'bottom' });
  });
});
