// プレビューの上で、選んだ画像をドラッグで動かす・大きさを変える（v0.5）
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PlaceRect } from '../core/images';
import type { Asset, ImageOverlay } from '../core/project';
import { clamp } from '../core/time';
import { MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH } from '../data/images';

interface Props {
  image: ImageOverlay;
  asset: Asset | undefined;
  /** プレビューの枠（この中に 16:9 の映像が収まっている） */
  box: HTMLElement;
  /** 画面の「幅 ÷ 高さ」 */
  frameAspect: number;
  /** 動かしている途中 */
  onDraft(rect: PlaceRect): void;
  /** 動かし終えた */
  onCommit(rect: PlaceRect): void;
}

/** 枠の中で、映像が映っている四角 */
function contentRect(box: HTMLElement, aspect: number): { x: number; y: number; w: number; h: number } {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (W / H > aspect) {
    const w = H * aspect;
    return { x: (W - w) / 2, y: 0, w, h: H };
  }
  const h = W / aspect;
  return { x: 0, y: (H - h) / 2, w: W, h };
}

export function ImageHandles(p: Props) {
  const [, setSize] = useState(0);
  const drag = useRef<{ kind: 'move' | 'resize'; startX: number; startY: number; start: PlaceRect; last: PlaceRect } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(() => setSize((n) => n + 1));
    ro.observe(p.box);
    return () => ro.disconnect();
  }, [p.box]);

  const content = contentRect(p.box, p.frameAspect);
  const imageAspect = p.asset && p.asset.height > 0 ? p.asset.width / p.asset.height : 16 / 9;
  const pw = p.image.w * content.w;
  const ph = pw / imageAspect;
  const left = content.x + p.image.x * content.w - pw / 2;
  const top = content.y + p.image.y * content.h - ph / 2;

  const onDown = (kind: 'move' | 'resize') => (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const start = { x: p.image.x, y: p.image.y, w: p.image.w };
    drag.current = { kind, startX: e.clientX, startY: e.clientY, start, last: start };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / content.w;
    const dy = (e.clientY - d.startY) / content.h;
    let rect: PlaceRect;
    if (d.kind === 'move') {
      rect = { ...d.start, x: clamp(d.start.x + dx, 0, 1), y: clamp(d.start.y + dy, 0, 1) };
    } else {
      // 右下の角を動かす：左上の角はそのままにして、縦横の比を保って広げる
      const w = clamp(d.start.w + dx, MIN_IMAGE_WIDTH, MAX_IMAGE_WIDTH);
      const hFrac = (w * content.w) / imageAspect / content.h;
      const startH = (d.start.w * content.w) / imageAspect / content.h;
      rect = { w, x: d.start.x - d.start.w / 2 + w / 2, y: d.start.y - startH / 2 + hFrac / 2 };
    }
    d.last = rect;
    p.onDraft(rect);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && (d.last.x !== d.start.x || d.last.y !== d.start.y || d.last.w !== d.start.w)) p.onCommit(d.last);
  };

  return (
    <div
      class="image-handles"
      style={{ left: `${left}px`, top: `${top}px`, width: `${pw}px`, height: `${ph}px` }}
      onPointerDown={onDown('move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (drag.current = null)}
      title="ドラッグで動かす"
      role="group"
      aria-label="選んだ画像（ドラッグで動かせます）"
    >
      <div class="resize" onPointerDown={onDown('resize')} title="ドラッグで大きさを変える" />
    </div>
  );
}
