// 音の仕上げの手順。声の仕上げ（v0.7）・BGM・効果音（v0.5）
import { useState } from 'preact/hooks';
import type { BgmSetting, Project } from '../core/project';
import { formatClock, formatLength } from '../core/time';
import { DEFAULT_BGM_VOLUME, MUSIC_TRACKS } from '../data/music';
import { SOUNDS, type SoundId } from '../data/sfx';
import { DENOISE_STRENGTHS, VOICE_TARGET_LUFS, type DenoiseStrength } from '../data/voice';
import { Icon } from './icons';

export type SoundTab = 'voice' | 'bgm' | 'effects';

const SOUND_TABS: readonly { value: SoundTab; label: string }[] = [
  { value: 'voice', label: '声' },
  { value: 'bgm', label: 'BGM' },
  { value: 'effects', label: '効果音' },
];

/** 録画ごとの声の様子 */
export interface VoiceInfo {
  id: string;
  name: string;
  /** いまの声の大きさの設定（dB） */
  gainDb: number;
  /** 調べた声の大きさ（LUFS）。調べている途中は undefined、声がなければ null */
  loudness: number | null | undefined;
}

interface Props {
  project: Project;
  tab: SoundTab;
  onTab(tab: SoundTab): void;
  voices: VoiceInfo[];
  /** いまの雑音を減らす設定（録画で違えば、最初の録画のもの） */
  denoise: DenoiseStrength | 'off';
  /** 直前にそろえた結果 */
  normalized: { name: string; db: number }[] | null;
  onNormalize(): void;
  onDenoise(strength: DenoiseStrength | 'off'): void;
  /** 鳴る効果音（完成した動画の時刻） */
  effects: { id: string; sound: SoundId; time: number }[];
  /** 試しに鳴らしているもの（'music:calm'・'sound:pikon' など） */
  previewing: string | null;
  /** しゃべっている範囲を調べ終わったか */
  speechReady: boolean;
  onBgm(bgm: BgmSetting | null): void;
  onPickMusic(): void;
  onPreviewMusic(track: BgmSetting['track']): void;
  onPreviewSound(sound: SoundId): void;
  onStopPreview(): void;
  onAddEffect(sound: SoundId): void;
  onRemoveEffect(id: string): void;
  onEffectsVolume(volume: number): void;
  onSeek(t: number): void;
  onNext(): void;
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function SoundPanel(p: Props) {
  const [askRights, setAskRights] = useState(false);
  const bgm = p.project.bgm;
  const musicAssets = p.project.assets.filter((a) => a.kind === 'music');
  const choose = (track: BgmSetting['track'] | null) =>
    p.onBgm(track ? { track, volume: bgm?.volume ?? DEFAULT_BGM_VOLUME, duck: bgm?.duck ?? true } : null);
  const isOn = (track: BgmSetting['track']) =>
    bgm !== null &&
    bgm.track.kind === track.kind &&
    (track.kind === 'builtin' ? bgm.track.kind === 'builtin' && bgm.track.id === track.id : bgm.track.kind === 'asset' && bgm.track.assetId === track.assetId);
  const previewKey = (track: BgmSetting['track']) => (track.kind === 'builtin' ? `music:${track.id}` : `music:${track.assetId}`);

  const PreviewButton = ({ id, onPlay, label }: { id: string; onPlay(): void; label: string }) =>
    p.previewing === id ? (
      <button class="btn icon ghost" title="止める" aria-label={`${label}を止める`} onClick={p.onStopPreview}>
        <Icon name="stop" />
      </button>
    ) : (
      <button class="btn icon ghost" title="試しに聴く" aria-label={`${label}を試しに聴く`} onClick={onPlay}>
        <Icon name="play" />
      </button>
    );

  const signed = (db: number) => `${db >= 0 ? '+' : ''}${db.toFixed(1)}dB`;
  const voiceReady = p.voices.every((v) => v.loudness !== undefined);

  return (
    <div class="guide sound-panel" aria-live="polite">
      <h2>音を仕上げましょう</h2>
      <p>声を聞きやすくして、BGM と効果音を入れます。使わないものは、そのまま次へ進みましょう。</p>
      <div class="tabs" role="tablist" aria-label="音の種類">
        {SOUND_TABS.map((t) => (
          <button key={t.value} role="tab" aria-selected={p.tab === t.value} class={p.tab === t.value ? 'on' : ''} onClick={() => p.onTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      {p.tab === 'voice' && (
        <>
          <div class="section-title">声の大きさをそろえる</div>
          <p class="hint-text">
            声の大きさを、YouTube で聞きやすい大きさ（{VOICE_TARGET_LUFS} LUFS くらい）にそろえます。録画ごとに大きさが違っても、同じくらいになります。
          </p>
          <ul class="item-list" aria-label="録画ごとの声の大きさ">
            {p.voices.map((v) => (
              <li key={v.id}>
                <span class="item-main static">
                  <span class="item-name">{v.name}</span>
                  <span class="item-time">
                    {v.loudness === undefined
                      ? '調べています…'
                      : v.loudness === null
                        ? '声がありません'
                        : Math.abs(v.gainDb) > 0.05
                          ? `${v.loudness.toFixed(1)} → ${(v.loudness + v.gainDb).toFixed(1)} LUFS（${signed(v.gainDb)}）`
                          : `${v.loudness.toFixed(1)} LUFS`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div class="actions">
            <button class="btn primary" onClick={p.onNormalize} disabled={!voiceReady}>
              声の大きさをそろえる
            </button>
          </div>
          {p.normalized && (
            <p class="note">
              {p.normalized.length === 0
                ? 'すでにそろっていました。'
                : `${p.normalized.map((n) => `${n.name}：${signed(n.db)}`).join('、')} にしました。気に入らなければ「元に戻す」で戻せます。`}
            </p>
          )}
          <div class="section-title">雑音を減らす</div>
          <p class="hint-text">エアコンやパソコンのファンの音など、ずっと鳴っている雑音を小さくします。しゃべっていない静かな部分から、雑音の音色を調べます。強くしすぎると、声が少しこもることがあります。</p>
          <div class="segmented" role="radiogroup" aria-label="雑音を減らす強さ">
            {[{ value: 'off' as const, label: 'しない' }, ...DENOISE_STRENGTHS].map((d) => (
              <button key={d.value} role="radio" aria-checked={p.denoise === d.value} class={p.denoise === d.value ? 'on' : ''} disabled={d.value !== 'off' && !voiceReady} onClick={() => p.onDenoise(d.value)}>
                {d.label}
              </button>
            ))}
          </div>
          <p class="hint-text">大きすぎる音は、音が割れないように自動でなめらかに抑えます。</p>
        </>
      )}

      {p.tab === 'bgm' && (
      <>
      <div class="section-title">BGM</div>
      <div class="choice-list" role="radiogroup" aria-label="BGM">
        <div class={`choice ${bgm === null ? 'on' : ''}`}>
          <button class="choice-main" role="radio" aria-checked={bgm === null} onClick={() => choose(null)}>
            <span class="dot" />
            <span class="label">なし</span>
          </button>
        </div>
        {MUSIC_TRACKS.map((t) => {
          const track = { kind: 'builtin' as const, id: t.id };
          return (
            <div key={t.id} class={`choice ${isOn(track) ? 'on' : ''}`}>
              <button class="choice-main" role="radio" aria-checked={isOn(track)} onClick={() => choose(track)}>
                <span class="dot" />
                <span class="label">{t.label}</span>
                <span class="desc">{t.mood}</span>
              </button>
              <PreviewButton id={previewKey(track)} label={t.label} onPlay={() => p.onPreviewMusic(track)} />
            </div>
          );
        })}
        {musicAssets.map((a) => {
          const track = { kind: 'asset' as const, assetId: a.id };
          return (
            <div key={a.id} class={`choice ${isOn(track) ? 'on' : ''}`}>
              <button class="choice-main" role="radio" aria-checked={isOn(track)} onClick={() => choose(track)}>
                <span class="dot" />
                <span class="label">{a.name}</span>
                <span class="desc">自分で用意した曲（{formatLength(a.duration)}）</span>
              </button>
              <PreviewButton id={previewKey(track)} label={a.name} onPlay={() => p.onPreviewMusic(track)} />
            </div>
          );
        })}
      </div>
      <div class="actions">
        <button class="btn small" onClick={() => setAskRights(true)}>
          <Icon name="music" />
          自分で用意した曲を使う
        </button>
      </div>
      {askRights && (
        <div class="note rights" role="dialog" aria-label="曲を使う前の確認">
          <strong>曲を選ぶ前に確かめてください</strong>
          <br />
          他の人が作った曲を、許可なく動画に使うと著作権の侵害になります。使えるのは、自分で作った曲か、動画に使ってよい条件（ライセンス）を確かめた曲だけです。条件によっては、作者の名前を動画の説明に書く必要があります。
          <div class="actions">
            <button
              class="btn primary small"
              onClick={() => {
                setAskRights(false);
                p.onPickMusic();
              }}
            >
              確かめたので、曲を選ぶ
            </button>
            <button class="btn small" onClick={() => setAskRights(false)}>
              やめる
            </button>
          </div>
        </div>
      )}
      {bgm && (
        <div class="sliders">
          <label>
            <span>BGM の大きさ</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={bgm.volume}
              aria-label="BGM の大きさ"
              onChange={(e) => p.onBgm({ ...bgm, volume: Number((e.target as HTMLInputElement).value) })}
            />
            <span class="value">{percent(bgm.volume)}</span>
          </label>
          <label class="check">
            <input type="checkbox" checked={bgm.duck} onChange={(e) => p.onBgm({ ...bgm, duck: (e.target as HTMLInputElement).checked })} />
            しゃべっている間は BGM を小さくする
          </label>
          {bgm.duck && !p.speechReady && <p class="hint-text">録画の音を調べ終わると、しゃべっている間に小さくなります。</p>}
        </div>
      )}
      <p class="hint-text">入っている曲は、テロッパの中でプログラムで作った曲です。テロッパで作った動画に使えます。</p>
      </>
      )}

      {p.tab === 'effects' && (
      <>
      <div class="section-title">効果音</div>
      <p class="hint-text">名前のボタンを押すと、いまの再生位置（タイムラインのオレンジの線）に置きます。▶ で試しに聴けます。</p>
      <div class="sound-grid">
        {SOUNDS.map((s) => (
          <div key={s.id} class="sound-cell">
            <button class="btn" title={`${s.hint}。いまの再生位置に置く`} onClick={() => p.onAddEffect(s.id)}>
              <Icon name="bell" />
              {s.label}
            </button>
            <PreviewButton id={`sound:${s.id}`} label={s.label} onPlay={() => p.onPreviewSound(s.id)} />
          </div>
        ))}
      </div>
      {p.effects.length > 0 && (
        <>
          <ul class="item-list" aria-label="置いた効果音">
            {p.effects.map((e) => (
              <li key={`${e.id}@${e.time}`}>
                <button class="item-main" onClick={() => p.onSeek(e.time)} title="この位置へ動く">
                  <span class="item-time">{formatClock(e.time, true)}</span>
                  <span class="item-name">{SOUNDS.find((s) => s.id === e.sound)?.label}</span>
                </button>
                <button class="btn icon ghost" title="この効果音を外す" aria-label="この効果音を外す" onClick={() => p.onRemoveEffect(e.id)}>
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
          <div class="sliders">
            <label>
              <span>効果音の大きさ</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={p.project.effectsVolume}
                aria-label="効果音の大きさ"
                onChange={(e) => p.onEffectsVolume(Number((e.target as HTMLInputElement).value))}
              />
              <span class="value">{percent(p.project.effectsVolume)}</span>
            </label>
          </div>
        </>
      )}
      </>
      )}
      <div class="actions sticky">
        <button class="btn primary big" onClick={p.onNext}>
          次へ：書き出し
          <Icon name="next" />
        </button>
      </div>
    </div>
  );
}
