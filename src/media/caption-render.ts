// 字幕を映像の上に描く（定番：白文字＋黒縁）。プレビューと書き出しで同じものを使う
import { SUBTITLE_FONT_FAMILY, SUBTITLE_FONT_WEIGHT, SUBTITLE_SIZES, type SubtitleStyle } from '../data/subtitle-style';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 画面の端からの余白（高さに対する割合） */
const MARGIN = 0.055;
/** 文字の幅の上限（画面の幅に対する割合）。これより長い行は小さくする */
const MAX_WIDTH = 0.94;

export function drawCaption(ctx: Ctx, text: string, width: number, height: number, style: SubtitleStyle): void {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return;
  const ratio = SUBTITLE_SIZES.find((s) => s.value === style.size)?.ratio ?? 0.058;
  let size = Math.round(height * ratio);
  const font = (px: number) => `${SUBTITLE_FONT_WEIGHT} ${px}px "${SUBTITLE_FONT_FAMILY}", "Hiragino Sans", "Yu Gothic", sans-serif`;
  ctx.save();
  ctx.font = font(size);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > width * MAX_WIDTH) {
    size = Math.max(10, Math.floor((size * width * MAX_WIDTH) / widest));
    ctx.font = font(size);
  }
  const lineHeight = size * 1.3;
  const margin = height * MARGIN;
  const firstBaseline =
    style.position === 'top' ? margin + size * 0.9 : height - margin - size * 0.25 - lineHeight * (lines.length - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, size * 0.2);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = style.color;
  lines.forEach((line, i) => {
    const y = firstBaseline + i * lineHeight;
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
  });
  ctx.restore();
}
