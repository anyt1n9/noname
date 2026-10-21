// 画面の一部を拡大（v0.6）。寄るときと戻るときは、なめらかに動く
import { DEFAULT_ZOOM_WIDTH, MIN_ZOOM_WIDTH, ZOOM_EASE_SECONDS } from '../data/zoom';
import type { Project, ZoomEffect } from './project';
import { rangedAt, rangedOnTimeline } from './ranged';
import { clamp } from './time';
import { sourceRangesOnTimeline, timelineToSource } from './timeline';

/** 見せる範囲（画面に対する割合。x・y は真ん中、w は幅で、高さも同じ割合） */
export interface ZoomRect {
  x: number;
  y: number;
  w: number;
}

/** 画面からはみ出さないように直す */
export function clampZoom(rect: ZoomRect): ZoomRect {
  const w = clamp(rect.w, MIN_ZOOM_WIDTH, 1);
  return { w, x: clamp(rect.x, w / 2, 1 - w / 2), y: clamp(rect.y, w / 2, 1 - w / 2) };
}

/** from〜to 秒（完成した動画の時刻）に拡大を入れる。最初は真ん中を2倍 */
export function addZoom(project: Project, from: number, to: number): { project: Project; id: string | null } {
  const ranges = timelineToSource(project, from, to);
  if (ranges.length === 0) return { project, id: null };
  const id = `z${project.nextId}`;
  const zoom: ZoomEffect = { id, ranges, x: 0.5, y: 0.5, w: DEFAULT_ZOOM_WIDTH };
  return { project: { ...project, zooms: [...project.zooms, zoom], nextId: project.nextId + 1 }, id };
}

function update(project: Project, id: string, change: (z: ZoomEffect) => ZoomEffect | null): Project {
  const index = project.zooms.findIndex((z) => z.id === id);
  if (index < 0) return project;
  const next = change(project.zooms[index]);
  const zooms = [...project.zooms];
  if (next) zooms[index] = next;
  else zooms.splice(index, 1);
  return { ...project, zooms };
}

export function setZoomRect(project: Project, id: string, rect: ZoomRect): Project {
  return update(project, id, (z) => ({ ...z, ...clampZoom(rect) }));
}

/** 拡大の大きさを変える（真ん中はそのまま） */
export function setZoomFactor(project: Project, id: string, factor: number): Project {
  return update(project, id, (z) => ({ ...z, ...clampZoom({ x: z.x, y: z.y, w: 1 / factor }) }));
}

export function setZoomTime(project: Project, id: string, from: number, to: number): Project {
  const ranges = timelineToSource(project, from, to);
  if (ranges.length === 0) return project;
  return update(project, id, (z) => ({ ...z, ranges }));
}

export function removeZoom(project: Project, id: string): Project {
  return update(project, id, () => null);
}

export function zoomsOnTimeline(project: Project): { id: string; key: string; from: number; to: number; factor: number }[] {
  return rangedOnTimeline(project, project.zooms).map(({ item, key, from, to }) => ({ id: item.id, key, from, to, factor: 1 / item.w }));
}

/** なめらかに動かすための曲線（0〜1） */
function ease(k: number): number {
  return k * k * (3 - 2 * k);
}

/**
 * 完成した動画の時刻 t に見せる範囲。拡大していなければ null。
 * 拡大の始まりと終わりの ZOOM_EASE_SECONDS 秒は、画面全体からなめらかに寄る・戻る。
 * skip の拡大は無視する（場所を選んでいる間は、拡大する前の画面を見せるため）。
 */
export function zoomAt(project: Project, t: number, skip?: string): ZoomRect | null {
  const zooms = rangedAt(project, project.zooms, t).filter((z) => z.id !== skip);
  const zoom = zooms[zooms.length - 1];
  if (!zoom) return null;
  const span = sourceRangesOnTimeline(project, zoom.ranges).find(([a, b]) => t >= a - 1e-6 && t < b + 1e-6);
  if (!span) return null;
  const edge = Math.min(ZOOM_EASE_SECONDS, (span[1] - span[0]) / 2);
  const k = ease(clamp(Math.min(t - span[0], span[1] - t) / Math.max(edge, 1e-6), 0, 1));
  if (k <= 0) return null;
  return { x: 0.5 + (zoom.x - 0.5) * k, y: 0.5 + (zoom.y - 0.5) * k, w: 1 + (zoom.w - 1) * k };
}
