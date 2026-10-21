// タイムライン。なぞって消す範囲を選ぶ・再生位置を動かす・かたまりを並べ替える
import { useEffect, useRef, useState } from 'preact/hooks';
import { peakBetween } from '../core/peaks';
import type { Project } from '../core/project';
import { clamp, formatClock } from '../core/time';
import { clipLength, clipStarts, dropIndex, totalDuration } from '../core/timeline';
import { Icon, type IconName } from './icons';
import { cssColor, onThemeChange } from './theme';

const RULER_H = 26;
const HEADER_H = 22;
const TRACK_H = 84;
/** 字幕などの段の高さ */
const LANE_H = 26;
const BASE_HEIGHT = RULER_H + HEADER_H + TRACK_H + 6;
/** 段の端をつかめる幅（ピクセル） */
const EDGE_GRAB = 6;
/** これより小さい動きは「押しただけ」とみなす（ピクセル） */
const DRAG_THRESHOLD = 4;
/** 一番細かく広げたとき、1秒あたりのピクセル */
const MAX_PX_PER_SEC = 600;
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export interface TimelineMark {
  id: string;
  from: number;
  to: number;
  /** 残すと決めた候補 */
  kept: boolean;
}

/** 字幕などの段に並ぶもの（完成した動画の時刻） */
export interface LaneItem {
  /** 見えている部分ごとに違う手がかり */
  key: string;
  /** もとのもの（字幕など）の ID */
  id: string;
  from: number;
  to: number;
  text: string;
}

export interface TimelineLane {
  id: string;
  label: string;
  items: LaneItem[];
  /** 端をドラッグして長さを変えられるか */
  resizable: boolean;
  selectedId?: string | null;
}

export interface TimelineControl {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}

interface Props {
  project: Project;
  time: number;
  playing: boolean;
  selection: [number, number] | null;
  /** 録画の ID → 波形（目盛りごとの一番大きい音）。まだなければ undefined */
  waveform: (sourceId: string) => Float32Array | undefined;
  binSeconds: number;
  /** 波形が増えたら変わる数（描き直しのため） */
  levelsTick: number;
  /** 切る候補などの印（完成した動画の時刻） */
  marks?: TimelineMark[];
  onToggleMark?(id: string): void;
  /** 映像の下に並べる段（字幕など） */
  lanes?: TimelineLane[];
  onLaneItemClick?(lane: string, id: string, t: number): void;
  /** 段のものの端を動かし終えた（item はもとの位置、from〜to が新しい位置） */
  onLaneItemResize?(lane: string, item: LaneItem, from: number, to: number): void;
  /** フェードを入れたつなぎ目の時刻 */
  joinMarks?: number[];
  /** なぞった範囲に出すボタン（「消す」の前に並べる） */
  selectionAction?: { label: string; icon: IconName; onClick(): void };
  missing: Set<string>;
  disabled: boolean;
  control: { current: TimelineControl | null };
  onSeek(t: number): void;
  onSelect(range: [number, number] | null): void;
  onDelete(): void;
  onMove(from: number, to: number): void;
}

interface View {
  pxPerSec: number;
  offset: number;
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'lane'; lane: string; item: LaneItem; edge: 'start' | 'end' | null; startX: number; moved: boolean }
  | { kind: 'select'; startX: number; startT: number; moved: boolean }
  | { kind: 'reorder'; index: number; startX: number; moved: boolean; t: number };

interface Colors {
  bg: string;
  rulerText: string;
  rulerLine: string;
  clipA: string;
  clipB: string;
  clipHeader: string;
  clipMissing: string;
  wave: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  cut: string;
  cutLine: string;
  laneBg: string;
  laneItem: string;
  accentText: string;
}

function readColors(): Colors {
  return {
    bg: cssColor('--panel-2'),
    rulerText: cssColor('--ruler-text'),
    rulerLine: cssColor('--ruler-line'),
    clipA: cssColor('--clip-a'),
    clipB: cssColor('--clip-b'),
    clipHeader: cssColor('--clip-header'),
    clipMissing: cssColor('--clip-missing'),
    wave: cssColor('--wave'),
    text: cssColor('--text'),
    muted: cssColor('--muted'),
    accent: cssColor('--accent'),
    accentSoft: cssColor('--accent-soft'),
    cut: cssColor('--cut'),
    cutLine: cssColor('--cut-line'),
    laneBg: cssColor('--panel'),
    laneItem: cssColor('--lane-item'),
    accentText: cssColor('--accent-text'),
  };
}

export function Timeline(props: Props) {
  const { project, time, selection, missing, disabled } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [view, setView] = useState<View>({ pxPerSec: 10, offset: 0 });
  const [colors, setColors] = useState<Colors | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  /** 段のものの端を動かしている途中の位置 */
  const [laneDraft, setLaneDraft] = useState<{ key: string; from: number; to: number } | null>(null);
  const lanes = props.lanes ?? [];
  const HEIGHT = BASE_HEIGHT + lanes.length * LANE_H;
  const drag = useRef<Drag | null>(null);
  const total = totalDuration(project);
  const starts = clipStarts(project);
  const fitPx = width / Math.max(total, 1);
  const minPx = Math.min(fitPx, MAX_PX_PER_SEC);
  const visible = width / view.pxPerSec;
  const maxOffset = Math.max(0, total - visible);
  const offset = clamp(view.offset, 0, maxOffset);

  const latest = useRef(props);
  latest.current = props;

  // 大きさの変化と、明るさの切り替え
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setColors(readColors());
    const off = onThemeChange(() => setColors(readColors()));
    return () => {
      ro.disconnect();
      off();
    };
  }, []);

  // 録画が初めて入ったとき・全部消えたときは全体を表示する
  const hadContent = useRef(false);
  useEffect(() => {
    const has = total > 0;
    if (has && !hadContent.current) setView({ pxPerSec: width / total, offset: 0 });
    hadContent.current = has;
  }, [total, width]);

  // 拡大・縮小しすぎないようにする
  useEffect(() => {
    if (view.pxPerSec < minPx - 1e-9 || view.pxPerSec > MAX_PX_PER_SEC) {
      setView((v) => ({ ...v, pxPerSec: clamp(v.pxPerSec, minPx, MAX_PX_PER_SEC) }));
    }
  }, [minPx, view.pxPerSec]);

  // 再生中は再生位置を追いかける
  useEffect(() => {
    if (!props.playing) return;
    if (time < offset || time > offset + visible * 0.95) {
      setView((v) => ({ ...v, offset: clamp(time - visible * 0.1, 0, maxOffset) }));
    }
  }, [time, props.playing, offset, visible, maxOffset]);

  const zoomAround = (factor: number, anchorX: number) => {
    setView((v) => {
      const px = clamp(v.pxPerSec * factor, minPx, MAX_PX_PER_SEC);
      const anchorT = clamp(v.offset, 0, maxOffset) + anchorX / v.pxPerSec;
      const nextVisible = width / px;
      return { pxPerSec: px, offset: clamp(anchorT - anchorX / px, 0, Math.max(0, total - nextVisible)) };
    });
  };

  props.control.current = {
    zoomIn: () => zoomAround(1.6, clamp((time - offset) * view.pxPerSec, 0, width)),
    zoomOut: () => zoomAround(1 / 1.6, clamp((time - offset) * view.pxPerSec, 0, width)),
    fit: () => setView({ pxPerSec: minPx, offset: 0 }),
  };

  // 描画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !colors) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    canvas.style.height = `${HEIGHT}px`;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(g, {
      width,
      project,
      starts,
      total,
      pxPerSec: view.pxPerSec,
      offset,
      time,
      selection,
      waveform: props.waveform,
      binSeconds: props.binSeconds,
      marks: props.marks ?? [],
      missing,
      colors,
      dragIndex: drag.current?.kind === 'reorder' && drag.current.moved ? drag.current.index : null,
      dropAt,
      lanes,
      laneDraft,
      height: HEIGHT,
      joinMarks: props.joinMarks ?? [],
    });
  });

  const timeAt = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return clamp(offset + (clientX - rect.left) / view.pxPerSec, 0, total);
  };

  const clipIndexAt = (t: number) => {
    for (let i = 0; i < project.clips.length; i++) {
      if (t < starts[i] + clipLength(project.clips[i])) return i;
    }
    return project.clips.length - 1;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (disabled || total <= 0 || e.button !== 0) return;
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const t = timeAt(e.clientX);
    if (y < RULER_H) {
      drag.current = { kind: 'scrub' };
      props.onSelect(null);
      props.onSeek(t);
    } else if (y < RULER_H + HEADER_H) {
      drag.current = { kind: 'reorder', index: clipIndexAt(t), startX: e.clientX, moved: false, t };
    } else if (y < RULER_H + HEADER_H + TRACK_H) {
      drag.current = { kind: 'select', startX: e.clientX, startT: t, moved: false };
    } else {
      // 字幕などの段
      const lane = lanes[Math.floor((y - RULER_H - HEADER_H - TRACK_H) / LANE_H)];
      if (!lane) return;
      const x = e.clientX - rect.left;
      const xOf = (v: number) => (v - offset) * view.pxPerSec;
      let hit: { item: LaneItem; edge: 'start' | 'end' | null } | null = null;
      for (const item of lane.items) {
        const x0 = xOf(item.from);
        const x1 = xOf(item.to);
        if (lane.resizable && Math.abs(x - x0) <= EDGE_GRAB) hit = { item, edge: 'start' };
        else if (lane.resizable && Math.abs(x - x1) <= EDGE_GRAB) hit = { item, edge: 'end' };
        else if (x >= x0 && x <= x1) hit = { item, edge: null };
        if (hit) break;
      }
      if (hit) {
        drag.current = { kind: 'lane', lane: lane.id, item: hit.item, edge: hit.edge, startX: e.clientX, moved: false };
      } else {
        drag.current = { kind: 'scrub' };
        props.onSeek(t);
      }
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // 端に近づいたら自動で横に送る
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (d.kind !== 'reorder' || d.moved) {
      if (x < 24) setView((v) => ({ ...v, offset: clamp(v.offset - 12 / v.pxPerSec, 0, maxOffset) }));
      else if (x > width - 24) setView((v) => ({ ...v, offset: clamp(v.offset + 12 / v.pxPerSec, 0, maxOffset) }));
    }
    const t = timeAt(e.clientX);
    if (d.kind === 'lane') {
      if (!d.edge) return;
      if (!d.moved && Math.abs(e.clientX - d.startX) < 2) return;
      d.moved = true;
      const min = 0.1;
      const from = d.edge === 'start' ? Math.min(t, d.item.to - min) : d.item.from;
      const to = d.edge === 'end' ? Math.max(t, d.item.from + min) : d.item.to;
      setLaneDraft({ key: d.item.key, from, to });
    } else if (d.kind === 'scrub') {
      props.onSeek(t);
    } else if (d.kind === 'select') {
      if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
      d.moved = true;
      props.onSelect([Math.min(d.startT, t), Math.max(d.startT, t)]);
    } else {
      if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
      d.moved = true;
      d.t = t;
      setDropAt(dropIndex(project, d.index, t));
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const t = timeAt(e.clientX);
    if (d.kind === 'lane') {
      const draft = laneDraft;
      setLaneDraft(null);
      if (d.moved && d.edge && draft) props.onLaneItemResize?.(d.lane, d.item, draft.from, draft.to);
      else props.onLaneItemClick?.(d.lane, d.item.id, t);
      return;
    }
    if (d.kind === 'select') {
      if (!d.moved) {
        // 印の上を押したら、印を切り替える（切る候補なら、その場所だけ残す）
        const mark = props.onToggleMark && props.marks?.find((m) => t >= m.from && t <= m.to);
        if (mark) {
          props.onToggleMark!(mark.id);
          return;
        }
        props.onSelect(null);
        props.onSeek(t);
      }
    } else if (d.kind === 'reorder') {
      setDropAt(null);
      if (d.moved) {
        const to = dropIndex(project, d.index, d.t);
        if (to !== d.index) props.onMove(d.index, to);
      } else {
        props.onSeek(t);
      }
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (total <= 0) return;
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAround(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - rect.left);
    } else {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setView((v) => ({ ...v, offset: clamp(v.offset + delta / v.pxPerSec, 0, maxOffset) }));
    }
  };

  // ホイールは既定の動き（ページのスクロール）を止めるため、passive にしない
  useEffect(() => {
    const canvas = canvasRef.current!;
    const handler = (e: WheelEvent) => onWheelRef.current(e);
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;

  const selX = selection ? [(selection[0] - offset) * view.pxPerSec, (selection[1] - offset) * view.pxPerSec] : null;
  const selCenter = selX ? clamp((selX[0] + selX[1]) / 2, 90, width - 90) : 0;

  return (
    <div>
      <div class="timeline-bar">
        <span class="title">タイムライン</span>
        <span class="hint">
          {total <= 0
            ? '録画を入れると、ここに並びます。'
            : props.marks && props.marks.length > 0 && props.onToggleMark
              ? '赤い印が切る候補です。押すと、その場所だけ残せます（もう一度押すと候補に戻ります）。'
              : props.marks && props.marks.length > 0
                ? '赤い印のところが動画から消えます。'
              : '下の段をなぞると、その範囲を消せます。上の名前の帯をドラッグすると、順番を変えられます。'}
        </span>
        <button class="btn icon ghost" title="縮小（−）" aria-label="縮小" onClick={() => props.control.current?.zoomOut()} disabled={total <= 0}>
          <Icon name="minus" />
        </button>
        <button class="btn icon ghost" title="拡大（＋）" aria-label="拡大" onClick={() => props.control.current?.zoomIn()} disabled={total <= 0}>
          <Icon name="plus" />
        </button>
        <button class="btn small" title="全体を表示" onClick={() => props.control.current?.fit()} disabled={total <= 0}>
          全体を表示
        </button>
      </div>
      <div class="timeline-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          aria-label="タイムライン"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setDropAt(null);
          }}
        />
        {selection && selX && !disabled && (
          <div class="selection-actions" style={{ left: `${selCenter}px`, top: `${RULER_H + HEADER_H + 10}px` }}>
            {props.selectionAction && (
              <button class="btn primary small" onClick={props.selectionAction.onClick}>
                <Icon name={props.selectionAction.icon} />
                {props.selectionAction.label}
              </button>
            )}
            <button class={`btn small ${props.selectionAction ? '' : 'primary'}`} title="なぞった範囲を消す（Delete）" onClick={props.onDelete}>
              <Icon name="trash" />
              消す（{formatClock(selection[1] - selection[0], true)}）
            </button>
            <button class="btn small" title="やめる（Esc）" onClick={() => props.onSelect(null)}>
              やめる
            </button>
          </div>
        )}
      </div>
      {maxOffset > 0 && (
        <input
          class="timeline-scroll"
          type="range"
          aria-label="タイムラインを横に動かす"
          min={0}
          max={maxOffset}
          step={maxOffset / 1000}
          value={offset}
          onInput={(e) => setView((v) => ({ ...v, offset: Number((e.target as HTMLInputElement).value) }))}
        />
      )}
    </div>
  );
}

interface DrawArgs {
  joinMarks: number[];
  lanes: TimelineLane[];
  laneDraft: { key: string; from: number; to: number } | null;
  height: number;
  width: number;
  project: Project;
  starts: number[];
  total: number;
  pxPerSec: number;
  offset: number;
  time: number;
  selection: [number, number] | null;
  waveform: (sourceId: string) => Float32Array | undefined;
  binSeconds: number;
  marks: TimelineMark[];
  missing: Set<string>;
  colors: Colors;
  dragIndex: number | null;
  dropAt: number | null;
}

function draw(g: CanvasRenderingContext2D, a: DrawArgs): void {
  const { width, project, starts, pxPerSec, offset, colors } = a;
  const HEIGHT = a.height;
  const xOf = (t: number) => (t - offset) * pxPerSec;
  g.clearRect(0, 0, width, HEIGHT);
  g.fillStyle = colors.bg;
  roundRect(g, 0, 0, width, HEIGHT, 8);
  g.fill();
  if (a.total <= 0) {
    g.fillStyle = colors.muted;
    g.font = '14px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ここに録画が並びます', width / 2, HEIGHT / 2);
    return;
  }

  // 目盛り
  const step = TICK_STEPS.find((s) => s * pxPerSec >= 90) ?? 3600;
  g.font = '12px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const first = Math.floor(offset / step) * step;
  for (let t = first; t <= offset + width / pxPerSec + step; t += step) {
    const x = Math.round(xOf(t)) + 0.5;
    if (x < -50 || x > width + 50) continue;
    g.strokeStyle = colors.rulerLine;
    g.beginPath();
    g.moveTo(x, RULER_H - 8);
    g.lineTo(x, RULER_H);
    g.stroke();
    // 間の小さな目盛り
    for (let k = 1; k < 5; k++) {
      const xs = Math.round(xOf(t + (step * k) / 5)) + 0.5;
      g.beginPath();
      g.moveTo(xs, RULER_H - 4);
      g.lineTo(xs, RULER_H);
      g.stroke();
    }
    g.fillStyle = colors.rulerText;
    g.fillText(formatClock(t, step < 1), x + 4, RULER_H / 2 - 1);
  }

  // かたまり
  const top = RULER_H;
  const trackTop = RULER_H + HEADER_H;
  const sourceIndex = new Map(project.sources.map((s, i) => [s.id, i]));
  project.clips.forEach((clip, i) => {
    const x0 = xOf(starts[i]);
    const x1 = xOf(starts[i] + clipLength(clip));
    if (x1 < 0 || x0 > width) return;
    const isMissing = a.missing.has(clip.sourceId);
    const base = isMissing ? colors.clipMissing : (sourceIndex.get(clip.sourceId) ?? 0) % 2 === 0 ? colors.clipA : colors.clipB;
    const w = Math.max(1, x1 - x0 - 1);
    g.globalAlpha = a.dragIndex === i ? 0.45 : 1;
    // 名前の帯
    g.fillStyle = colors.clipHeader;
    roundRect(g, x0, top + 2, w, HEADER_H - 3, 4);
    g.fill();
    // 映像と音の段
    g.fillStyle = base;
    roundRect(g, x0, trackTop, w, TRACK_H, 4);
    g.fill();
    // 名前
    if (w > 40) {
      const source = project.sources[sourceIndex.get(clip.sourceId) ?? 0];
      g.save();
      g.beginPath();
      g.rect(x0 + 4, top, w - 8, HEADER_H);
      g.clip();
      g.fillStyle = colors.text;
      g.textAlign = 'left';
      g.fillText(`${source?.name ?? ''}  ${formatClock(clipLength(clip))}`, x0 + 6, top + HEADER_H / 2 + 1);
      g.restore();
    }
    // 音の形
    const peaks = a.waveform(clip.sourceId);
    if (peaks) {
      const mid = trackTop + TRACK_H / 2;
      const half = TRACK_H / 2 - 6;
      g.fillStyle = colors.wave;
      const from = Math.max(0, Math.floor(x0));
      const to = Math.min(width, Math.ceil(x1 - 1));
      const secPerPx = 1 / pxPerSec;
      for (let x = from; x < to; x++) {
        const tl = offset + x / pxPerSec - starts[i];
        const st = clip.start + tl;
        const p = peakBetween(peaks, a.binSeconds, st, st + secPerPx);
        const h = Math.max(1, p * half);
        g.fillRect(x, mid - h, 1, h * 2);
      }
    }
    g.globalAlpha = 1;
  });

  // 字幕などの段
  a.lanes.forEach((lane, li) => {
    const y = RULER_H + HEADER_H + TRACK_H + li * LANE_H + 2;
    g.fillStyle = colors.laneBg;
    g.fillRect(0, y, width, LANE_H - 2);
    g.font = '12px system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (const item of lane.items) {
      const draft = a.laneDraft?.key === item.key ? a.laneDraft : null;
      const x0 = xOf(draft?.from ?? item.from);
      const x1 = xOf(draft?.to ?? item.to);
      if (x1 < 0 || x0 > width) continue;
      const w = Math.max(2, x1 - x0 - 1);
      const selected = lane.selectedId === item.id;
      g.fillStyle = selected ? colors.accent : colors.laneItem;
      roundRect(g, x0, y + 2, w, LANE_H - 6, 4);
      g.fill();
      if (w > 16) {
        g.save();
        g.beginPath();
        g.rect(x0 + 3, y, w - 6, LANE_H);
        g.clip();
        g.fillStyle = selected ? colors.accentText : colors.text;
        g.textAlign = 'left';
        g.fillText(item.text.replace(/\n/g, ' '), x0 + 5, y + LANE_H / 2 - 1);
        g.restore();
      }
    }
    // 段の名前（左端）
    g.fillStyle = colors.muted;
    g.textAlign = 'right';
    g.fillText(lane.label, width - 6, y + LANE_H / 2 - 1);
  });

  // フェードを入れたつなぎ目（明るさが下がって上がる山の形）
  for (const t of a.joinMarks) {
    const x = xOf(t);
    if (x < -10 || x > width + 10) continue;
    g.fillStyle = colors.accent;
    g.beginPath();
    g.moveTo(x - 9, trackTop + 2);
    g.lineTo(x, trackTop + 14);
    g.lineTo(x + 9, trackTop + 2);
    g.closePath();
    g.fill();
    g.fillRect(x - 1, trackTop, 2, TRACK_H);
  }

  // 並べ替えの落とす位置
  if (a.dropAt !== null && a.dragIndex !== null) {
    const order = project.clips.map((_, i) => i).filter((i) => i !== a.dragIndex);
    const before = order[a.dropAt];
    const t = before === undefined ? a.total : starts[before];
    const x = clamp(Math.round(xOf(t)), 3, width - 3);
    g.fillStyle = colors.accent;
    g.fillRect(x - 3, top, 6, HEADER_H + TRACK_H);
    g.beginPath();
    g.moveTo(x - 9, top);
    g.lineTo(x + 9, top);
    g.lineTo(x, top + 10);
    g.closePath();
    g.fill();
  }

  // 切る候補などの印
  for (const m of a.marks) {
    const x0 = xOf(m.from);
    const x1 = xOf(m.to);
    if (x1 < 0 || x0 > width) continue;
    const w = Math.max(2, x1 - x0);
    if (m.kept) {
      g.save();
      g.strokeStyle = colors.muted;
      g.setLineDash([4, 3]);
      g.lineWidth = 1.5;
      g.strokeRect(x0 + 0.5, trackTop + 1.5, w - 1, TRACK_H - 3);
      g.restore();
    } else {
      g.fillStyle = colors.cut;
      g.fillRect(x0, trackTop, w, TRACK_H);
      g.fillStyle = colors.cutLine;
      g.fillRect(x0, trackTop, w, 3);
      g.fillRect(x0, trackTop + TRACK_H - 3, w, 3);
    }
  }

  // なぞった範囲
  if (a.selection) {
    const x0 = xOf(a.selection[0]);
    const x1 = xOf(a.selection[1]);
    g.fillStyle = colors.accentSoft;
    g.fillRect(x0, top, x1 - x0, HEADER_H + TRACK_H);
    g.fillStyle = colors.accent;
    g.fillRect(x0 - 1, top, 2, HEADER_H + TRACK_H);
    g.fillRect(x1 - 1, top, 2, HEADER_H + TRACK_H);
  }

  // 再生位置
  const px = Math.round(xOf(a.time));
  if (px >= -6 && px <= width + 6) {
    g.fillStyle = colors.accent;
    g.fillRect(px - 1, 0, 2, HEIGHT);
    g.beginPath();
    g.moveTo(px - 7, 0);
    g.lineTo(px + 7, 0);
    g.lineTo(px, 9);
    g.closePath();
    g.fill();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.roundRect(x, y, w, h, rr);
}
