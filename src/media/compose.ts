// 映像の上に重ねるもの（画像・字幕・フェード）を描く。プレビューと書き出しで同じものを使う
import { fadeLevel, fadeWindows } from '../core/fades';
import { imagePixels, imagesAt } from '../core/images';
import type { Project } from '../core/project';
import { subtitleAt } from '../core/subtitles';
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
  return project.subtitles.length > 0 || project.images.length > 0 || fadeWindows(project).length > 0;
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

/** 完成した動画の時刻 t に重ねるものを描く（画像 → 字幕 → フェードの順） */
export function drawOverlays(ctx: Ctx, project: Project, t: number, width: number, height: number): void {
  for (const image of imagesAt(project, t)) {
    const bitmap = bitmaps.get(image.assetId);
    if (!bitmap) continue;
    const asset = project.assets.find((a) => a.id === image.assetId);
    const r = imagePixels(image, asset, width, height);
    ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
  }
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
