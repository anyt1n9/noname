// サムネイル（v0.9）を描く・保存する。プレビューと保存で同じ描き方を使う
import { CanvasSink } from 'mediabunny';
import { thumbnailLines, type ThumbnailSetting } from '../core/thumbnail';
import { SUBTITLE_FONT_FAMILY, SUBTITLE_FONT_WEIGHT } from '../data/subtitle-style';
import { THUMB_SIZES } from '../data/thumbnail';
import { captionGlyphsReady, loadCaptionGlyphs } from './caption-font';
import type { SourceRegistry } from './registry';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const sinks = new Map<string, CanvasSink>();

/** 選んだ場面の映像（画面いっぱいに切り取ったもの）。録画を開けなければ null */
export async function thumbnailFrame(registry: SourceRegistry, setting: ThumbnailSetting, width: number, height: number): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  const source = await registry.open(setting.sourceId).catch(() => null);
  if (!source) return null;
  const key = `${setting.sourceId}:${source.file.name}:${width}x${height}`;
  let sink = sinks.get(key);
  if (!sink) {
    sink = new CanvasSink(source.video, { width, height, fit: 'cover', poolSize: 1 });
    sinks.set(key, sink);
  }
  const frame = await sink.getCanvas(setting.time);
  return frame?.canvas ?? null;
}

/** 文字の形を用意する（使う文字の分だけ読み込む） */
export async function prepareThumbnailText(setting: ThumbnailSetting): Promise<void> {
  if (!captionGlyphsReady(setting.text)) await loadCaptionGlyphs(setting.text);
}

const font = (px: number) => `${SUBTITLE_FONT_WEIGHT} ${px}px "${SUBTITLE_FONT_FAMILY}", "Hiragino Sans", "Yu Gothic", sans-serif`;

/** 場面と文字を描く */
export function drawThumbnail(ctx: Ctx, frame: CanvasImageSource | null, setting: ThumbnailSetting, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (frame) ctx.drawImage(frame, 0, 0, width, height);
  const lines = thumbnailLines(setting);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }
  // 文字の大きさ：一番長い行が画面の幅に収まるよう小さくする
  let size = Math.round(height * (THUMB_SIZES.find((s) => s.value === setting.size)?.ratio ?? 0.17));
  ctx.font = font(size);
  const maxWidth = width * 0.88;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > maxWidth) size = Math.max(12, Math.floor((size * maxWidth) / widest));
  ctx.font = font(size);
  const lineHeight = size * 1.2;
  const block = lineHeight * lines.length;
  const margin = height * 0.07;
  const top = setting.position === 'top' ? margin : setting.position === 'middle' ? (height - block) / 2 : height - margin - block;
  const x = setting.align === 'left' ? width * 0.06 : width / 2;
  ctx.textAlign = setting.align === 'left' ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // 文字の後ろ
  if (setting.template === 'band') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(0, top - size * 0.25, width, block + size * 0.5);
  } else if (setting.template === 'simple') {
    const g =
      setting.position === 'middle'
        ? null
        : setting.position === 'bottom'
          ? ctx.createLinearGradient(0, height * 0.4, 0, height)
          : ctx.createLinearGradient(0, height * 0.6, 0, 0);
    if (g) {
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    }
    ctx.fillRect(0, 0, width, height);
  }

  lines.forEach((line, i) => {
    const y = top + lineHeight * (i + 0.5);
    if (setting.template === 'impact') {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = size * 0.12;
      ctx.shadowOffsetY = size * 0.06;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = size * 0.24;
      ctx.strokeText(line, x, y);
      ctx.restore();
      ctx.fillStyle = setting.color;
      ctx.fillText(line, x, y);
    } else if (setting.template === 'pop') {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = size * 0.34;
      ctx.strokeText(line, x, y);
      ctx.strokeStyle = setting.color;
      ctx.lineWidth = size * 0.2;
      ctx.strokeText(line, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(line, x, y);
    } else if (setting.template === 'band') {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = size * 0.08;
      ctx.strokeText(line, x, y);
      ctx.fillStyle = setting.color;
      ctx.fillText(line, x, y);
    } else {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = size * 0.15;
      ctx.fillStyle = setting.color;
      ctx.fillText(line, x, y);
      ctx.restore();
    }
  });
  ctx.restore();
}

/** 保存する画像を作る */
export async function renderThumbnail(registry: SourceRegistry, setting: ThumbnailSetting, width: number, height: number, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  await prepareThumbnailText(setting);
  const frame = await thumbnailFrame(registry, setting, width, height);
  const canvas = new OffscreenCanvas(width, height);
  drawThumbnail(canvas.getContext('2d')!, frame, setting, width, height);
  return canvas.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.92 } : { type });
}

/** 作品を閉じたときなどに、覚えている読み出し口を捨てる */
export function forgetThumbnailFrames(): void {
  sinks.clear();
}
