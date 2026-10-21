// サムネイル（v0.9）。動画の一場面（録画の中の時刻で持つので、カットしても同じ場面）に大きな文字を載せる
import {
  THUMB_ALIGNS,
  THUMB_MAX_LINES,
  THUMB_POSITIONS,
  THUMB_SIZES,
  THUMB_TEMPLATES,
  type ThumbAlign,
  type ThumbPosition,
  type ThumbSize,
  type ThumbTemplate,
} from '../data/thumbnail';
import type { Project } from './project';
import { locate, sourceRangeOnTimeline } from './timeline';

export interface ThumbnailSetting {
  /** 使う場面（録画と、その中の時刻） */
  sourceId: string;
  time: number;
  /** 載せる文字（改行で行を分ける） */
  text: string;
  template: ThumbTemplate;
  color: string;
  size: ThumbSize;
  position: ThumbPosition;
  align: ThumbAlign;
}

/** 完成した動画の時刻 t の場面で、サムネイルの設定を作る（文字はタイトルから） */
export function newThumbnail(project: Project, t: number): ThumbnailSetting | null {
  const loc = locate(project, t);
  if (!loc) return null;
  const text = (project.publish.title || project.name || '').trim();
  return {
    sourceId: loc.clip.sourceId,
    time: loc.sourceTime,
    text: limitLines(text),
    template: 'impact',
    color: THUMB_TEMPLATES[0].color,
    size: 'large',
    position: 'bottom',
    align: 'center',
  };
}

/** 場面を、完成した動画の時刻 t のものにする */
export function setThumbnailFrame(setting: ThumbnailSetting, project: Project, t: number): ThumbnailSetting {
  const loc = locate(project, t);
  return loc ? { ...setting, sourceId: loc.clip.sourceId, time: loc.sourceTime } : setting;
}

/** 選んだ場面が、完成した動画のどこにあるか（カットで消えていれば null） */
export function thumbnailFrameOnTimeline(project: Project, setting: ThumbnailSetting): number | null {
  const spans = sourceRangeOnTimeline(project, { sourceId: setting.sourceId, start: setting.time, end: setting.time + 1e-4 });
  return spans[0]?.[0] ?? null;
}

/** 行の数を THUMB_MAX_LINES までにする */
export function limitLines(text: string): string {
  return text.split('\n').slice(0, THUMB_MAX_LINES).join('\n');
}

/** 文字の行（空の行は除く） */
export function thumbnailLines(setting: ThumbnailSetting): string[] {
  return limitLines(setting.text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** 作品ファイルなどから読む。おかしければ null */
export function readThumbnail(value: unknown, sourceIds: Set<string>): ThumbnailSetting | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sourceId !== 'string' || !sourceIds.has(v.sourceId)) return null;
  if (typeof v.time !== 'number' || !Number.isFinite(v.time) || v.time < 0 || typeof v.text !== 'string') return null;
  const template = THUMB_TEMPLATES.find((t) => t.value === v.template)?.value ?? 'impact';
  return {
    sourceId: v.sourceId,
    time: v.time,
    text: limitLines(v.text),
    template,
    color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : THUMB_TEMPLATES[0].color,
    size: THUMB_SIZES.find((s) => s.value === v.size)?.value ?? 'large',
    position: THUMB_POSITIONS.find((p) => p.value === v.position)?.value ?? 'bottom',
    align: THUMB_ALIGNS.find((a) => a.value === v.align)?.value ?? 'center',
  };
}
