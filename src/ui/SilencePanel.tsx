// 「間」を切る手順。候補を見せて、確かめてからまとめて切る。口ぐせ（v0.7・試験的）も同じように切れる
import type { FillerCandidate } from '../core/fillers';
import type { SourceInfo } from '../core/project';
import { formatClock, formatLength } from '../core/time';
import { CUT_STRENGTHS } from '../data/silence';
import { Icon } from './icons';

export type SilenceTab = 'silence' | 'fillers';

export interface FillerProps {
  candidates: (FillerCandidate & { from: number })[];
  kept: Set<string>;
  length: number;
  lastCut: number | null;
  onCut(): void;
  onSeek(t: number): void;
  onToggle(id: string): void;
}

interface Props {
  tab: SilenceTab;
  onTab(tab: SilenceTab): void;
  fillers: FillerProps;
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

const TABS: readonly { value: SilenceTab; label: string }[] = [
  { value: 'silence', label: '「間」' },
  { value: 'fillers', label: '「えー」「あのー」（試験的）' },
];

function Tabs(p: { tab: SilenceTab; onTab(tab: SilenceTab): void }) {
  return (
    <div class="tabs" role="tablist" aria-label="切るものの種類">
      {TABS.map((t) => (
        <button key={t.value} role="tab" aria-selected={p.tab === t.value} class={p.tab === t.value ? 'on' : ''} onClick={() => p.onTab(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SilencePanel(p: Props) {
  if (p.tab === 'fillers') return <FillerPanel {...p} />;
  if (p.lastCut !== null) {
    return (
      <div class="guide" aria-live="polite">
        <h2>「間」を切りました</h2>
        <Tabs tab={p.tab} onTab={p.onTab} />
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
      <Tabs tab={p.tab} onTab={p.onTab} />
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

function FillerPanel(p: Props) {
  const f = p.fillers;
  const left = f.candidates.filter((c) => !f.kept.has(c.id));
  return (
    <div class="guide" aria-live="polite">
      <h2>「えー」「あのー」を切りましょう</h2>
      <Tabs tab={p.tab} onTab={p.onTab} />
      <p class="note">
        試験的な機能です。字幕の中の「えー」などの行と、前後に「間」がある、同じ音をのばした短い声を探します。まちがえて見つけることがあるので、印の場所を再生して確かめてから切ってください。
      </p>
      {f.lastCut !== null && <p>動画が{formatLength(f.lastCut)}短くなりました。気に入らなければ「元に戻す」（Ctrl+Z）で戻せます。</p>}
      {!p.ready ? (
        <p>録画の音を調べています… {Math.floor(p.progress * 100)}%</p>
      ) : f.candidates.length === 0 ? (
        <p>口ぐせの候補は見つかりませんでした。</p>
      ) : (
        <>
          <p>
            候補を<strong>{f.candidates.length}か所</strong>見つけました。切ると<strong>{formatLength(f.length)}</strong>短くなります。残したいものは、一覧かタイムラインの印を押すと残せます。
          </p>
          <ul class="item-list" aria-label="口ぐせの候補">
            {f.candidates.map((c) => (
              <li key={c.id} class={f.kept.has(c.id) ? 'kept' : ''}>
                <button class="item-main" onClick={() => f.onSeek(c.from)} title="この場所を再生して確かめる">
                  <span class="item-time">{formatClock(c.from, true)}</span>
                  <span class="item-name">{c.reason === 'text' ? `字幕「${c.text}」` : 'のばした声'}</span>
                </button>
                <button class="btn small ghost" onClick={() => f.onToggle(c.id)}>
                  {f.kept.has(c.id) ? '切る' : '残す'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div class="actions sticky">
        <button class="btn primary big" onClick={f.onCut} disabled={!p.ready || left.length === 0}>
          まとめて切る
        </button>
        <button class="btn" onClick={p.onNext}>
          次へ：字幕
          <Icon name="next" />
        </button>
      </div>
    </div>
  );
}
