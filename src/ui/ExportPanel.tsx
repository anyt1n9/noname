// 書き出しの手順（画質を選ぶ → 書き出す → できあがり）
import { useEffect, useRef, useState } from 'preact/hooks';
import { estimateExportSeconds, planExport, remainingSeconds } from '../core/export-plan';
import type { Project } from '../core/project';
import { formatBytes, formatLength } from '../core/time';
import { DEFAULT_QUALITY, QUALITY_PRESETS, qualityPreset, type QualityId } from '../data/quality';
import { chooseCodecs, ExportJob, type CodecChoice } from '../media/exporter';
import { pickExportTarget } from '../media/files';
import { Icon } from './icons';

const SPEED_KEY = 'teroppa.exportSpeed';

function loadSpeed(): number | null {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveSpeed(secondsPerVideoSecond: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(secondsPerVideoSecond));
  } catch {
    // 保存できなくても書き出しは使える
  }
}

type Phase =
  | { kind: 'choose' }
  | { kind: 'running'; progress: number; startedAt: number; canceling: boolean }
  | { kind: 'done'; bytes: number; seconds: number; fileName: string }
  | { kind: 'error'; message: string };

interface Props {
  project: Project;
  files: () => Record<string, File>;
  /** 作品で使う画像・曲の中身。見つからないものがあれば、その名前 */
  assets: () => Promise<{ blobs: Record<string, Blob>; missing: string[] }>;
  /** しゃべっている範囲（BGM を小さくするため） */
  speech: [number, number][];
  /** 声を調べ終わったか（BGM を小さくするのに要る） */
  speechReady: boolean;
  speechProgress: number;
  onBack(): void;
  onRunningChange(running: boolean): void;
  onExportSrt(): void;
}

export function ExportPanel({ project, files, assets, speech, speechReady, speechProgress, onBack, onRunningChange, onExportSrt }: Props) {
  const [quality, setQuality] = useState<QualityId>(DEFAULT_QUALITY);
  const [codecs, setCodecs] = useState<CodecChoice | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [now, setNow] = useState(Date.now());
  /** 字幕を動画に入れるか（入れずに、YouTube の字幕機能だけを使う人もいる） */
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const hasSubtitles = project.subtitles.length > 0;
  const job = useRef<ExportJob | null>(null);
  const plan = planExport(project, qualityPreset(quality));
  const speed = loadSpeed();
  const estimate = estimateExportSeconds(plan.duration, speed);

  useEffect(() => {
    let alive = true;
    setCodecs(undefined);
    void chooseCodecs(plan).then((c) => alive && setCodecs(c));
    return () => {
      alive = false;
    };
  }, [quality, plan.width, plan.height, plan.videoBitrate]);

  useEffect(() => {
    const running = phase.kind === 'running';
    onRunningChange(running);
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase.kind]);

  const start = async () => {
    if (!codecs) return;
    const fileName = `${project.name || '動画'}.mp4`;
    let target: FileSystemFileHandle | null;
    try {
      target = await pickExportTarget(fileName);
    } catch (e) {
      setPhase({ kind: 'error', message: `保存する場所を選べませんでした（${e instanceof Error ? e.message : String(e)}）` });
      return;
    }
    if (!target) return;
    const media = await assets();
    if (media.missing.length > 0) {
      setPhase({ kind: 'error', message: `画像・曲のファイルが見つかりません：${media.missing.join('、')}` });
      return;
    }
    const startedAt = Date.now();
    const savedName = target.name;
    setPhase({ kind: 'running', progress: 0, startedAt, canceling: false });
    const j = new ExportJob((ev) => {
      if (ev.type === 'progress') {
        setPhase((p) => (p.kind === 'running' ? { ...p, progress: ev.progress } : p));
      } else if (ev.type === 'done') {
        const seconds = (Date.now() - startedAt) / 1000;
        if (plan.duration > 1) saveSpeed(seconds / plan.duration);
        setPhase({ kind: 'done', bytes: ev.bytes, seconds, fileName: savedName });
        job.current = null;
      } else if (ev.type === 'canceled') {
        setPhase({ kind: 'choose' });
        job.current = null;
      } else {
        setPhase({ kind: 'error', message: ev.message });
        job.current = null;
      }
    });
    job.current = j;
    const exportProject = burnSubtitles ? project : { ...project, subtitles: [] };
    j.start(exportProject, files(), plan, codecs, target, media.blobs, speech);
  };

  const cancel = () => {
    job.current?.cancel();
    setPhase((p) => (p.kind === 'running' ? { ...p, canceling: true } : p));
  };

  if (phase.kind === 'running') {
    const elapsed = (now - phase.startedAt) / 1000;
    const remain = remainingSeconds(elapsed, phase.progress);
    return (
      <div class="guide" aria-live="polite">
        <h2>書き出しています…</h2>
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.progress * 100)}>
          <div style={{ width: `${phase.progress * 100}%` }} />
        </div>
        <dl class="facts">
          <dt>進み具合</dt>
          <dd>{Math.floor(phase.progress * 100)}%</dd>
          <dt>残り時間の目安</dt>
          <dd>{remain === null ? '計算しています…' : `あと約${formatLength(remain)}`}</dd>
        </dl>
        <p class="note">書き出しのあいだは、このタブを閉じないでください。ほかのタブやアプリは使えます。</p>
        <div class="actions">
          <button class="btn" onClick={cancel} disabled={phase.canceling}>
            {phase.canceling ? 'やめています…' : 'やめる'}
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'done') {
    return (
      <div class="guide">
        <h2>書き出しが終わりました</h2>
        <p>
          「{phase.fileName}」（{formatBytes(phase.bytes)}）を保存しました。かかった時間は{formatLength(phase.seconds)}です。
        </p>
        <div class="section-title">YouTube に上げるには</div>
        <ol class="steps-list">
          <li>YouTube Studio を開き、右上の「作成」から「動画をアップロード」を選ぶ</li>
          <li>書き出した MP4 ファイルを選ぶ</li>
          <li>タイトルや説明を入れて、公開の設定をする</li>
        </ol>
        <p class="note">
          公開する前に、他人の音楽・映像・画像を勝手に使っていないか確かめましょう。ゲーム実況では、ゲーム会社ごとに「動画を出してよいか」のルール（ガイドライン）があります。
        </p>
        {hasSubtitles && (
          <p class="note">
            YouTube の字幕機能も使うなら、字幕ファイルも保存しておきましょう（YouTube Studio の「字幕」から読み込めます）。
            <br />
            <button class="btn small" onClick={onExportSrt}>
              字幕ファイル（.srt）を保存する
            </button>
          </p>
        )}
        <div class="actions sticky">
          <button class="btn primary" onClick={() => setPhase({ kind: 'choose' })}>
            もう一度書き出す
          </button>
          <button class="btn" onClick={onBack}>
            <Icon name="back" />
            編集に戻る
          </button>
        </div>
      </div>
    );
  }

  const waitSpeech = project.bgm?.duck === true && !speechReady;
  const canStart = codecs !== undefined && codecs !== null && plan.duration > 0 && !waitSpeech;
  return (
    <div class="guide">
      <h2>動画を書き出しましょう</h2>
      <p>画質を選んで「書き出す」を押すと、保存する場所を聞かれます。</p>
      {phase.kind === 'error' && (
        <p class="note warn">
          書き出しに失敗しました。もう一度試してください。
          <br />
          （くわしい理由：{phase.message}）
        </p>
      )}
      <div class="quality-list" role="radiogroup" aria-label="画質">
        {QUALITY_PRESETS.map((q) => (
          <button
            key={q.id}
            class={`quality ${quality === q.id ? 'selected' : ''}`}
            role="radio"
            aria-checked={quality === q.id}
            onClick={() => setQuality(q.id)}
          >
            <span class="dot" />
            <span>
              <span class="label">{q.label}</span>
              <span class="size">
                {q.width}×{q.height}
              </span>
              <span class="desc">{q.description}</span>
            </span>
          </button>
        ))}
      </div>
      {hasSubtitles && (
        <label class="check">
          <input type="checkbox" checked={burnSubtitles} onChange={(e) => setBurnSubtitles((e.target as HTMLInputElement).checked)} />
          字幕を動画に入れる
        </label>
      )}
      {codecs?.fallback && (
        <p class="note">
          このパソコンのブラウザでは標準の形式（H.264・AAC）で書き出せないため、{codecs.video.label}・{codecs.audio.label} で書き出します。YouTube にはそのまま上げられます。
        </p>
      )}
      {codecs === null && (
        <p class="note warn">このブラウザでは動画を書き出せません。新しい Chrome か Edge で開いてください。</p>
      )}
      {waitSpeech && (
        <p class="note">
          しゃべっている間に BGM を小さくするため、録画の音を調べています… {Math.floor(speechProgress * 100)}%（終わると書き出せます）
        </p>
      )}
      <dl class="facts">
        <dt>動画の長さ</dt>
        <dd>{formatLength(plan.duration)}</dd>
        <dt>ファイルの大きさ</dt>
        <dd>約{formatBytes(plan.estimatedBytes)}（目安）</dd>
        <dt>かかる時間</dt>
        <dd>{estimate === null ? '始めてから目安を出します' : `約${formatLength(estimate)}（目安）`}</dd>
        <dt>なめらかさ</dt>
        <dd>1秒あたり{plan.frameRate}コマ</dd>
        <dt>形式</dt>
        <dd>{codecs ? `MP4（映像 ${codecs.video.label}・音 ${codecs.audio.label}）` : codecs === null ? '—' : '確かめています…'}</dd>
        <dt>ファイル名</dt>
        <dd>{project.name || '動画'}.mp4（保存のときに変えられます）</dd>
      </dl>
      <div class="actions sticky">
        <button class="btn primary big" onClick={start} disabled={!canStart}>
          書き出す
        </button>
        <button class="btn" onClick={onBack}>
          <Icon name="back" />
          編集に戻る
        </button>
      </div>
    </div>
  );
}
