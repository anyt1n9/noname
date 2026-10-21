// 矢印・四角い枠・丸（v0.6）。出す時間は画像と同じく録画の中の時刻で持つ
import { IMAGE_MARGIN } from '../data/images';
import { SHAPE_SIZE, type ArrowDirection, type ShapeKind, type ShapePlace } from '../data/shapes';
import type { Project, ShapeOverlay } from './project';
import { rangedAt, rangedOnTimeline } from './ranged';
import { clamp } from './time';
import { timelineToSource } from './timeline';

/** 図形を囲む四角（x・w は画面の幅、y・h は画面の高さに対する割合。x・y は真ん中） */
export interface ShapeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** from〜to 秒（完成した動画の時刻）に図形を置く。最初は画面の真ん中 */
export function addShape(project: Project, kind: ShapeKind, from: number, to: number, frameAspect: number): { project: Project; id: string | null } {
  const ranges = timelineToSource(project, from, to);
  if (ranges.length === 0) return { project, id: null };
  const id = `g${project.nextId}`;
  // 丸や矢印は、画面の上で縦横が同じ長さに見えるようにする
  const w = kind === 'rect' ? SHAPE_SIZE * 1.4 : SHAPE_SIZE;
  const h = kind === 'rect' ? SHAPE_SIZE * frameAspect : w * frameAspect;
  const shape: ShapeOverlay = { id, kind, ranges, x: 0.5, y: 0.5, w, h, color: '#ff3b30', thickness: 'normal', direction: 'down-left' };
  return { project: { ...project, shapes: [...project.shapes, shape], nextId: project.nextId + 1 }, id };
}

function update(project: Project, id: string, change: (s: ShapeOverlay) => ShapeOverlay | null): Project {
  const index = project.shapes.findIndex((s) => s.id === id);
  if (index < 0) return project;
  const next = change(project.shapes[index]);
  const shapes = [...project.shapes];
  if (next) shapes[index] = next;
  else shapes.splice(index, 1);
  return { ...project, shapes };
}

/** ドラッグで動かす・大きさを変える */
export function moveShape(project: Project, id: string, rect: ShapeRect): Project {
  return update(project, id, (s) => ({
    ...s,
    w: clamp(rect.w, 0.02, 1),
    h: clamp(rect.h, 0.02, 1),
    x: clamp(rect.x, 0, 1),
    y: clamp(rect.y, 0, 1),
  }));
}

/** 四隅や中央に置き直す（大きさはそのまま） */
export function placeShape(project: Project, id: string, place: ShapePlace, frameAspect: number): Project {
  return update(project, id, (s) => {
    const mx = IMAGE_MARGIN / frameAspect;
    const my = IMAGE_MARGIN;
    const left = place === 'top-left' || place === 'bottom-left';
    const top = place === 'top-left' || place === 'top-right';
    if (place === 'center') return { ...s, x: 0.5, y: 0.5 };
    return { ...s, x: left ? mx + s.w / 2 : 1 - mx - s.w / 2, y: top ? my + s.h / 2 : 1 - my - s.h / 2 };
  });
}

export function setShapeStyle(project: Project, id: string, style: Partial<Pick<ShapeOverlay, 'color' | 'thickness' | 'direction'>>): Project {
  return update(project, id, (s) => ({ ...s, ...style }));
}

export function setShapeTime(project: Project, id: string, from: number, to: number): Project {
  const ranges = timelineToSource(project, from, to);
  if (ranges.length === 0) return project;
  return update(project, id, (s) => ({ ...s, ranges }));
}

export function removeShape(project: Project, id: string): Project {
  return update(project, id, () => null);
}

export function shapesAt(project: Project, t: number): ShapeOverlay[] {
  return rangedAt(project, project.shapes, t);
}

export function shapesOnTimeline(project: Project): { id: string; key: string; from: number; to: number; kind: ShapeKind }[] {
  return rangedOnTimeline(project, project.shapes).map(({ item, key, from, to }) => ({ id: item.id, key, from, to, kind: item.kind }));
}

/** 矢印の向きから、矢印の根もとと先（四角の中の割合 0〜1） */
export function arrowEnds(direction: ArrowDirection): { from: [number, number]; to: [number, number] } {
  const v: Record<ArrowDirection, [number, number]> = {
    'up-left': [-1, -1],
    up: [0, -1],
    'up-right': [1, -1],
    left: [-1, 0],
    right: [1, 0],
    'down-left': [-1, 1],
    down: [0, 1],
    'down-right': [1, 1],
  };
  const [dx, dy] = v[direction];
  return { from: [0.5 - dx / 2, 0.5 - dy / 2], to: [0.5 + dx / 2, 0.5 + dy / 2] };
}
