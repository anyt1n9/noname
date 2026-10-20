// 音の設定。録画に入っている音を聴き比べて、「あなたの声」「ゲームの音など」「使わない」を選ぶ
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SourceAudio, SourceInfo, TrackRole } from '../core/project';
import type { TrackLevels } from '../media/analysis';
import { Icon } from './icons';
import { cssColor } from './theme';

const ROLE_LABELS: { role: TrackRole; label: string }[] = [
  { role: 'voice', label: 'あなたの声' },
  { role: 'other', label: 'ゲームの音など' },
  { role: 'off', label: '使わない' },
];

/** 聴き比べる長さ（秒） */
export const LISTEN_SECONDS = 6;

interface Props {
  source: SourceInfo;
  audio: SourceAudio;
  levels: (track: number) => TrackLevels | undefined;
  binSeconds: number;
  listening: number | null;
  onListen(track: number, from: number): void;
  onStopListening(): void;
  onChange(audio: SourceAudio): void;
  onClose(): void;
}

/** 一番音が大きい LISTEN_SECONDS 秒の始まり（そこを聴けば、何の音か分かりやすい） */
function loudestStart(peaks: Float32Array | undefined, binSeconds: number, startTime: number): number {
  if (!peaks || peaks.length === 0) return startTime;
  const win = Math.max(1, Math.round(LISTEN_SECONDS / binSeconds));
  let sum = 0;
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i < peaks.length; i++) {
    sum += peaks[i];
    if (i >= win) sum -= peaks[i - win];
    if (i >= win - 1 && sum > best) {
      best = sum;
      bestAt = i - win + 1;
    }
  }
  return Math.max(startTime, bestAt * binSeconds);
}

function MiniWave({ peaks }: { peaks: Float32Array | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = 220;
    const h = 36;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssColor('--panel-3');
    g.fillRect(0, 0, w, h);
    if (!peaks) return;
    g.fillStyle = cssColor('--wave');
    const per = peaks.length / w;
    for (let x = 0; x < w; x++) {
      let max = 0;
      for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) if (peaks[i] > max) max = peaks[i];
      const bar = Math.max(1, max * (h / 2 - 2));
      g.fillRect(x, h / 2 - bar, 1, bar * 2);
    }
  }, [peaks]);
  return <canvas ref={ref} class="mini-wave" style={{ width: '220px', height: '36px' }} aria-hidden="true" />;
}

export function AudioDialog(p: Props) {
  const [showObs, setShowObs] = useState(false);
  const { audio, source } = p;
  const count = source.audioTrackCount;
  const setRole = (i: number, role: TrackRole) => {
    const roles = [...audio.roles];
    roles[i] = role;
    p.onChange({ ...audio, roles });
  };
  const hasVoice = audio.roles.includes('voice');
  const hasOther = audio.roles.includes('other');
  const allOff = audio.roles.every((r) => r === 'off');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const close = () => {
    p.onStopListening();
    p.onChange({ ...audio, confirmed: true });
    p.onClose();
  };

  return (
    <div class="overlay">
      <div class="dialog wide" role="dialog" aria-modal="true" aria-label="音の設定">
        <h2>音の設定：{source.name}</h2>
        {count === 0 ? (
          <p class="dialog-text">この録画には音が入っていません。</p>
        ) : count === 1 ? (
          <p class="dialog-text">この録画の音の大きさを変えられます。</p>
        ) : (
          <p class="dialog-text">
            この録画には音が{count}つ入っています。「聴く」で聴き比べて、どれが<strong>あなたの声</strong>かを選んでください。「間」を見つけたり字幕を作ったりするときは、あなたの声だけを使います。
          </p>
        )}
        {count > 1 && (
          <div class="track-list">
            {audio.roles.map((role, i) => {
              const levels = p.levels(i);
              return (
                <div class="track-row" key={i}>
                  <div class="track-name">音{i + 1}</div>
                  <MiniWave peaks={levels?.peaks} />
                  <button
                    class="btn small"
                    onClick={() =>
                      p.listening === i ? p.onStopListening() : p.onListen(i, loudestStart(levels?.peaks, p.binSeconds, source.startTime))
                    }
                    title="この音だけを少し聴く"
                  >
                    <Icon name={p.listening === i ? 'pause' : 'play'} />
                    {p.listening === i ? '止める' : '聴く'}
                  </button>
                  <div class="segmented" role="radiogroup" aria-label={`音${i + 1}の役割`}>
                    {ROLE_LABELS.map((r) => (
                      <button key={r.role} role="radio" aria-checked={role === r.role} class={role === r.role ? 'on' : ''} onClick={() => setRole(i, r.role)}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {count > 0 && (
          <div class="sliders">
            <label>
              <span>{count > 1 ? '声の大きさ' : '音の大きさ'}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={audio.voiceGain}
                onInput={(e) => p.onChange({ ...audio, voiceGain: Number((e.target as HTMLInputElement).value) })}
              />
              <span class="value">{Math.round(audio.voiceGain * 100)}%</span>
            </label>
            {hasOther && (
              <label>
                <span>ゲームの音などの大きさ</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={audio.otherGain}
                  onInput={(e) => p.onChange({ ...audio, otherGain: Number((e.target as HTMLInputElement).value) })}
                />
                <span class="value">{Math.round(audio.otherGain * 100)}%</span>
              </label>
            )}
          </div>
        )}
        {count > 1 && !hasVoice && !allOff && <p class="note warn">「あなたの声」がないと、「間」を見つけたり字幕を作ったりするときに、ほかの音も使うことになります。</p>}
        {count > 0 && allOff && <p class="note warn">音がすべて「使わない」になっています。書き出す動画は無音になります。</p>}
        {count > 1 && (
          <div class="obs-help">
            <button class="btn small ghost" onClick={() => setShowObs((v) => !v)} aria-expanded={showObs}>
              {showObs ? '▼' : '▶'} OBS で「声」と「ゲームの音」を分けて録るには
            </button>
            {showObs && (
              <ol class="steps-list">
                <li>OBS の「設定」→「出力」で、出力モードを「詳細」にする</li>
                <li>「録画」タブの「音声トラック」で 1・2・3 にチェックを入れる</li>
                <li>「編集」→「オーディオの詳細プロパティ」で、マイクを トラック2、デスクトップ音声を トラック3 にする（トラック1 は両方のまま）</li>
                <li>録画の形式は MKV か「ハイブリッド MP4」がおすすめ（途中で止まっても壊れにくい）</li>
                <li>テロッパでは、音1 を「使わない」、音2 を「あなたの声」、音3 を「ゲームの音など」にする</li>
              </ol>
            )}
          </div>
        )}
        <div class="actions">
          <button class="btn primary" onClick={close} autoFocus>
            決める
          </button>
        </div>
      </div>
    </div>
  );
}
