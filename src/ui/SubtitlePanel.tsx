// 字幕の手順。自動で作る → 一覧で直す → 見た目を選ぶ
import { useEffect, useRef, useState } from 'preact/hooks';
import { textLength } from '../core/captions';
import type { Project } from '../core/project';
import type { TimelineSubtitle } from '../core/subtitles';
import { formatBytes, formatClock, formatLength } from '../core/time';
import { MODEL_HOST, WHISPER_MODELS, type ModelId, type WhisperModel } from '../data/models';
import { MAX_LINE } from '../core/captions';
import { SUBTITLE_COLORS, SUBTITLE_POSITIONS, SUBTITLE_SIZES, type SubtitleStyle } from '../data/subtitle-style';
import { Icon } from './icons';

export type TranscribePhase =
  | { kind: 'idle' }
  | { kind: 'consent'; model: WhisperModel; bytes: number | null }
  | { kind: 'loading'; progress: number; loaded: number; total: number }
  | { kind: 'running'; done: number; total: number; startedAt: number }
  | { kind: 'error'; message: string; whileLoading: boolean };

interface Props {
  project: Project;
  items: TimelineSubtitle[];
  /** いま出ている字幕の ID */
  currentId: string | null;
  phase: TranscribePhase;
  modelId: ModelId;
  /** その AI が、このパソコンで使えるか */
  usable: (id: ModelId) => boolean;
  /** まだ文字起こししていない部分があるか（秒） */
  remaining: number;
  analysisReady: boolean;
  analysisProgress: number;
  onModel(id: ModelId): void;
  onTranscribe(): void;
  onConsent(): void;
  onCancelConsent(): void;
  onCancel(): void;
  onSeek(t: number): void;
  onText(id: string, text: string): void;
  onSplit(id: string, at: number): void;
  onMerge(id: string): void;
  onRemove(id: string): void;
  onAdd(): void;
  onStyle(style: SubtitleStyle): void;
  onExportSrt(): void;
  onImportSrt(): void;
  onNext(): void;
}

function SubtitleRow(p: {
  item: TimelineSubtitle;
  current: boolean;
  onSeek(): void;
  onText(text: string): void;
  onSplit(at: number): void;
  onMerge(): void;
  onRemove(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.item.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!editing) setDraft(p.item.text);
  }, [p.item.text, editing]);
  useEffect(() => {
    if (p.current && !editing) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [p.current]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== p.item.text) p.onText(draft);
  };
  const lines = draft.split('\n');
  const tooLong = lines.some((l) => textLength(l) > MAX_LINE) || lines.length > 2;
  return (
    <li ref={rowRef} class={`sub-row ${p.current ? 'current' : ''}`}>
      <button class="sub-time" onClick={p.onSeek} title="この場面へ移動">
        {formatClock(p.item.from)}
      </button>
      {editing ? (
        <div class="sub-edit">
          <textarea
            ref={ref}
            rows={2}
            value={draft}
            aria-label="字幕の文字"
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
              if (e.key === 'Escape') {
                setDraft(p.item.text);
                setEditing(false);
              }
            }}
          />
          <div class="sub-tools">
            <span class={`sub-count ${tooLong ? 'warn' : ''}`}>{lines.map((l) => textLength(l)).join(' / ')}文字（1行20文字・2行まで）</span>
            <button
              class="btn small"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const at = ref.current ? textLength(draft.slice(0, ref.current.selectionStart)) : 0;
                setEditing(false);
                if (draft !== p.item.text) p.onText(draft);
                p.onSplit(at);
              }}
              title="文字を入れる位置（カーソル）で2つに分ける"
            >
              ここで分ける
            </button>
          </div>
        </div>
      ) : (
        <button class="sub-text" onClick={() => (p.onSeek(), setEditing(true))} title="押すと書き換えられます">
          {p.item.text.split('\n').map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </button>
      )}
      <div class="sub-actions">
        <button class="btn icon ghost" title="後ろの字幕とつなぐ" aria-label="後ろの字幕とつなぐ" onClick={p.onMerge}>
          <Icon name="join" />
        </button>
        <button class="btn icon ghost" title="この字幕だけを消す（動画はそのまま）" aria-label="この字幕を消す" onClick={p.onRemove}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}

export function SubtitlePanel(p: Props) {
  const { phase } = p;
  const style = p.project.subtitleStyle;
  const has = p.project.subtitles.length > 0;

  if (phase.kind === 'consent') {
    return (
      <div class="guide">
        <h2>AI の部品をダウンロードします</h2>
        <p>
          声を字幕にする AI（{phase.model.label}）の部品を、配布元の Hugging Face（{MODEL_HOST}）からダウンロードします。大きさは
          <strong>{phase.bytes ? `約${formatBytes(phase.bytes)}` : `約${phase.model.approxMB >= 1000 ? `${(phase.model.approxMB / 1000).toFixed(1)}GB` : `${phase.model.approxMB}MB`}（目安）`}</strong>
          です。
        </p>
        <ul class="steps-list">
          <li>ダウンロードは最初の1回だけです。次からは、このブラウザの中に残ったものを使います。</li>
          <li>ダウンロードのとき、あなたのパソコンの接続元の情報（IP アドレス）が配布元に伝わります。</li>
          <li>録画や声はインターネットに送りません。字幕づくりは、このパソコンの中で行います。</li>
        </ul>
        <div class="actions sticky">
          <button class="btn primary big" onClick={p.onConsent}>
            ダウンロードして始める
          </button>
          <button class="btn" onClick={p.onCancelConsent}>
            やめる
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'loading' || phase.kind === 'running') {
    const progress = phase.kind === 'loading' ? phase.progress : phase.total > 0 ? phase.done / phase.total : 0;
    const elapsed = phase.kind === 'running' ? (Date.now() - phase.startedAt) / 1000 : 0;
    const remain = phase.kind === 'running' && phase.done > 0 ? (elapsed / phase.done) * (phase.total - phase.done) : null;
    return (
      <div class="guide" aria-live="polite">
        <h2>{phase.kind === 'loading' ? 'AI の部品を読み込んでいます…' : '声を字幕にしています…'}</h2>
        <div class="progress">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
        <p>
          {phase.kind === 'loading'
            ? phase.total > 0
              ? `${formatBytes(phase.loaded)} / ${formatBytes(phase.total)}`
              : '準備しています…'
            : `${phase.done} / ${phase.total} のまとまり${remain !== null ? `（あと約${formatLength(remain)}）` : ''}`}
        </p>
        <p class="note">できた字幕から順にタイムラインに出ます。やめても、作った字幕は残り、続きから再開できます。</p>
        <div class="actions sticky">
          <button class="btn" onClick={p.onCancel}>
            やめる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="guide subtitle-panel">
      <h2>{has ? '字幕を直しましょう' : '声を字幕にしましょう'}</h2>
      {phase.kind === 'error' && (
        <p class="note warn">
          {phase.whileLoading
            ? 'AI の部品をダウンロードできませんでした。インターネットにつながっているか確かめて、もう一度試してください。'
            : '字幕を作れませんでした。もう一度試すか、「軽いモード」を選んでください。'}
          <br />
          （くわしい理由：{phase.message}）
        </p>
      )}
      {!has ? (
        <>
          <p>あなたの声を AI が聞き取って、自動で字幕にします。録画はインターネットに送りません。</p>
          <div class="model-choice" role="radiogroup" aria-label="AI の種類">
            {WHISPER_MODELS.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={p.modelId === m.id}
                class={`quality ${p.modelId === m.id ? 'selected' : ''}`}
                disabled={!p.usable(m.id)}
                onClick={() => p.onModel(m.id)}
              >
                <span class="dot" />
                <span>
                  <span class="label">{m.label}</span>
                  <span class="desc">{p.usable(m.id) ? m.description : 'このパソコンでは使えません（グラフィックボードが必要です）'}</span>
                </span>
              </button>
            ))}
          </div>
          {!p.analysisReady && <p class="note">録画の音を調べています… {Math.floor(p.analysisProgress * 100)}%（終わると、しゃべっている部分だけを字幕にできます）</p>}
          <div class="actions">
            <button class="btn primary big" onClick={p.onTranscribe} disabled={!p.analysisReady}>
              自動で字幕を作る
            </button>
            <button class="btn" onClick={p.onImportSrt} title="ほかのソフトで作った字幕ファイルを使う">
              字幕ファイル（.srt）を読み込む
            </button>
          </div>
        </>
      ) : p.remaining > 0 ? (
        <div class="actions">
          <button class="btn small" onClick={p.onTranscribe} disabled={!p.analysisReady} title="まだ字幕がない部分を、AI で字幕にする">
            残り{formatLength(p.remaining)}を AI で字幕にする
          </button>
        </div>
      ) : null}
      {has && (
        <>
          <div class="style-row">
            <span class="section-title">見た目</span>
            <div class="swatches" role="radiogroup" aria-label="字幕の色">
              {SUBTITLE_COLORS.map((c) => (
                <button
                  key={c.value}
                  role="radio"
                  aria-checked={style.color === c.value}
                  aria-label={c.label}
                  title={c.label}
                  class={`swatch ${style.color === c.value ? 'on' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => p.onStyle({ ...style, color: c.value })}
                />
              ))}
            </div>
            <div class="segmented" role="radiogroup" aria-label="字幕の大きさ">
              {SUBTITLE_SIZES.map((s) => (
                <button key={s.value} role="radio" aria-checked={style.size === s.value} class={style.size === s.value ? 'on' : ''} onClick={() => p.onStyle({ ...style, size: s.value })}>
                  {s.label}
                </button>
              ))}
            </div>
            <div class="segmented" role="radiogroup" aria-label="字幕の位置">
              {SUBTITLE_POSITIONS.map((s) => (
                <button key={s.value} role="radio" aria-checked={style.position === s.value} class={style.position === s.value ? 'on' : ''} onClick={() => p.onStyle({ ...style, position: s.value })}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div class="section-title">字幕の一覧（{p.items.length}）— 押すと書き換えられます</div>
          <ul class="sub-list">
            {p.items.map((item) => (
              <SubtitleRow
                key={item.key}
                item={item}
                current={item.id === p.currentId}
                onSeek={() => p.onSeek(item.from + 0.01)}
                onText={(t) => p.onText(item.id, t)}
                onSplit={(at) => p.onSplit(item.id, at)}
                onMerge={() => p.onMerge(item.id)}
                onRemove={() => p.onRemove(item.id)}
              />
            ))}
          </ul>
          <div class="actions">
            <button class="btn small" onClick={p.onAdd} title="再生位置に字幕を足す">
              <Icon name="add" />
              再生位置に字幕を足す
            </button>
            <button class="btn small" onClick={p.onExportSrt} title="YouTube の字幕機能で使えるファイル">
              字幕ファイル（.srt）を書き出す
            </button>
          </div>
        </>
      )}
      <div class="actions sticky">
        <button class="btn primary big" onClick={p.onNext}>
          {has ? '次へ：書き出し' : '字幕なしで次へ'}
          <Icon name="next" />
        </button>
      </div>
    </div>
  );
}
