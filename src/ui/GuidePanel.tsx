// 「いまやること」の案内と、そのためのボタン
import type { GuideMessage } from '../core/guide';
import type { Project, SourceInfo } from '../core/project';
import { formatLength } from '../core/time';
import { codecLabel } from '../media/probe';
import { Icon } from './icons';

interface Props {
  message: GuideMessage;
  project: Project;
  hasSelection: boolean;
  missing: SourceInfo[];
  /** 許可をもらえば開ける録画の数 */
  needPermission: number;
  onPick(): void;
  onAllow(): void;
  onLocate(): void;
  onDelete(): void;
  onClearSelection(): void;
  onNext(): void;
}

export function GuidePanel(p: Props) {
  const hasClips = p.project.clips.length > 0;
  const missingIds = new Set(p.missing.map((s) => s.id));
  const multiAudio = p.project.sources.some((s) => s.audioTrackCount > 1);
  return (
    <div class="guide" aria-live="polite">
      <h2>{p.message.title}</h2>
      <p>{p.message.detail}</p>
      <div class="actions">
        {p.missing.length > 0 ? (
          <>
            {p.needPermission > 0 && (
              <button class="btn primary big" onClick={p.onAllow}>
                録画を開く許可を出す
              </button>
            )}
            <button class={`btn ${p.needPermission > 0 ? '' : 'primary big'}`} onClick={p.onLocate}>
              <Icon name="open" />
              録画を選び直す
            </button>
          </>
        ) : !hasClips ? (
          <button class="btn primary big" onClick={p.onPick}>
            <Icon name="film" />
            録画を選ぶ
          </button>
        ) : p.hasSelection ? (
          <>
            <button class="btn primary big" onClick={p.onDelete} title="なぞった範囲を消す（Delete）">
              <Icon name="trash" />
              消す
            </button>
            <button class="btn" onClick={p.onClearSelection} title="やめる（Esc）">
              やめる
            </button>
          </>
        ) : (
          <>
            <button class="btn primary big" onClick={p.onNext}>
              次へ：書き出し
              <Icon name="next" />
            </button>
            <button class="btn" onClick={p.onPick}>
              <Icon name="add" />
              録画を足す
            </button>
          </>
        )}
      </div>
      {p.project.sources.length > 0 && (
        <>
          <div class="section-title">入っている録画</div>
          <ul class="source-list">
            {p.project.sources.map((s) => (
              <li key={s.id} class={missingIds.has(s.id) ? 'missing' : ''}>
                <div class="name" title={s.name}>
                  {s.name}
                </div>
                <div class="meta">
                  {missingIds.has(s.id)
                    ? '開けません（場所が変わったか、許可が必要です）'
                    : `${formatLength(s.endTime - s.startTime)}・${s.width}×${s.height}・1秒あたり${s.frameRate}コマ・${codecLabel(s.videoCodec)}${s.audioTrackCount > 1 ? `・音が${s.audioTrackCount}つ` : s.audioTrackCount === 0 ? '・音なし' : ''}`}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {multiAudio && (
        <p class="note">
          音が複数入っている録画は、いまは1つ目の音だけを使います。「自分の声」と「ゲームの音」を選べるようにするのは次の版（v0.2）です。
        </p>
      )}
      {hasClips && (
        <p class="note">
          <kbd>スペース</kbd> で再生・一時停止、<kbd>←</kbd> <kbd>→</kbd> で1秒ずつ動かせます。<kbd>?</kbd> でキーの一覧を出せます。
        </p>
      )}
      {!hasClips && (
        <p class="note">録画はこのパソコンの中だけで使います。インターネットには送りません。</p>
      )}
    </div>
  );
}
