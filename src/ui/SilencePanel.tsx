// 「間」を切る手順。候補を見せて、確かめてからまとめて切る
import type { SourceInfo } from '../core/project';
import { formatLength } from '../core/time';
import { CUT_STRENGTHS } from '../data/silence';
import { Icon } from './icons';

interface Props {
  /** 音を調べている進み具合（0〜1） */
  progress: number;
  ready: boolean;
  count: number;
  /** 切ると短くなる秒数 */
  length: number;
  keptCount: number;
  strength: number;
  /** 直前に切った秒数（切ったあとに結果を見せるため） */
  lastCut: number | null;
  /** 声を選んでいない（音が複数ある）録画 */
  unconfirmed: SourceInfo[];
  onStrength(index: number): void;
  onCut(): void;
  onNext(): void;
  onPlayResult(): void;
  onAudioSettings(sourceId: string): void;
}

export function SilencePanel(p: Props) {
  if (p.lastCut !== null) {
    return (
      <div class="guide" aria-live="polite">
        <h2>「間」を切りました</h2>
        <p>
          動画が{formatLength(p.lastCut)}短くなりました。気に入らなければ「元に戻す」（Ctrl+Z）で戻せます。
        </p>
        <div class="actions sticky">
          <button class="btn primary big" onClick={p.onNext}>
            次へ：字幕
            <Icon name="next" />
          </button>
          <button class="btn" onClick={p.onPlayResult}>
            <Icon name="play" />
            結果を見る
          </button>
        </div>
      </div>
    );
  }
  return (
    <div class="guide" aria-live="polite">
      <h2>しゃべっていない「間」を切りましょう</h2>
      {!p.ready ? (
        <>
          <p>録画の音を調べています… {Math.floor(p.progress * 100)}%</p>
          <div class="progress">
            <div style={{ width: `${p.progress * 100}%` }} />
          </div>
          <p class="note">長い録画では少し時間がかかります。そのあいだも、ほかの操作はできます。</p>
        </>
      ) : p.count === 0 ? (
        <p>切ったほうがよさそうな「間」は見つかりませんでした。「切る強さ」を強くすると、短い「間」も見つけます。</p>
      ) : (
        <p>
          「間」を<strong>{p.count}か所</strong>見つけました。まとめて切ると、<strong>{formatLength(p.length)}</strong>
          短くなります。タイムラインの赤い印が切る場所です。残したい場所は、印を押すと残せます。
          {p.keptCount > 0 && `（${p.keptCount}か所を残します）`}
        </p>
      )}
      {p.unconfirmed.length > 0 && (
        <p class="note">
          音が複数入っている録画があります。先に「あなたの声」を選ぶと、正しく見つけられます。
          <br />
          {p.unconfirmed.map((s) => (
            <button key={s.id} class="btn small" onClick={() => p.onAudioSettings(s.id)}>
              {s.name} の音の設定
            </button>
          ))}
        </p>
      )}
      <div class="strength">
        <div class="section-title">切る強さ</div>
        <div class="segmented" role="radiogroup" aria-label="切る強さ">
          {CUT_STRENGTHS.map((s, i) => (
            <button key={s.label} role="radio" aria-checked={p.strength === i} class={p.strength === i ? 'on' : ''} onClick={() => p.onStrength(i)}>
              {s.label}
            </button>
          ))}
        </div>
        <p class="hint-text">
          {CUT_STRENGTHS[p.strength].minSilence}秒以上しゃべっていない場所を、前後に{CUT_STRENGTHS[p.strength].padding}秒の余白を残して切ります。
        </p>
      </div>
      <div class="actions sticky">
        <button class="btn primary big" onClick={p.onCut} disabled={!p.ready || p.count - p.keptCount <= 0}>
          まとめて切る
        </button>
        <button class="btn" onClick={p.onNext}>
          切らずに次へ
        </button>
      </div>
    </div>
  );
}
