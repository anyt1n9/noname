// 飾りの手順（v0.5）。画像を置く・つなぎ目のフェード
import type { Asset, ImageOverlay, Project } from '../core/project';
import { formatClock } from '../core/time';
import { IMAGE_PLACES, NEW_IMAGE_SECONDS, type ImagePlace } from '../data/images';
import { Icon } from './icons';

interface Props {
  project: Project;
  /** タイムラインに見えている画像 */
  items: { id: string; key: string; from: number; to: number; name: string }[];
  selectedId: string | null;
  /** なぞった範囲（画像を出す時間） */
  selection: [number, number] | null;
  /** いまの再生位置に一番近いつなぎ目 */
  join: { clipId: string; index: number; time: number } | null;
  onAddImage(): void;
  onSelect(id: string | null): void;
  onPlace(id: string, place: Exclude<ImagePlace, 'free'>): void;
  onUseSelection(id: string): void;
  onRemove(id: string): void;
  onSeek(t: number): void;
  onToggleJoin(clipId: string): void;
  onFadeSourceChanges(): void;
  onEndFade(on: boolean): void;
  onNext(): void;
}

function placeLabel(place: ImagePlace): string {
  return IMAGE_PLACES.find((p) => p.value === place)?.label ?? '自由な位置';
}

export function DecoratePanel(p: Props) {
  const selected = p.project.images.find((i) => i.id === p.selectedId) ?? null;
  const asset = selected ? p.project.assets.find((a) => a.id === selected.assetId) : undefined;
  const joinFaded = p.join ? p.project.joinFades.includes(p.join.clipId) : false;
  const multiSource = p.project.clips.some((c, i) => i > 0 && p.project.clips[i - 1].sourceId !== c.sourceId);
  return (
    <div class="guide decorate-panel" aria-live="polite">
      <h2>画像や演出を入れましょう</h2>
      <p>使わなくてもかまいません。入れないときは、そのまま次へ進みましょう。</p>

      <div class="section-title">画像</div>
      <p class="hint-text">
        {p.selection
          ? `なぞった範囲（${formatClock(p.selection[1] - p.selection[0], true)}）に画像を出します。`
          : `タイムラインで範囲をなぞると、その間だけ画像を出せます。なぞらなければ、再生位置から${NEW_IMAGE_SECONDS}秒出します。`}
      </p>
      <div class="actions">
        <button class="btn primary" onClick={p.onAddImage}>
          <Icon name="image" />
          画像を置く
        </button>
      </div>
      {p.items.length > 0 && (
        <ul class="item-list" aria-label="置いた画像">
          {p.items.map((item) => (
            <li key={item.key} class={item.id === p.selectedId ? 'on' : ''}>
              <button class="item-main" onClick={() => p.onSelect(item.id)} title="選んで、置き方を変える">
                <span class="item-time">{formatClock(item.from)}</span>
                <span class="item-name">{item.name}</span>
              </button>
              <button class="btn icon ghost" title="この画像を外す" aria-label={`${item.name}を外す`} onClick={() => p.onRemove(item.id)}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <ImageSettings {...p} image={selected} asset={asset} />}

      <div class="section-title">つなぎ目のフェード</div>
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
      <div class="actions sticky">
        <button class="btn primary big" onClick={p.onNext}>
          次へ：BGM・効果音
          <Icon name="next" />
        </button>
      </div>
    </div>
  );
}

function ImageSettings(p: Props & { image: ImageOverlay; asset: Asset | undefined }) {
  const { image } = p;
  return (
    <div class="item-settings">
      <div class="style-row">
        <span class="section-title">置き方</span>
        <div class="segmented" role="radiogroup" aria-label="画像の置き方">
          {IMAGE_PLACES.map((place) => (
            <button key={place.value} role="radio" aria-checked={image.place === place.value} class={image.place === place.value ? 'on' : ''} onClick={() => p.onPlace(image.id, place.value)}>
              {place.label}
            </button>
          ))}
        </div>
      </div>
      <p class="hint-text">
        いま：{placeLabel(image.place)}。プレビューの上で画像をドラッグすると動かせます。右下の角をドラッグすると大きさを変えられます。
        {p.asset && `（${p.asset.width}×${p.asset.height}）`}
      </p>
      <div class="actions">
        {p.selection && (
          <button class="btn small" onClick={() => p.onUseSelection(image.id)}>
            なぞった範囲に出す時間を変える
          </button>
        )}
        <button class="btn small ghost" onClick={() => p.onSelect(null)}>
          選ぶのをやめる
        </button>
      </div>
    </div>
  );
}
