// 映像の上に重ねるもの（字幕など）を描く。プレビューと書き出しで同じものを使う
import type { Project } from '../core/project';
import { subtitleAt } from '../core/subtitles';
import { captionGlyphsReady, loadCaptionGlyphs } from './caption-font';
import { drawCaption } from './caption-render';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 重ねるものがあるか（書き出しで、重ねる処理が要るかを決める） */
export function hasOverlays(project: Project): boolean {
  return project.subtitles.length > 0;
}

/** 完成した動画の時刻 t に重ねるものを描くのに必要な準備（フォントの読み込み） */
export async function prepareOverlays(project: Project, t: number): Promise<void> {
  const s = subtitleAt(project, t);
  if (s && !captionGlyphsReady(s.text)) await loadCaptionGlyphs(s.text);
}

/** 準備ができていなければ false（プレビューでは、準備ができたら描き直す） */
export function overlaysReady(project: Project, t: number): boolean {
  const s = subtitleAt(project, t);
  return !s || captionGlyphsReady(s.text);
}

/** 完成した動画の時刻 t に重ねるものを描く */
export function drawOverlays(ctx: Ctx, project: Project, t: number, width: number, height: number): void {
  const s = subtitleAt(project, t);
  if (s) drawCaption(ctx, s.text, width, height, project.subtitleStyle);
}
