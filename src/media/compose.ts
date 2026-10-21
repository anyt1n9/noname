// 映像の上に重ねるもの（画像・矢印や枠・字幕・フェード）と、拡大を描く。プレビューと書き出しで同じものを使う
import { fadeLevel, fadeWindows } from '../core/fades';
import { imagePixels, imagesAt } from '../core/images';
import type { Project, ShapeOverlay } from '../core/project';
import { arrowEnds, shapesAt } from '../core/shapes';
import { subtitleAt } from '../core/subtitles';
import { zoomAt } from '../core/zoom';
import { SHAPE_THICKNESS } from '../data/shapes';
import { captionGlyphsReady, loadCaptionGlyphs } from './caption-font';
import { drawCaption } from './caption-render';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 画像の中身の取り出し方（画面ではブラウザの中の保存場所、書き出しでは渡されたファイル） */
let loadBlob: (assetId: string) => Promise<Blob | null> = async () => null;
const bitmaps = new Map<string, ImageBitmap | null>();
const loading = new Map<string, Promise<void>>();

export function setImageSource(load: (assetId: string) => Promise<Blob | null>): void {
  loadBlob = load;
}

function loadBitmap(assetId: string): Promise<void> {
  let p = loading.get(assetId);
  if (!p) {
    p = (async () => {
      try {
        const blob = await loadBlob(assetId);
        bitmaps.set(assetId, blob ? await createImageBitmap(blob) : null);
      } catch {
        bitmaps.set(assetId, null);
      }
    })();
    loading.set(assetId, p);
  }
  return p;
}

/** 重ねるものがあるか（書き出しで、重ねる処理が要るかを決める） */
export function hasOverlays(project: Project): boolean {
  return (
    project.subtitles.length > 0 ||
    project.images.length > 0 ||
    project.shapes.length > 0 ||
    project.zooms.length > 0 ||
    fadeWindows(project).length > 0
  );
}

/**
 * 拡大するときは、映像を描く前に呼ぶ（描く位置と大きさを変える）。拡大しないときは何もしない。
 * 描き終えたら resetZoom で元に戻す。
 */
export function applyZoom(ctx: Ctx, project: Project, t: number, width: number, height: number): void {
  const z = zoomAt(project, t);
  if (!z) return;
  const s = 1 / z.w;
  ctx.setTransform(s, 0, 0, s, -(z.x - z.w / 2) * width * s, -(z.y - z.w / 2) * height * s);
}

export function resetZoom(ctx: Ctx): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** 完成した動画の時刻 t に重ねるものを描くのに必要な準備（フォントと画像の読み込み） */
export async function prepareOverlays(project: Project, t: number): Promise<void> {
  const jobs: Promise<void>[] = [];
  const s = subtitleAt(project, t);
  if (s && !captionGlyphsReady(s.text)) jobs.push(loadCaptionGlyphs(s.text));
  for (const image of imagesAt(project, t)) if (!bitmaps.has(image.assetId)) jobs.push(loadBitmap(image.assetId));
  await Promise.all(jobs);
}

/** 準備ができていなければ false（プレビューでは、準備ができたら描き直す） */
export function overlaysReady(project: Project, t: number): boolean {
  const s = subtitleAt(project, t);
  if (s && !captionGlyphsReady(s.text)) return false;
  return imagesAt(project, t).every((image) => bitmaps.has(image.assetId));
}

/** 完成した動画の時刻 t に重ねるものを描く（画像 → 矢印や枠 → 字幕 → フェードの順） */
export function drawOverlays(ctx: Ctx, project: Project, t: number, width: number, height: number): void {
  for (const image of imagesAt(project, t)) {
    const bitmap = bitmaps.get(image.assetId);
    if (!bitmap) continue;
    const asset = project.assets.find((a) => a.id === image.assetId);
    const r = imagePixels(image, asset, width, height);
    ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
  }
  for (const shape of shapesAt(project, t)) drawShape(ctx, shape, width, height);
  const s = subtitleAt(project, t);
  if (s) drawCaption(ctx, s.text, width, height, project.subtitleStyle);
  const level = fadeLevel(project, t);
  if (level < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - level;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

/** 矢印・四角い枠・丸を描く。どんな映像の上でも見えるよう、黒いふちを付ける */
export function drawShape(ctx: Ctx, shape: ShapeOverlay, width: number, height: number): void {
  const line = (SHAPE_THICKNESS.find((t) => t.value === shape.thickness)?.ratio ?? 0.011) * height;
  const x = (shape.x - shape.w / 2) * width;
  const y = (shape.y - shape.h / 2) * height;
  const w = shape.w * width;
  const h = shape.h * height;
  const outline = Math.max(2, line * 0.35);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = (): void => {
    ctx.beginPath();
    if (shape.kind === 'rect') {
      ctx.roundRect(x + line / 2, y + line / 2, Math.max(1, w - line), Math.max(1, h - line), line);
    } else if (shape.kind === 'circle') {
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, (w - line) / 2), Math.max(1, (h - line) / 2), 0, 0, Math.PI * 2);
    } else {
      const { from, to } = arrowEnds(shape.direction);
      const head = line * 3.2;
      const ax = x + from[0] * w;
      const ay = y + from[1] * h;
      const bx = x + to[0] * w;
      const by = y + to[1] * h;
      const angle = Math.atan2(by - ay, bx - ax);
      // 線は矢じりの手前まで
      const ex = bx - Math.cos(angle) * head * 0.8;
      const ey = by - Math.sin(angle) * head * 0.8;
      ctx.moveTo(ax, ay);
      ctx.lineTo(ex, ey);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(angle - 0.45) * head * 1.25, by - Math.sin(angle - 0.45) * head * 1.25);
      ctx.lineTo(bx - Math.cos(angle + 0.45) * head * 1.25, by - Math.sin(angle + 0.45) * head * 1.25);
      ctx.closePath();
    }
  };
  path();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = line + outline * 2;
  ctx.stroke();
  if (shape.kind === 'arrow') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fill();
  }
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = line;
  ctx.stroke();
  if (shape.kind === 'arrow') {
    ctx.fillStyle = shape.color;
    ctx.fill();
  }
  ctx.restore();
}
