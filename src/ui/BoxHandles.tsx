// プレビューの上で、選んだもの（画像・矢印や枠・拡大する範囲）をドラッグで動かす・大きさを変える
import { useEffect, useRef, useState } from 'preact/hooks';
import { clamp } from '../core/time';

/** 画面の上の四角（x・w は画面の幅、y・h は画面の高さに対する割合。x・y は真ん中） */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  box: Box;
  /** プレビューの枠（この中に 16:9 の映像が収まっている） */
  container: HTMLElement;
  /** 画面の「幅 ÷ 高さ」 */
  frameAspect: number;
  /** 大きさを変えるとき、h ÷ w をこの値に保つ（保たなければ undefined） */
  lockRatio?: number;
  minW: number;
  maxW: number;
  /** 見た目（拡大する範囲は点線） */
  variant?: 'solid' | 'dashed';
  label: string;
  onDraft(box: Box): void;
  onCommit(box: Box): void;
}

/** 枠の中で、映像が映っている四角 */
function contentRect(el: HTMLElement, aspect: number): { x: number; y: number; w: number; h: number } {
  const W = el.clientWidth;
  const H = el.clientHeight;
  if (W / H > aspect) {
    const w = H * aspect;
    return { x: (W - w) / 2, y: 0, w, h: H };
  }
  const h = W / aspect;
  return { x: 0, y: (H - h) / 2, w: W, h };
}

export function BoxHandles(p: Props) {
  const [, setSize] = useState(0);
  const drag = useRef<{ kind: 'move' | 'resize'; startX: number; startY: number; start: Box; last: Box } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(() => setSize((n) => n + 1));
    ro.observe(p.container);
    return () => ro.disconnect();
  }, [p.container]);

  const content = contentRect(p.container, p.frameAspect);
  const left = content.x + (p.box.x - p.box.w / 2) * content.w;
  const top = content.y + (p.box.y - p.box.h / 2) * content.h;

  const onDown = (kind: 'move' | 'resize') => (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, startX: e.clientX, startY: e.clientY, start: p.box, last: p.box };
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / content.w;
    const dy = (e.clientY - d.startY) / content.h;
    let box: Box;
    if (d.kind === 'move') {
      box = { ...d.start, x: clamp(d.start.x + dx, 0, 1), y: clamp(d.start.y + dy, 0, 1) };
    } else {
      // 右下の角を動かす：左上の角はそのままにして広げる
      const w = clamp(d.start.w + dx, p.minW, p.maxW);
      const h = p.lockRatio !== undefined ? w * p.lockRatio : clamp(d.start.h + dy, 0.02, 1);
      const l = d.start.x - d.start.w / 2;
      const t = d.start.y - d.start.h / 2;
      box = { w, h, x: l + w / 2, y: t + h / 2 };
    }
    d.last = box;
    p.onDraft(box);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && (d.last.x !== d.start.x || d.last.y !== d.start.y || d.last.w !== d.start.w || d.last.h !== d.start.h)) p.onCommit(d.last);
  };

  return (
    <div
      class={`box-handles ${p.variant ?? 'solid'}`}
      style={{ left: `${left}px`, top: `${top}px`, width: `${p.box.w * content.w}px`, height: `${p.box.h * content.h}px` }}
      onPointerDown={onDown('move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (drag.current = null)}
      title="ドラッグで動かす"
      role="group"
      aria-label={p.label}
    >
      <div class="resize" onPointerDown={onDown('resize')} title="ドラッグで大きさを変える" />
    </div>
  );
}
