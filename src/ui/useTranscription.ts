// 自動字幕の流れ（AI の選び方・ダウンロードの了承・文字起こしの進み具合）をまとめる
import { useEffect, useRef, useState } from 'preact/hooks';
import { detectGpu, fetchModelSize, hasConsent, recommendedModel, saveConsent, TranscribeJob, canUseModel, type GpuInfo } from '../ai/transcriber';
import type { TranscribeEvent, TranscribeItem } from '../ai/transcribe-protocol';
import { splitIntoCaptions } from '../core/captions';
import { sourceAudio, usedSources, voiceTracks, type Project } from '../core/project';
import { addSubtitles, markTranscribed, untranscribedRanges } from '../core/subtitles';
import { speechWindows } from '../core/transcribe-plan';
import { whisperModel, type ModelId, type WhisperModel } from '../data/models';
import type { AnalysisStore } from '../media/analysis';
import type { SourceRegistry } from '../media/registry';
import type { TranscribePhase } from './SubtitlePanel';

interface Deps {
  project: Project;
  projectRef: { current: Project };
  /** 作品を変える。replace が true なら、元に戻す記録を増やさずに今の状態を置きかえる */
  change(next: Project, replace: boolean): void;
  registry: SourceRegistry;
  analysis: AnalysisStore;
  notify(kind: 'info' | 'error', text: string): void;
}

interface PlannedRange {
  sourceId: string;
  range: [number, number];
  windows: [number, number][];
}

export function useTranscription(d: Deps) {
  const [phase, setPhase] = useState<TranscribePhase>({ kind: 'idle' });
  const [gpu, setGpu] = useState<GpuInfo>({ webgpu: false, f16: false });
  const [modelId, setModelId] = useState<ModelId>('light');
  const job = useRef<TranscribeJob | null>(null);
  const plan = useRef<PlannedRange[]>([]);
  const recorded = useRef(false);
  /** AI の部品を読み込み終わったか（失敗したときの案内を分けるため） */
  const ready = useRef(false);

  useEffect(() => {
    void detectGpu().then((g) => {
      setGpu(g);
      setModelId(recommendedModel(g));
    });
  }, []);

  /** まだ字幕にしていない、声のある部分の長さ（秒） */
  const remaining = usedSources(d.project).reduce((sum, s) => {
    if (voiceTracks(sourceAudio(d.project, s.id)).length === 0) return sum;
    return sum + untranscribedRanges(d.project, s.id).reduce((a, [x, y]) => a + (y - x), 0);
  }, 0);

  const makePlan = (): { items: TranscribeItem[]; ranges: PlannedRange[] } => {
    const p = d.projectRef.current;
    const items: TranscribeItem[] = [];
    const ranges: PlannedRange[] = [];
    for (const s of usedSources(p)) {
      const audio = sourceAudio(p, s.id);
      const tracks = voiceTracks(audio);
      const file = d.registry.file(s.id);
      if (tracks.length === 0 || !file) continue;
      const level = d.analysis.voiceLevel(s.id, audio);
      const windows: [number, number][] = [];
      for (const r of untranscribedRanges(p, s.id)) {
        const w = speechWindows([r], level, s.startTime, s.endTime);
        ranges.push({ sourceId: s.id, range: r, windows: w });
        windows.push(...w);
      }
      if (windows.length > 0) items.push({ sourceId: s.id, file, voiceTracks: tracks, windows });
    }
    return { items, ranges };
  };

  const onEvent = (ev: TranscribeEvent) => {
    if (ev.type === 'loading') {
      setPhase({ kind: 'loading', progress: ev.progress, loaded: ev.loaded, total: ev.total });
    } else if (ev.type === 'ready') {
      ready.current = true;
      const total = plan.current.reduce((n, r) => n + r.windows.length, 0);
      setPhase({ kind: 'running', done: 0, total, startedAt: Date.now() });
    } else if (ev.type === 'window') {
      const pieces = ev.segments.flatMap((seg) => splitIntoCaptions(seg.text, seg.start, seg.end));
      let next = addSubtitles(d.projectRef.current, ev.sourceId, pieces);
      // 文字起こしを済ませた範囲を記録する（まとまりの間の「間」も含めて）
      const planned = plan.current.find((r) => r.sourceId === ev.sourceId && ev.range[0] >= r.range[0] - 1e-6 && ev.range[1] <= r.range[1] + 1e-6);
      if (planned) {
        const isLast = planned.windows[planned.windows.length - 1]?.[1] === ev.range[1];
        next = markTranscribed(next, ev.sourceId, [planned.range[0], isLast ? planned.range[1] : ev.range[1]]);
      } else {
        next = markTranscribed(next, ev.sourceId, ev.range);
      }
      d.change(next, recorded.current);
      recorded.current = true;
      d.projectRef.current = next;
      setPhase((p) => (p.kind === 'running' ? { ...p, done: p.done + 1 } : p));
    } else if (ev.type === 'done') {
      job.current = null;
      setPhase({ kind: 'idle' });
      d.notify('info', '字幕を作りました。AI は聞き間違えることがあるので、一覧で確かめて直してください。');
    } else if (ev.type === 'canceled') {
      job.current = null;
      setPhase({ kind: 'idle' });
    } else {
      job.current = null;
      setPhase({ kind: 'error', message: ev.message, whileLoading: !ready.current });
    }
  };

  const start = (model: WhisperModel) => {
    const { items, ranges } = makePlan();
    // しゃべっている部分がない範囲は、済んだことにする
    let p = d.projectRef.current;
    for (const r of ranges) if (r.windows.length === 0) p = markTranscribed(p, r.sourceId, r.range);
    if (p !== d.projectRef.current) {
      d.change(p, false);
      d.projectRef.current = p;
    }
    if (items.length === 0) {
      d.notify('info', '字幕にする声が見つかりませんでした。');
      return;
    }
    plan.current = ranges;
    recorded.current = false;
    ready.current = false;
    setPhase({ kind: 'loading', progress: 0, loaded: 0, total: 0 });
    const j = new TranscribeJob(onEvent);
    job.current = j;
    j.start({ items, model });
  };

  const request = () => {
    const model = whisperModel(modelId);
    if (!hasConsent(model)) {
      setPhase({ kind: 'consent', model, bytes: null });
      void fetchModelSize(model).then((bytes) => setPhase((p) => (p.kind === 'consent' && p.model === model ? { ...p, bytes } : p)));
      return;
    }
    start(model);
  };

  const consent = () => {
    if (phase.kind !== 'consent') return;
    saveConsent(phase.model);
    start(phase.model);
  };

  return {
    phase,
    modelId,
    setModelId,
    usable: (id: ModelId) => canUseModel(whisperModel(id), gpu),
    remaining,
    running: phase.kind === 'loading' || phase.kind === 'running',
    request,
    consent,
    cancelConsent: () => setPhase({ kind: 'idle' }),
    cancel: () => job.current?.cancel(),
  };
}
