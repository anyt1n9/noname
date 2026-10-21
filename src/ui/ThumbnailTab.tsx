// 公開の準備：サムネイル（v0.9）。場面を選び、大きな文字を載せて画像に保存する
import { useState } from 'preact/hooks';
import type { Project } from '../core/project';
import { formatBytes, formatClock } from '../core/time';
import { limitLines, thumbnailFrameOnTimeline, type ThumbnailSetting } from '../core/thumbnail';
import {
  THUMB_ALIGNS,
  THUMB_COLORS,
  THUMB_MAX_LINES,
  THUMB_MOBILE_LIMIT_BYTES,
  THUMB_OUTPUTS,
  THUMB_POSITIONS,
  THUMB_SIZES,
  THUMB_TEMPLATES,
} from '../data/thumbnail';
import { Icon } from './icons';

interface Props {
  project: Project;
  picking: boolean;
  onCreate(): void;
  onChange(setting: ThumbnailSetting): void;
  onPick(on: boolean): void;
  onUseFrame(): void;
  /** 保存する。保存したら大きさ（バイト）、やめたら null */
  onSave(width: number, height: number, type: 'image/png' | 'image/jpeg'): Promise<number | null>;
}

export function ThumbnailTab(p: Props) {
  const s = p.project.thumbnail;
  const [output, setOutput] = useState(0);
  const [type, setType] = useState<'image/png' | 'image/jpeg'>('image/png');
  const [saved, setSaved] = useState<number | null>(null);
  if (!s) {
    return (
      <>
        <p class="hint-text">動画の一場面に大きな文字を載せて、YouTube のサムネイル（{THUMB_OUTPUTS[0].label}）を作ります。</p>
        <div class="actions">
          <button class="btn primary" onClick={p.onCreate}>
            <Icon name="image" />
            いまの場面でサムネイルを作る
          </button>
        </div>
      </>
    );
  }
  const at = thumbnailFrameOnTimeline(p.project, s);
  const set = (change: Partial<ThumbnailSetting>) => {
    setSaved(null);
    p.onChange({ ...s, ...change });
  };
  return (
    <>
      <div class="section-title">場面</div>
      {p.picking ? (
        <>
          <p class="note">タイムラインやキー（← →）で場面を選んで、「この場面にする」を押してください。</p>
          <div class="actions">
            <button class="btn primary" onClick={p.onUseFrame}>
              この場面にする
            </button>
            <button class="btn" onClick={() => p.onPick(false)}>
              やめる
            </button>
          </div>
        </>
      ) : (
        <div class="style-row">
          <span class="hint-text">{at === null ? '選んだ場面は、カットで消えています（場面はそのまま使えます）。' : `${formatClock(at, true)} の場面`}</span>
          <button class="btn small" onClick={() => p.onPick(true)}>
            場面を選び直す
          </button>
        </div>
      )}
      <label class="field">
        <span>載せる文字（{THUMB_MAX_LINES}行まで。短く、大きく）</span>
        <textarea rows={2} value={s.text} onInput={(e) => set({ text: limitLines((e.target as HTMLTextAreaElement).value) })} aria-label="サムネイルの文字" />
      </label>
      <div class="style-row">
        <span class="section-title">見た目</span>
        <div class="segmented" role="radiogroup" aria-label="サムネイルの見た目">
          {THUMB_TEMPLATES.map((t) => (
            <button key={t.value} role="radio" aria-checked={s.template === t.value} class={s.template === t.value ? 'on' : ''} title={t.hint} onClick={() => set({ template: t.value, color: t.color })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div class="style-row">
        <span class="section-title">{s.template === 'pop' ? 'ふちの色' : '文字の色'}</span>
        <div class="swatches" role="radiogroup" aria-label="サムネイルの色">
          {THUMB_COLORS.map((c) => (
            <button
              key={c.value}
              role="radio"
              aria-checked={s.color === c.value}
              aria-label={c.label}
              title={c.label}
              class={`swatch ${s.color === c.value ? 'on' : ''}`}
              style={{ background: c.value }}
              onClick={() => set({ color: c.value })}
            />
          ))}
        </div>
      </div>
      <div class="style-row">
        <span class="section-title">大きさ</span>
        <div class="segmented" role="radiogroup" aria-label="サムネイルの文字の大きさ">
          {THUMB_SIZES.map((z) => (
            <button key={z.value} role="radio" aria-checked={s.size === z.value} class={s.size === z.value ? 'on' : ''} onClick={() => set({ size: z.value })}>
              {z.label}
            </button>
          ))}
        </div>
        <span class="section-title">位置</span>
        <div class="segmented" role="radiogroup" aria-label="サムネイルの文字の位置">
          {THUMB_POSITIONS.map((z) => (
            <button key={z.value} role="radio" aria-checked={s.position === z.value} class={s.position === z.value ? 'on' : ''} onClick={() => set({ position: z.value })}>
              {z.label}
            </button>
          ))}
        </div>
        <div class="segmented" role="radiogroup" aria-label="サムネイルの文字のそろえ方">
          {THUMB_ALIGNS.map((z) => (
            <button key={z.value} role="radio" aria-checked={s.align === z.value} class={s.align === z.value ? 'on' : ''} onClick={() => set({ align: z.value })}>
              {z.label}
            </button>
          ))}
        </div>
      </div>
      <div class="section-title">保存</div>
      <div class="style-row">
        <div class="segmented" role="radiogroup" aria-label="サムネイルの大きさ">
          {THUMB_OUTPUTS.map((o, i) => (
            <button key={o.label} role="radio" aria-checked={output === i} class={output === i ? 'on' : ''} onClick={() => setOutput(i)}>
              {o.label}
            </button>
          ))}
        </div>
        <div class="segmented" role="radiogroup" aria-label="サムネイルの形式">
          <button role="radio" aria-checked={type === 'image/png'} class={type === 'image/png' ? 'on' : ''} onClick={() => setType('image/png')}>
            PNG
          </button>
          <button role="radio" aria-checked={type === 'image/jpeg'} class={type === 'image/jpeg' ? 'on' : ''} onClick={() => setType('image/jpeg')}>
            JPEG（小さめ）
          </button>
        </div>
      </div>
      <div class="actions">
        <button
          class="btn primary"
          onClick={async () => {
            const o = THUMB_OUTPUTS[output];
            setSaved(await p.onSave(o.width, o.height, type));
          }}
        >
          <Icon name="save" />
          サムネイルを保存
        </button>
      </div>
      {saved !== null && (
        <p class={`note ${saved > THUMB_MOBILE_LIMIT_BYTES ? 'warn' : ''}`}>
          保存しました（{formatBytes(saved)}）。YouTube Studio の動画の詳細の「サムネイル」から上げられます。
          {saved > THUMB_MOBILE_LIMIT_BYTES && ' スマホのアプリから上げるときは 2MB までなので、パソコンから上げるか、JPEG で保存し直してください。'}
        </p>
      )}
      <p class="hint-text">サムネイルも YouTube のコミュニティ ガイドラインの対象です。動画の内容と合わない、大げさな画像にしないようにしましょう。</p>
    </>
  );
}
