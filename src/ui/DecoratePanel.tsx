// 飾りの手順。画像・矢印や枠・拡大・速さ・つなぎ目のフェード（v0.5〜v0.6）
import type { Asset, Project, ShapeOverlay } from '../core/project';
import { formatClock } from '../core/time';
import { SPEEDS } from '../core/timeline';
import { IMAGE_PLACES, NEW_IMAGE_SECONDS, type ImagePlace } from '../data/images';
import { ARROW_DIRECTIONS, NEW_SHAPE_SECONDS, SHAPE_COLORS, SHAPE_KINDS, SHAPE_THICKNESS, type ShapeKind, type ShapePlace } from '../data/shapes';
import { NEW_ZOOM_SECONDS, ZOOM_FACTORS } from '../data/zoom';
import { Icon } from './icons';

export type DecorateTab = 'image' | 'shape' | 'zoom' | 'speed' | 'fade';

export const DECORATE_TABS: readonly { value: DecorateTab; label: string }[] = [
  { value: 'image', label: '画像' },
  { value: 'shape', label: '矢印・枠' },
  { value: 'zoom', label: '拡大' },
  { value: 'speed', label: '速さ' },
  { value: 'fade', label: 'フェード' },
];

/** 選んでいるもの */
export type Selected = { kind: 'image' | 'shape' | 'zoom'; id: string };

export interface ListItem {
  id: string;
  key: string;
  from: number;
  to: number;
  name: string;
}

interface Props {
  project: Project;
  tab: DecorateTab;
  selected: Selected | null;
  /** なぞった範囲 */
  selection: [number, number] | null;
  images: ListItem[];
  shapes: ListItem[];
  zooms: ListItem[];
  /** いまの再生位置に一番近いつなぎ目 */
  join: { clipId: string; index: number; time: number } | null;
  /** いまの再生位置の速さ */
  speed: number;
  onTab(tab: DecorateTab): void;
  onSelect(selected: Selected | null): void;
  onAddImage(): void;
  onImagePlace(id: string, place: Exclude<ImagePlace, 'free'>): void;
  onAddShape(kind: ShapeKind): void;
  onShapeStyle(id: string, style: Partial<Pick<ShapeOverlay, 'color' | 'thickness' | 'direction'>>): void;
  onShapePlace(id: string, place: ShapePlace): void;
  onAddZoom(): void;
  onZoomFactor(id: string, factor: number): void;
  /** なぞった範囲に、出す時間を変える */
  onUseSelection(selected: Selected): void;
  onRemove(selected: Selected): void;
  onSpeed(speed: number): void;
  onToggleJoin(clipId: string): void;
  onFadeSourceChanges(): void;
  onEndFade(on: boolean): void;
  onNext(): void;
}

const SHAPE_PLACE_LABELS: Record<ShapePlace, string> = {
  'top-left': '左上',
  'top-right': '右上',
  center: '中央',
  'bottom-left': '左下',
  'bottom-right': '右下',
};

function placeLabel(place: ImagePlace): string {
  return IMAGE_PLACES.find((p) => p.value === place)?.label ?? '自由な位置';
}

/** なぞった範囲があればそれを、なければ再生位置から何秒かを使う、という説明 */
function rangeHint(selection: [number, number] | null, seconds: number, what: string): string {
  return selection
    ? `なぞった範囲（${formatClock(selection[1] - selection[0], true)}）に${what}。`
    : `タイムラインで範囲をなぞると、その間だけ${what}。なぞらなければ、再生位置から${seconds}秒です。`;
}

export function DecoratePanel(p: Props) {
  return (
    <div class="guide decorate-panel" aria-live="polite">
      <h2>画像や演出を入れましょう</h2>
      <p>使わなくてもかまいません。入れないときは、そのまま次へ進みましょう。</p>
      <div class="tabs" role="tablist" aria-label="飾りの種類">
        {DECORATE_TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={p.tab === t.value} class={p.tab === t.value ? 'on' : ''} onClick={() => p.onTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {p.tab === 'image' && <ImageTab {...p} />}
      {p.tab === 'shape' && <ShapeTab {...p} />}
      {p.tab === 'zoom' && <ZoomTab {...p} />}
      {p.tab === 'speed' && <SpeedTab {...p} />}
      {p.tab === 'fade' && <FadeTab {...p} />}
      <div class="actions sticky">
        <button class="btn primary big" onClick={p.onNext}>
          次へ：BGM・効果音
          <Icon name="next" />
        </button>
      </div>
    </div>
  );
}

function ItemList(p: { items: ListItem[]; kind: Selected['kind']; selected: Selected | null; label: string; onSelect(s: Selected): void; onRemove(s: Selected): void }) {
  if (p.items.length === 0) return null;
  return (
    <ul class="item-list" aria-label={p.label}>
      {p.items.map((item) => {
        const on = p.selected?.kind === p.kind && p.selected.id === item.id;
        return (
          <li key={item.key} class={on ? 'on' : ''}>
            <button class="item-main" onClick={() => p.onSelect({ kind: p.kind, id: item.id })} title="選んで、直す">
              <span class="item-time">{formatClock(item.from)}</span>
              <span class="item-name">{item.name}</span>
            </button>
            <button class="btn icon ghost" title="外す" aria-label={`${item.name}を外す`} onClick={() => p.onRemove({ kind: p.kind, id: item.id })}>
              <Icon name="trash" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TimeButtons(p: Props & { target: Selected }) {
  return (
    <div class="actions">
      {p.selection && (
        <button class="btn small" onClick={() => p.onUseSelection(p.target)}>
          なぞった範囲に出す時間を変える
        </button>
      )}
      <button class="btn small ghost" onClick={() => p.onSelect(null)}>
        選ぶのをやめる
      </button>
    </div>
  );
}

function ImageTab(p: Props) {
  const image = p.selected?.kind === 'image' ? p.project.images.find((i) => i.id === p.selected!.id) : undefined;
  const asset: Asset | undefined = image ? p.project.assets.find((a) => a.id === image.assetId) : undefined;
  return (
    <>
      <p class="hint-text">{rangeHint(p.selection, NEW_IMAGE_SECONDS, '画像を出せます')}</p>
      <div class="actions">
        <button class="btn primary" onClick={p.onAddImage}>
          <Icon name="image" />
          画像を置く
        </button>
      </div>
      <ItemList items={p.images} kind="image" selected={p.selected} label="置いた画像" onSelect={p.onSelect} onRemove={p.onRemove} />
      {image && (
        <div class="item-settings">
          <div class="style-row">
            <span class="section-title">置き方</span>
            <div class="segmented" role="radiogroup" aria-label="画像の置き方">
              {IMAGE_PLACES.map((place) => (
                <button
                  key={place.value}
                  role="radio"
                  aria-checked={image.place === place.value}
                  class={image.place === place.value ? 'on' : ''}
                  onClick={() => p.onImagePlace(image.id, place.value)}
                >
                  {place.label}
                </button>
              ))}
            </div>
          </div>
          <p class="hint-text">
            いま：{placeLabel(image.place)}。プレビューの上で画像をドラッグすると動かせます。右下の角をドラッグすると大きさを変えられます。
            {asset && `（${asset.width}×${asset.height}）`}
          </p>
          <TimeButtons {...p} target={{ kind: 'image', id: image.id }} />
        </div>
      )}
    </>
  );
}

function ShapeTab(p: Props) {
  const shape = p.selected?.kind === 'shape' ? p.project.shapes.find((s) => s.id === p.selected!.id) : undefined;
  return (
    <>
      <p class="hint-text">{rangeHint(p.selection, NEW_SHAPE_SECONDS, '矢印や枠を出せます')}</p>
      <div class="actions">
        {SHAPE_KINDS.map((k) => (
          <button key={k.value} class="btn" onClick={() => p.onAddShape(k.value)}>
            <span class={`shape-mark ${k.value}`} aria-hidden="true" />
            {k.label}を置く
          </button>
        ))}
      </div>
      <ItemList items={p.shapes} kind="shape" selected={p.selected} label="置いた矢印・枠" onSelect={p.onSelect} onRemove={p.onRemove} />
      {shape && (
        <div class="item-settings">
          <div class="style-row">
            <span class="section-title">色</span>
            <div class="swatches" role="radiogroup" aria-label="図形の色">
              {SHAPE_COLORS.map((c) => (
                <button
                  key={c.value}
                  role="radio"
                  aria-checked={shape.color === c.value}
                  aria-label={c.label}
                  title={c.label}
                  class={`swatch ${shape.color === c.value ? 'on' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => p.onShapeStyle(shape.id, { color: c.value })}
                />
              ))}
            </div>
          </div>
          <div class="style-row">
            <span class="section-title">線の太さ</span>
            <div class="segmented" role="radiogroup" aria-label="線の太さ">
              {SHAPE_THICKNESS.map((t) => (
                <button key={t.value} role="radio" aria-checked={shape.thickness === t.value} class={shape.thickness === t.value ? 'on' : ''} onClick={() => p.onShapeStyle(shape.id, { thickness: t.value })}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {shape.kind === 'arrow' && (
            <div class="style-row">
              <span class="section-title">向き</span>
              <div class="segmented arrows" role="radiogroup" aria-label="矢印の向き">
                {ARROW_DIRECTIONS.map((d) => (
                  <button
                    key={d.value}
                    role="radio"
                    aria-checked={shape.direction === d.value}
                    aria-label={d.label}
                    title={d.label}
                    class={shape.direction === d.value ? 'on' : ''}
                    onClick={() => p.onShapeStyle(shape.id, { direction: d.value })}
                  >
                    {d.mark}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div class="style-row">
            <span class="section-title">置き場所</span>
            <div class="segmented" role="group" aria-label="図形の置き場所">
              {(Object.keys(SHAPE_PLACE_LABELS) as ShapePlace[]).map((place) => (
                <button key={place} onClick={() => p.onShapePlace(shape.id, place)}>
                  {SHAPE_PLACE_LABELS[place]}
                </button>
              ))}
            </div>
          </div>
          <p class="hint-text">プレビューの上でドラッグすると動かせます。右下の角をドラッグすると大きさを変えられます。</p>
          <TimeButtons {...p} target={{ kind: 'shape', id: shape.id }} />
        </div>
      )}
    </>
  );
}

function ZoomTab(p: Props) {
  const zoom = p.selected?.kind === 'zoom' ? p.project.zooms.find((z) => z.id === p.selected!.id) : undefined;
  return (
    <>
      <p class="hint-text">{rangeHint(p.selection, NEW_ZOOM_SECONDS, '画面の一部を大きく見せられます')}寄るときと戻るときは、自動でなめらかに動きます。</p>
      <div class="actions">
        <button class="btn primary" onClick={p.onAddZoom}>
          <Icon name="plus" />
          拡大を入れる
        </button>
      </div>
      <ItemList items={p.zooms} kind="zoom" selected={p.selected} label="入れた拡大" onSelect={p.onSelect} onRemove={p.onRemove} />
      {zoom && (
        <div class="item-settings">
          <p class="hint-text">
            プレビューの点線の四角が、大きく見せる場所です。ドラッグで動かし、右下の角で大きさを変えてください（選んでいる間は、拡大する前の画面を見せます）。
          </p>
          <div class="style-row">
            <span class="section-title">大きさ</span>
            <div class="segmented" role="radiogroup" aria-label="拡大の大きさ">
              {ZOOM_FACTORS.map((f) => (
                <button key={f} role="radio" aria-checked={Math.abs(1 / zoom.w - f) < 0.01} class={Math.abs(1 / zoom.w - f) < 0.01 ? 'on' : ''} onClick={() => p.onZoomFactor(zoom.id, f)}>
                  {f}倍
                </button>
              ))}
            </div>
            <span class="hint-text">いま：{(1 / zoom.w).toFixed(1)}倍</span>
          </div>
          <TimeButtons {...p} target={{ kind: 'zoom', id: zoom.id }} />
        </div>
      )}
    </>
  );
}

function SpeedTab(p: Props) {
  return (
    <>
      <p class="hint-text">
        タイムラインで範囲をなぞってから、速さを選んでください。速くしても、声の高さは変わりません。字幕や画像の時間も、速さに合わせて自動で変わります。
      </p>
      <div class="segmented" role="group" aria-label="速さ">
        {SPEEDS.map((s) => (
          <button key={s} disabled={!p.selection} onClick={() => p.onSpeed(s)} title={p.selection ? undefined : '先にタイムラインで範囲をなぞってください'}>
            {s === 1 ? '元の速さ' : `${s}倍`}
          </button>
        ))}
      </div>
      <p class="hint-text">
        {p.selection ? `なぞった範囲：${formatClock(p.selection[1] - p.selection[0], true)}` : 'まだ範囲をなぞっていません。'}
        ／いまの再生位置の速さ：{p.speed === 1 ? '元の速さ' : `${p.speed}倍`}
      </p>
    </>
  );
}

function FadeTab(p: Props) {
  const joinFaded = p.join ? p.project.joinFades.includes(p.join.clipId) : false;
  const multiSource = p.project.clips.some((c, i) => i > 0 && p.project.clips[i - 1].sourceId !== c.sourceId);
  return (
    <>
      <p class="hint-text">つなぎ目で画面を一度暗くして、場面が変わったことを分かりやすくします。音も同じように小さくなります。</p>
      {p.join && (
        <label class="check">
          <input type="checkbox" checked={joinFaded} onChange={() => p.onToggleJoin(p.join!.clipId)} />
          {p.join.index === 0 ? '動画の始まりをフェードで明るくする' : `${formatClock(p.join.time)} のつなぎ目をフェードにする（再生位置に一番近いつなぎ目）`}
        </label>
      )}
      <label class="check">
        <input type="checkbox" checked={p.project.endFade} onChange={(e) => p.onEndFade((e.target as HTMLInputElement).checked)} />
        動画の終わりをフェードで暗くする
      </label>
      {multiSource && (
        <div class="actions">
          <button class="btn small" onClick={p.onFadeSourceChanges}>
            <Icon name="fade" />
            録画が切り替わるところ全部にフェードを入れる
          </button>
        </div>
      )}
    </>
  );
}
