// プレビューの上に、作っているサムネイルを重ねて見せる（v0.9）
import { useEffect, useRef } from 'preact/hooks';
import type { ThumbnailSetting } from '../core/thumbnail';
import type { SourceRegistry } from '../media/registry';
import { drawThumbnail, prepareThumbnailText, thumbnailFrame } from '../media/thumbnail';

const WIDTH = 1280;
const HEIGHT = 720;

export function ThumbnailPreview({ setting, registry }: { setting: ThumbnailSetting; registry: SourceRegistry }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const canvas = ref.current!;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    void (async () => {
      const frame = await thumbnailFrame(registry, setting, WIDTH, HEIGHT);
      if (!alive) return;
      const g = canvas.getContext('2d')!;
      drawThumbnail(g, frame, setting, WIDTH, HEIGHT);
      // 文字の形がまだなら、読み込んでから描き直す
      await prepareThumbnailText(setting);
      if (alive) drawThumbnail(g, frame, setting, WIDTH, HEIGHT);
    })();
    return () => {
      alive = false;
    };
  }, [setting, registry]);
  return <canvas ref={ref} class="thumbnail-preview" aria-label="サムネイルのプレビュー" />;
}
