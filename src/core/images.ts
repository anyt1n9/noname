// 映像に重ねる画像（v0.5）。出す時間は録画の中の時刻で持つので、カットしても映像とずれない
import {
  CENTER_WIDTH,
  CORNER_WIDTH,
  IMAGE_MARGIN,
  MAX_IMAGE_WIDTH,
  MIN_IMAGE_WIDTH,
  type ImagePlace,
} from '../data/images';
import type { Asset, ImageOverlay, Project } from './project';
import { clamp } from './time';
import { locate, sourceRangesOnTimeline, timelineToSource } from './timeline';

/** 画面の上での四角（画面の幅・高さに対する割合。x・y は真ん中） */
export interface PlaceRect {
  x: number;
  y: number;
  w: number;
}

/**
 * 置き方から、画像の真ん中の位置と幅を決める。
 * aspect は画像の「幅 ÷ 高さ」、frameAspect は画面の「幅 ÷ 高さ」。
 */
export function placeRect(place: Exclude<ImagePlace, 'free'>, aspect: number, frameAspect: number): PlaceRect {
  // 画面の高さに対する画像の高さ
  const heightOf = (w: number) => (w * frameAspect) / aspect;
  const fit = (w: number, maxH: number) => (heightOf(w) > maxH ? (maxH * aspect) / frameAspect : w);
  const marginY = IMAGE_MARGIN;
  const marginX = IMAGE_MARGIN / frameAspect;
  if (place === 'full') return { x: 0.5, y: 0.5, w: fit(1, 1) };
  if (place === 'center') {
    const w = fit(CENTER_WIDTH, 0.7);
    return { x: 0.5, y: 0.5, w };
  }
  const w = fit(CORNER_WIDTH, 0.42);
  const h = heightOf(w);
  const left = place === 'top-left' || place === 'bottom-left';
  const top = place === 'top-left' || place === 'top-right';
  return {
    x: left ? marginX + w / 2 : 1 - marginX - w / 2,
    y: top ? marginY + h / 2 : 1 - marginY - h / 2,
    w,
  };
}

function aspectOf(asset: Asset | undefined): number {
  return asset && asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 16 / 9;
}

/**
 * 画像を置く。from〜to は完成した動画の時刻。置けなければ（範囲がない）id は null。
 * frameAspect は書き出す画面の「幅 ÷ 高さ」。
 */
export function addImage(
  project: Project,
  asset: Asset,
  from: number,
  to: number,
  place: Exclude<ImagePlace, 'free'>,
  frameAspect: number,
): { project: Project; id: string | null } {
  const ranges = timelineToSource(project, from, to);
  if (ranges.length === 0) return { project, id: null };
  const id = `i${project.nextId}`;
  const image: ImageOverlay = { id, assetId: asset.id, ranges, place, ...placeRect(place, aspectOf(asset), frameAspect) };
  const assets = project.assets.some((a) => a.id === asset.id) ? project.assets : [...project.assets, asset];
  return { project: { ...project, assets, images: [...project.images, image], nextId: project.nextId + 1 }, id };
}

function update(project: Project, id: string, change: (image: ImageOverlay) => ImageOverlay | null): Project {
  const index = project.images.findIndex((i) => i.id === id);
  if (index < 0) return project;
  const next = change(project.images[index]);
  const images = [...project.images];
  if (next) images[index] = next;
  else images.splice(index, 1);
  return { ...project, images };
}

/** 置き方を変える（右上・中央など） */
export function setImagePlace(project: Project, id: string, place: Exclude<ImagePlace, 'free'>, frameAspect: number): Project {
  return update(project, id, (image) => {
    const asset = project.assets.find((a) => a.id === image.assetId);
    return { ...image, place, ...placeRect(place, aspectOf(asset), frameAspect) };
  });
}

/** ドラッグで動かす・大きさを変える。画面からはみ出しすぎないようにする */
export function moveImage(project: Project, id: string, rect: PlaceRect): Project {
  return update(project, id, (image) => {
    const w = clamp(rect.w, MIN_IMAGE_WIDTH, MAX_IMAGE_WIDTH);
    return { ...image, place: 'free', w, x: clamp(rect.x, 0, 1), y: clamp(rect.y, 0, 1) };
  });
}

/** 出す時間を変える（完成した動画の時刻で指定） */
export function setImageTime(project: Project, id: string, from: number, to: number): Project {
  const ranges = timelineToSource(project, from, to);
  if (ranges.length === 0) return project;
  return update(project, id, (image) => ({ ...image, ranges }));
}

export function removeImage(project: Project, id: string): Project {
  return update(project, id, () => null);
}

/** 完成した動画の時刻 t に出ている画像（後ろのものほど手前に描く） */
export function imagesAt(project: Project, t: number): ImageOverlay[] {
  if (project.images.length === 0) return [];
  const loc = locate(project, t);
  if (!loc) return [];
  const { sourceId } = loc.clip;
  const st = loc.sourceTime;
  return project.images.filter((image) => image.ranges.some((r) => r.sourceId === sourceId && r.start <= st && st < r.end));
}

/** タイムラインに見えている画像（見えている部分ごと） */
export function imagesOnTimeline(project: Project): { id: string; key: string; from: number; to: number; name: string }[] {
  const out: { id: string; key: string; from: number; to: number; name: string }[] = [];
  for (const image of project.images) {
    const name = project.assets.find((a) => a.id === image.assetId)?.name ?? '画像';
    sourceRangesOnTimeline(project, image.ranges).forEach(([from, to], i) => {
      if (to - from >= 0.05) out.push({ id: image.id, key: `${image.id}#${i}`, from, to, name });
    });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** 画像を描く四角（ピクセル）。width・height は画面の大きさ */
export function imagePixels(image: ImageOverlay, asset: Asset | undefined, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const w = image.w * width;
  const h = w / aspectOf(asset);
  return { x: image.x * width - w / 2, y: image.y * height - h / 2, w, h };
}
