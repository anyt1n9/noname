import { describe, expect, it } from 'vitest';
import { addSources, emptyProject, type SourceInfo } from '../src/core/project';
import { parseProject, readProject, serializeProject } from '../src/core/project-file';
import { addShape, arrowEnds, moveShape, placeShape, removeShape, setShapeStyle, shapesAt, shapesOnTimeline } from '../src/core/shapes';
import { deleteRange, setSpeed } from '../src/core/timeline';
import { addZoom, clampZoom, removeZoom, setZoomFactor, setZoomRect, zoomAt, zoomsOnTimeline } from '../src/core/zoom';
import { ZOOM_EASE_SECONDS } from '../src/data/zoom';

function source(name: string, duration: number): Omit<SourceInfo, 'id'> {
  return { name, size: 1, lastModified: 0, startTime: 0, endTime: duration, width: 1280, height: 720, frameRate: 30, videoCodec: 'vp9', audioTrackCount: 1 };
}
const one = () => addSources(emptyProject(), [source('a', 20)]);
const WIDE = 16 / 9;

describe('画面の一部を拡大', () => {
  it('寄るときと戻るときは、なめらかに動く', () => {
    const r = addZoom(one(), 4, 8);
    expect(r.id).toBe('z3');
    const p = setZoomRect(r.project, r.id!, { x: 0.75, y: 0.25, w: 0.5 });
    expect(zoomAt(p, 3)).toBeNull();
    // 始まりちょうどは画面全体
    expect(zoomAt(p, 4) ?? { w: 1 }).toMatchObject({ w: 1 });
    const mid = zoomAt(p, 4 + ZOOM_EASE_SECONDS / 2)!;
    expect(mid.w).toBeGreaterThan(0.5);
    expect(mid.w).toBeLessThan(1);
    expect(zoomAt(p, 6)).toEqual({ x: 0.75, y: 0.25, w: 0.5 });
    expect(zoomAt(p, 8 - ZOOM_EASE_SECONDS / 2)!.w).toBeCloseTo(mid.w);
    expect(zoomAt(p, 8.1)).toBeNull();
  });

  it('見せる範囲は画面からはみ出さない', () => {
    expect(clampZoom({ x: 1, y: 0, w: 0.5 })).toEqual({ x: 0.75, y: 0.25, w: 0.5 });
    expect(clampZoom({ x: 0.5, y: 0.5, w: 0.01 }).w).toBeGreaterThan(0.1);
    const r = addZoom(one(), 4, 8);
    expect(setZoomFactor(r.project, r.id!, 3).zooms[0].w).toBeCloseTo(1 / 3);
  });

  it('カットや速さを変えても、同じ映像のところで拡大する', () => {
    const r = addZoom(one(), 10, 12);
    expect(zoomsOnTimeline(deleteRange(r.project, 0, 5))).toMatchObject([{ from: 5, to: 7 }]);
    expect(zoomsOnTimeline(setSpeed(r.project, 0, 20, 2))).toMatchObject([{ from: 5, to: 6 }]);
    expect(removeZoom(r.project, r.id!).zooms).toEqual([]);
  });
});

describe('矢印・四角い枠・丸', () => {
  it('なぞった範囲に置き、その時間だけ出る', () => {
    const r = addShape(one(), 'circle', 2, 5, WIDE);
    expect(r.id).toBe('g3');
    expect(shapesAt(r.project, 3).length).toBe(1);
    expect(shapesAt(r.project, 6).length).toBe(0);
    // 丸は画面の上で丸く見える大きさ
    const c = r.project.shapes[0];
    expect(c.w * 1280).toBeCloseTo(c.h * 720);
    expect(shapesOnTimeline(r.project)).toMatchObject([{ kind: 'circle', from: 2, to: 5 }]);
  });

  it('色・太さ・向き・場所・大きさを変えられ、消せる', () => {
    const { project, id } = addShape(one(), 'arrow', 2, 5, WIDE);
    let p = setShapeStyle(project, id!, { color: '#ffd60a', thickness: 'thick', direction: 'up-right' });
    expect(p.shapes[0]).toMatchObject({ color: '#ffd60a', thickness: 'thick', direction: 'up-right' });
    p = placeShape(p, id!, 'top-left', WIDE);
    expect(p.shapes[0].x).toBeLessThan(0.3);
    expect(p.shapes[0].y).toBeLessThan(0.3);
    p = moveShape(p, id!, { x: 0.5, y: 0.6, w: 0.4, h: 0.1 });
    expect(p.shapes[0]).toMatchObject({ x: 0.5, y: 0.6, w: 0.4, h: 0.1 });
    expect(removeShape(p, id!).shapes).toEqual([]);
  });

  it('矢印の向きから、根もとと先を決める', () => {
    expect(arrowEnds('down-left')).toEqual({ from: [1, 0], to: [0, 1] });
    expect(arrowEnds('right')).toEqual({ from: [0, 0.5], to: [1, 0.5] });
  });

  it('作品ファイルに保存して読み込める。おかしなものは読み飛ばす', () => {
    let p = addShape(one(), 'rect', 1, 2, WIDE).project;
    p = addZoom(p, 3, 4).project;
    const r = parseProject(serializeProject(p, 'x'));
    expect(r.ok && r.project.shapes).toEqual(p.shapes);
    expect(r.ok && r.project.zooms).toEqual(p.zooms);
    const broken = readProject({ ...p, shapes: [{ ...p.shapes[0], kind: 'star' }], zooms: [{ ...p.zooms[0], w: 3 }] })!;
    expect(broken.shapes).toEqual([]);
    expect(broken.zooms).toEqual([]);
  });
});
