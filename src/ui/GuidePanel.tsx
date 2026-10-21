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
  nextLabel: string;
  onAudioSettings(sourceId: string): void;
  /** 見本の録画で練習する（v1.0） */
  onPractice(): void;
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
          <>
            <button class="btn primary big" onClick={p.onPick}>
              <Icon name="film" />
              録画を選ぶ
            </button>
            <button class="btn" onClick={p.onPractice} title="テロッパで作った見本の録画で、1本作る練習をする">
              <Icon name="play" />
              見本の録画で練習する
            </button>
          </>
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
              {p.nextLabel}
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
                <div class="row">
                  <div class="name" title={s.name}>
                    {s.name}
                  </div>
                  {!missingIds.has(s.id) && s.audioTrackCount > 0 && (
                    <button class="btn small" onClick={() => p.onAudioSettings(s.id)} title="声とゲームの音の選び方・大きさ">
                      音の設定
                    </button>
                  )}
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
        <p class="note">音が複数入っている録画は、「音の設定」で「あなたの声」と「ゲームの音など」を選べます。</p>
      )}
      {hasClips && (
        <p class="note">
          <kbd>スペース</kbd> で再生・一時停止、<kbd>←</kbd> <kbd>→</kbd> で1秒ずつ動かせます。<kbd>?</kbd> でキーの一覧を出せます。
        </p>
      )}
      {!hasClips && (
        <>
          <p class="note">録画はこのパソコンの中だけで使います。インターネットには送りません。</p>
          <p class="hint-text">初めての人は「見本の録画で練習する」がおすすめです。見本はテロッパが作る短い録画（約45秒）で、読み込みから書き出しまでを試せます。とばしてもかまいません。</p>
        </>
      )}
    </div>
  );
}
