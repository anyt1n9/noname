// 画面全体。作品のデータ・再生・保存をまとめる
import { Fragment } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { speechOnTimeline } from '../core/bgm';
import { addEffect, effectLength, effectsOnTimeline, removeEffect } from '../core/effects';
import { activeJoinFades, fadeSourceChanges, nearestJoin, toggleJoinFade } from '../core/fades';
import { findFillers, type VoiceFeatures } from '../core/fillers';
import { normalizeVoices, quietRanges } from '../core/finish';
import { guideMessage } from '../core/guide';
import { toDb } from '../core/loudness';
import { addImage, imagesAt, imagesOnTimeline, moveImage, removeImage, setImagePlace, setImageTime } from '../core/images';
import { rangedAt } from '../core/ranged';
import { addShape, moveShape, placeShape, removeShape, setShapeStyle, setShapeTime, shapesAt, shapesOnTimeline } from '../core/shapes';
import { addZoom, removeZoom, setZoomFactor, setZoomRect, setZoomTime, zoomsOnTimeline } from '../core/zoom';
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from '../core/history';
import { actionForKey } from '../core/keys';
import {
  addAsset,
  addSources,
  dropUnusedAssets,
  emptyProject,
  setSourceAudio,
  sourceAudio,
  updateSource,
  usedAssetIds,
  usedSources,
  voiceTracks,
  type BgmSetting,
  type Project,
  type SourceAudio,
  type SourceInfo,
} from '../core/project';
import { parseProject, PROJECT_FILE_EXTENSION, serializeProject } from '../core/project-file';
import { applyCandidates, candidateOnTimeline, candidatesLength, findCandidates, type VoiceLevel } from '../core/silence';
import { breakLines } from '../core/captions';
import { importSrt, parseSrt, toSrt } from '../core/srt';
import {
  addSubtitleAt,
  cutSubtitle,
  mergeWithNext,
  removeSubtitle,
  setSubtitleText,
  setSubtitleTime,
  splitSubtitle,
  subtitleAt,
  subtitlesOnTimeline,
} from '../core/subtitles';
import { formatClock } from '../core/time';
import { clipStarts, deleteRange, locate as locateTime, moveClip, removeSourceRanges, setSpeed, sourceRangeOnTimeline, speedAt, totalDuration } from '../core/timeline';
import type { DenoiseStrength } from '../data/voice';
import { MIN_IMAGE_WIDTH, NEW_IMAGE_SECONDS } from '../data/images';
import { NEW_SHAPE_SECONDS, SHAPE_KINDS, type ShapeKind } from '../data/shapes';
import { MIN_ZOOM_WIDTH, NEW_ZOOM_SECONDS } from '../data/zoom';
import { LONG_STEP_SECONDS, STEP_SECONDS } from '../data/keys';
import { DEFAULT_BGM_VOLUME, musicTrack } from '../data/music';
import type { SoundId } from '../data/sfx';
import { CUT_STRENGTHS, DEFAULT_CUT_STRENGTH } from '../data/silence';
import { STEPS, type StepId } from '../data/steps';
import {
  droppedFiles,
  ensureReadPermission,
  IMAGE_FILE_KIND,
  MUSIC_FILE_KIND,
  pickMediaFile,
  isProjectFileName,
  isRecordingFileName,
  openTextFile,
  pickRecordings,
  saveTextFile,
  SRT_FILE_KIND,
  type PickedFile,
} from '../media/files';
import { AnalysisStore } from '../media/analysis';
import { assetBlob, decodeAssets, encodeAssets, forgetAssetsExcept, keepAsset, readImageFile, readMusicFile } from '../media/assets';
import { setImageSource } from '../media/compose';
import { Player, type PlayerState } from '../media/player';
import { errorText, probeFile } from '../media/probe';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, SourceRegistry } from '../media/registry';
import { measureSourceNoise } from '../media/noise';
import { assetMusic, builtinMusic, effectBuffer } from '../media/sounds';
import { loadWork, saveWork } from '../media/storage';
import { AudioDialog, LISTEN_SECONDS } from './AudioDialog';
import { AboutDialog, BusyOverlay, DropOverlay, KeysDialog, Toast, type Notice } from './Dialogs';
import { BoxHandles, type Box } from './BoxHandles';
import { AiDialog } from './AiDialog';
import { DecoratePanel, type DecorateTab, type Selected } from './DecoratePanel';
import { PublishPanel, type PublishTab } from './PublishPanel';
import { TypoDialog } from './TypoDialog';
import { ExportPanel } from './ExportPanel';
import { GuidePanel } from './GuidePanel';
import { SoundPanel, type SoundTab } from './SoundPanel';
import { SilencePanel, type SilenceTab } from './SilencePanel';
import { SubtitlePanel } from './SubtitlePanel';
import { useTranscription } from './useTranscription';
import { Icon } from './icons';
import { applyTheme, loadThemePreference, saveThemePreference, THEME_LABELS, THEME_ORDER, type ThemePreference } from './theme';
import { Timeline, type LaneItem, type TimelineControl, type TimelineLane, type TimelineMark } from './Timeline';
import { APP_VERSION_SHORT } from '../version';

/** 書き出す画面の「幅 ÷ 高さ」（プレビューと同じ 16:9） */
const FRAME_ASPECT = PREVIEW_WIDTH / PREVIEW_HEIGHT;

// プレビューで画像を描くとき、中身はブラウザの中の保存場所から取り出す
setImageSource(assetBlob);

/** 録画のファイルが、作品に記録した録画と同じものか */
function sameFile(source: SourceInfo, file: File): boolean {
  return file.name === source.name && file.size === source.size;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** 選んでいるものを、プレビューの上の四角の位置に動かす */
function moveBox(project: Project, target: Selected, box: Box): Project {
  if (target.kind === 'image') return moveImage(project, target.id, { x: box.x, y: box.y, w: box.w });
  if (target.kind === 'shape') return moveShape(project, target.id, box);
  return setZoomRect(project, target.id, { x: box.x, y: box.y, w: box.w });
}

/** 選んでいるものを動かす四角（いま映っていなければ null） */
function boxHandleFor(
  project: Project,
  draft: (Selected & { box: Box }) | null,
  target: Selected,
  t: number,
): { box: Box; lockRatio?: number; minW: number; maxW: number; variant: 'solid' | 'dashed'; label: string } | null {
  const shown = draft && draft.id === target.id ? moveBox(project, target, draft.box) : project;
  if (target.kind === 'image') {
    const image = imagesAt(shown, t).find((i) => i.id === target.id);
    if (!image) return null;
    const asset = shown.assets.find((a) => a.id === image.assetId);
    const ratio = asset && asset.height > 0 ? FRAME_ASPECT / (asset.width / asset.height) : 1;
    return { box: { x: image.x, y: image.y, w: image.w, h: image.w * ratio }, lockRatio: ratio, minW: MIN_IMAGE_WIDTH, maxW: 1, variant: 'solid', label: '選んだ画像（ドラッグで動かせます）' };
  }
  if (target.kind === 'shape') {
    const shape = shapesAt(shown, t).find((g) => g.id === target.id);
    if (!shape) return null;
    return { box: { x: shape.x, y: shape.y, w: shape.w, h: shape.h }, minW: 0.02, maxW: 1, variant: 'solid', label: '選んだ矢印・枠（ドラッグで動かせます）' };
  }
  const zoom = rangedAt(shown, shown.zooms, t).find((z) => z.id === target.id);
  if (!zoom) return null;
  return { box: { x: zoom.x, y: zoom.y, w: zoom.w, h: zoom.w }, lockRatio: 1, minW: MIN_ZOOM_WIDTH, maxW: 1, variant: 'dashed', label: '拡大する場所（ドラッグで動かせます）' };
}

export function App() {
  const registry = useMemo(() => new SourceRegistry(), []);
  const [history, setHistory] = useState<History<Project>>(() => createHistory(emptyProject()));
  const project = history.present;
  const [handles, setHandles] = useState<Record<string, FileSystemFileHandle>>({});
  /** 開けている録画の ID */
  const [openIds, setOpenIds] = useState<string[]>([]);
  /** 許可をもらえば開ける録画の ID */
  const [permissionIds, setPermissionIds] = useState<string[]>([]);
  const [step, setStep] = useState<StepId>('import');
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [playback, setPlayback] = useState<PlayerState>({ time: 0, playing: false });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(loadThemePreference);
  const [levelsTick, setLevelsTick] = useState(0);
  const analysis = useMemo(() => new AnalysisStore(() => setLevelsTick((t) => t + 1)), []);
  /** 無音カット：切る強さ・残すと決めた候補・直前に切った秒数 */
  const [strength, setStrength] = useState(DEFAULT_CUT_STRENGTH);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [lastCut, setLastCut] = useState<number | null>(null);
  /** 音の設定を開いている録画と、聴き比べている音 */
  const [audioFor, setAudioFor] = useState<string | null>(null);
  const [listening, setListening] = useState<number | null>(null);
  /** 文章で編集：動画から消すか確かめている字幕 */
  const [pendingCut, setPendingCut] = useState<string | null>(null);
  /** 飾り：開いているタブ・選んでいるもの・ドラッグで動かしている途中の位置 */
  const [decorateTab, setDecorateTab] = useState<DecorateTab>('image');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [boxDraft, setBoxDraft] = useState<(Selected & { box: Box }) | null>(null);
  /** BGM・効果音：試しに鳴らしているもの */
  const [previewing, setPreviewing] = useState<string | null>(null);
  /** 「間」を切る手順のタブと、口ぐせ（試験的）の候補で残すもの・直前に切った秒数 */
  const [silenceTab, setSilenceTab] = useState<SilenceTab>('silence');
  const [keptFillers, setKeptFillers] = useState<Set<string>>(new Set());
  const [lastFillerCut, setLastFillerCut] = useState<number | null>(null);
  /** 音の仕上げのタブと、直前に声の大きさをそろえた結果 */
  const [soundTab, setSoundTab] = useState<SoundTab>('voice');
  const [normalized, setNormalized] = useState<{ name: string; db: number }[] | null>(null);
  /** AI のお手伝い（v0.8） */
  const [showAi, setShowAi] = useState(false);
  const [showTypos, setShowTypos] = useState(false);
  const [publishTab, setPublishTab] = useState<PublishTab>('title');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const timelineControl = useRef<TimelineControl | null>(null);

  // 非同期の処理から最新の値を読むため
  const projectRef = useRef(project);
  projectRef.current = project;
  const handlesRef = useRef(handles);
  handlesRef.current = handles;

  const missing = usedSources(project).filter((s) => !openIds.includes(s.id));
  const missingSet = useMemo(() => new Set(missing.map((s) => s.id)), [missing.map((s) => s.id).join(',')]);
  const total = totalDuration(project);

  // 無音カットの候補（「間」を切る手順のときだけ）
  const used = usedSources(project);
  const analysisProgress = analysis.progress(used.map((s) => s.id));
  const analysisReady = used.every((s) => analysis.isFinished(s.id));
  const candidates = useMemo(() => {
    if (step !== 'silence') return [];
    const levels = new Map<string, VoiceLevel>();
    for (const s of used) {
      const level = analysis.voiceLevel(s.id, sourceAudio(project, s.id));
      if (level) levels.set(s.id, level);
    }
    return findCandidates(project, levels, CUT_STRENGTHS[strength]);
  }, [step, project, strength, levelsTick]);
  const marks: TimelineMark[] = useMemo(
    () =>
      candidates.flatMap((c) => {
        const span = candidateOnTimeline(project, c);
        return span ? [{ id: c.id, from: span[0], to: span[1], kept: kept.has(c.id) }] : [];
      }),
    [candidates, kept],
  );
  const unconfirmed = used.filter((s) => s.audioTrackCount > 1 && !sourceAudio(project, s.id).confirmed);

  // 口ぐせの候補（試験的。「間」を切る手順の口ぐせのタブのときだけ）
  const fillers = useMemo(() => {
    if (step !== 'silence' || silenceTab !== 'fillers') return [];
    const features = new Map<string, VoiceFeatures>();
    for (const s of used) {
      const f = analysis.voiceFeatures(s.id, sourceAudio(project, s.id));
      if (f) features.set(s.id, f);
    }
    return findFillers(project, features).flatMap((c) => {
      const span = sourceRangeOnTimeline(project, c)[0];
      return span ? [{ ...c, from: span[0], to: span[1] }] : [];
    });
  }, [step, silenceTab, project, analysisReady ? 'ready' : levelsTick]);
  const fillerLength = fillers.filter((c) => !keptFillers.has(c.id)).reduce((t, c) => t + (c.to - c.from), 0);

  /** 作品を変える（元に戻せるように記録する） */
  const apply = useCallback((next: Project) => setHistory((h) => record(h, next)), []);

  // 自動字幕
  const transcription = useTranscription({
    project,
    projectRef,
    change: (next, replace) => (replace ? setHistory((h) => ({ ...h, present: next })) : apply(next)),
    registry,
    analysis,
    notify: (kind, text) => setNotice({ kind, text }),
  });
  const timelineSubtitles = useMemo(() => subtitlesOnTimeline(project), [project.subtitles, project.clips]);
  const currentSubtitle = subtitleAt(project, playback.time);
  const subtitleLane: TimelineLane | null =
    project.subtitles.length > 0
      ? {
          id: 'subtitles',
          label: '字幕',
          items: timelineSubtitles.map((s) => ({ key: s.key, id: s.id, from: s.from, to: s.to, text: s.text })),
          resizable: true,
          selectedId: currentSubtitle?.id ?? null,
        }
      : null;

  // 画像・効果音・BGM の段
  const timelineImages = useMemo(() => imagesOnTimeline(project), [project.images, project.clips, project.assets]);
  const timelineEffects = useMemo(() => effectsOnTimeline(project), [project.effects, project.clips]);
  const imageLane: TimelineLane | null =
    timelineImages.length > 0
      ? {
          id: 'images',
          label: '画像',
          items: timelineImages.map((i) => ({ key: i.key, id: i.id, from: i.from, to: i.to, text: i.name })),
          resizable: true,
          selectedId: selected?.kind === 'image' ? selected.id : null,
        }
      : null;
  const timelineShapes = useMemo(() => shapesOnTimeline(project), [project.shapes, project.clips]);
  const timelineZooms = useMemo(() => zoomsOnTimeline(project), [project.zooms, project.clips]);
  const shapeName = (kind: ShapeKind) => SHAPE_KINDS.find((k) => k.value === kind)?.label ?? '';
  const shapeLane: TimelineLane | null =
    timelineShapes.length > 0
      ? {
          id: 'shapes',
          label: '矢印・枠',
          items: timelineShapes.map((g) => ({ key: g.key, id: g.id, from: g.from, to: g.to, text: shapeName(g.kind) })),
          resizable: true,
          selectedId: selected?.kind === 'shape' ? selected.id : null,
        }
      : null;
  const zoomLane: TimelineLane | null =
    timelineZooms.length > 0
      ? {
          id: 'zooms',
          label: '拡大',
          items: timelineZooms.map((z) => ({ key: z.key, id: z.id, from: z.from, to: z.to, text: `${z.factor.toFixed(1)}倍` })),
          resizable: true,
          selectedId: selected?.kind === 'zoom' ? selected.id : null,
        }
      : null;
  const effectLane: TimelineLane | null =
    timelineEffects.length > 0
      ? {
          id: 'effects',
          label: '効果音',
          items: timelineEffects.map((e, i) => ({ key: `${e.id}#${i}`, id: e.id, from: e.time, to: e.time + effectLength(e.sound), text: '♪' })),
          resizable: false,
        }
      : null;
  const bgmName = project.bgm
    ? project.bgm.track.kind === 'builtin'
      ? `BGM：${musicTrack(project.bgm.track.id)?.label ?? ''}`
      : `BGM：${project.assets.find((a) => project.bgm?.track.kind === 'asset' && a.id === project.bgm.track.assetId)?.name ?? ''}`
    : '';
  const bgmLane: TimelineLane | null =
    project.bgm && total > 0 ? { id: 'bgm', label: 'BGM', items: [{ key: 'bgm', id: 'bgm', from: 0, to: total, text: bgmName }], resizable: false } : null;
  const chapterLane: TimelineLane | null =
    project.publish.chapters.length > 0 && total > 0
      ? {
          id: 'chapters',
          label: 'チャプター',
          items: project.publish.chapters.map((c, i, list) => ({
            key: `chapter#${i}`,
            id: `chapter#${i}`,
            from: Math.min(c.time, total),
            to: Math.min(total, list[i + 1]?.time ?? total),
            text: c.title,
          })),
          resizable: false,
        }
      : null;
  const lanes = [subtitleLane, imageLane, shapeLane, zoomLane, effectLane, bgmLane, chapterLane].filter((l): l is TimelineLane => l !== null);

  // しゃべっている範囲（BGM を小さくするため）。BGM を小さくする設定のときだけ計算する
  const speech = useMemo(() => {
    if (!project.bgm?.duck) return [];
    const levels = new Map<string, VoiceLevel>();
    for (const s of used) {
      const level = analysis.voiceLevel(s.id, sourceAudio(project, s.id));
      if (level) levels.set(s.id, level);
    }
    return speechOnTimeline(project, levels);
  }, [project.bgm?.duck, project.clips, project.audio, analysisReady ? 'ready' : levelsTick]);

  /** 拡大する場所を選んでいる間は、その拡大をしない画面を見せる */
  const editingZoom = step === 'decorate' && decorateTab === 'zoom' && selected?.kind === 'zoom' ? selected.id : null;
  /** ドラッグで動かしている途中のものも映すため、プレビューにはこの作品を渡す */
  const shownProject = useMemo(() => {
    let p = project;
    if (boxDraft) p = moveBox(p, boxDraft, boxDraft.box);
    if (editingZoom) p = { ...p, zooms: p.zooms.filter((z) => z.id !== editingZoom) };
    return p;
  }, [project, boxDraft, editingZoom]);

  /** 字幕の端をタイムラインで動かしたとき：完成した動画の時刻を、録画の中の時刻に直す */
  const resizeSubtitle = (item: LaneItem, from: number, to: number) => {
    const p = projectRef.current;
    const sub = p.subtitles.find((x) => x.id === item.id);
    const loc = locateTime(p, (item.from + item.to) / 2);
    if (!sub || !loc) return;
    const toSource = (t: number) => loc.clip.start + (t - loc.clipStart) * (loc.clip.speed ?? 1);
    const start = Math.abs(from - item.from) > 1e-6 ? toSource(from) : sub.start;
    const end = Math.abs(to - item.to) > 1e-6 ? toSource(to) : sub.end;
    apply(setSubtitleTime(p, sub.id, start, end));
  };

  const exportSrt = async () => {
    try {
      const p = projectRef.current;
      if (await saveTextFile(`${p.name || '字幕'}.srt`, toSrt(p), SRT_FILE_KIND)) {
        setNotice({ kind: 'info', text: '字幕ファイル（.srt）を保存しました。YouTube Studio の「字幕」から読み込めます。' });
      }
    } catch (e) {
      setNotice({ kind: 'error', text: `字幕ファイルを保存できませんでした（${errorText(e)}）` });
    }
  };

  const importSrtFile = async () => {
    try {
      const file = await openTextFile(SRT_FILE_KIND);
      if (!file) return;
      const r = importSrt(projectRef.current, parseSrt(await file.text()));
      if (r.count === 0) {
        setNotice({ kind: 'error', text: '字幕ファイルから字幕を読み取れませんでした。' });
        return;
      }
      apply(r.project);
      setNotice({ kind: 'info', text: `${r.count}個の字幕を読み込みました。` });
    } catch (e) {
      setNotice({ kind: 'error', text: `字幕ファイルを読み込めませんでした（${errorText(e)}）` });
    }
  };

  // プレビュー
  useEffect(() => {
    const player = new Player(canvasRef.current!, registry, setPlayback);
    playerRef.current = player;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    playerRef.current?.setProject(shownProject);
  }, [shownProject]);

  useEffect(() => {
    playerRef.current?.setSpeech(speech);
  }, [speech]);

  useEffect(() => {
    playerRef.current?.reload();
  }, [openIds]);

  // 自動保存した作品を読み込む
  useEffect(() => {
    void (async () => {
      const work = await loadWork();
      // 作品で使っていない画像・曲の中身は消す
      void forgetAssetsExcept(new Set(work?.project.assets.map((a) => a.id) ?? []));
      if (work && work.project.sources.length > 0) {
        setHistory(createHistory(work.project));
        setHandles(work.handles);
        const opened: string[] = [];
        const needAsk: string[] = [];
        for (const s of usedSources(work.project)) {
          const handle = work.handles[s.id];
          if (!handle) continue;
          try {
            if (await ensureReadPermission(handle, false)) {
              const file = await handle.getFile();
              if (sameFile(s, file)) {
                registry.set(s.id, file);
                analysis.request(s, file);
                opened.push(s.id);
              }
            } else {
              needAsk.push(s.id);
            }
          } catch {
            // ファイルが見つからない
          }
        }
        setOpenIds(opened);
        setPermissionIds(needAsk);
      }
      setReady(true);
    })();
  }, []);

  // 自動保存
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const ids = new Set(project.sources.map((s) => s.id));
      const kept = Object.fromEntries(Object.entries(handles).filter(([id]) => ids.has(id)));
      saveWork({ project, handles: kept }).catch((e) => console.warn('自動保存できませんでした', e));
    }, 400);
    return () => clearTimeout(timer);
  }, [project, handles, ready]);

  // 書き出し中にタブを閉じようとしたら止める
  useEffect(() => {
    if (!exporting) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [exporting]);

  // 録画がなくなったら読み込みの手順へ戻る
  useEffect(() => {
    if (project.clips.length === 0 && step === 'export' && !exporting) setStep('import');
  }, [project.clips.length]);

  const addRecordings = async (picked: PickedFile[]) => {
    const infos: Omit<SourceInfo, 'id'>[] = [];
    const accepted: PickedFile[] = [];
    const errors: string[] = [];
    for (let i = 0; i < picked.length; i++) {
      setBusy(picked.length > 1 ? `録画を調べています（${i + 1}/${picked.length}）…` : '録画を調べています…');
      const result = await probeFile(picked[i].file);
      if (result.ok) {
        infos.push(result.info);
        accepted.push(picked[i]);
      } else {
        errors.push(`「${picked[i].file.name}」：${result.reason}`);
      }
    }
    setBusy(null);
    if (infos.length > 0) {
      const current = projectRef.current;
      const next = addSources(current, infos);
      const added = next.sources.slice(current.sources.length);
      const newHandles: Record<string, FileSystemFileHandle> = {};
      added.forEach((s, i) => {
        registry.set(s.id, accepted[i].file);
        analysis.request(s, accepted[i].file);
        const handle = accepted[i].handle;
        if (handle) newHandles[s.id] = handle;
      });
      setHandles((h) => ({ ...h, ...newHandles }));
      setOpenIds((ids) => [...ids, ...added.map((s) => s.id)]);
      apply(next);
      setStep('import');
      // 音が複数入っている録画は、どれが声かを選んでもらう
      const multi = added.find((s) => s.audioTrackCount > 1);
      if (multi) setAudioFor(multi.id);
    }
    if (errors.length > 0) setNotice({ kind: 'error', text: errors.join('\n') });
    else if (infos.length > 0) setNotice({ kind: 'info', text: `${infos.length}本の録画を入れました。` });
  };

  const handlePicked = async (picked: PickedFile[]) => {
    if (picked.length === 0) return;
    const projectFile = picked.find((p) => isProjectFileName(p.file.name));
    if (projectFile) {
      await openProjectFile(projectFile.file);
      return;
    }
    const recordings = picked.filter((p) => isRecordingFileName(p.file.name) || p.file.type.startsWith('video/'));
    if (recordings.length === 0) {
      setNotice({ kind: 'error', text: '読み込めるのは録画（MP4・MOV・MKV・WebM）と、テロッパの作品ファイルです。' });
      return;
    }
    await addRecordings(recordings);
  };

  const pick = async () => {
    if (exporting) return;
    try {
      await handlePicked(await pickRecordings());
    } catch (e) {
      setNotice({ kind: 'error', text: `録画を選べませんでした（${errorText(e)}）` });
    }
  };

  /** 許可をもらって録画を開き直す */
  const allow = async () => {
    const current = projectRef.current;
    const opened: string[] = [];
    for (const id of permissionIds) {
      const source = current.sources.find((s) => s.id === id);
      const handle = handlesRef.current[id];
      if (!source || !handle) continue;
      try {
        if (await ensureReadPermission(handle, true)) {
          const file = await handle.getFile();
          if (sameFile(source, file)) {
            registry.set(id, file);
            analysis.request(source, file);
            opened.push(id);
          }
        }
      } catch {
        // 見つからなければ選び直してもらう
      }
    }
    setPermissionIds([]);
    setOpenIds((ids) => [...ids, ...opened]);
    if (opened.length < permissionIds.length) {
      setNotice({ kind: 'error', text: '開けなかった録画があります。「録画を選び直す」から選んでください。' });
    }
  };

  /** 見つからない録画を選び直してもらう */
  const locate = async () => {
    let picked: PickedFile[];
    try {
      picked = await pickRecordings();
    } catch (e) {
      setNotice({ kind: 'error', text: `録画を選べませんでした（${errorText(e)}）` });
      return;
    }
    if (picked.length === 0) return;
    let current = projectRef.current;
    const stillMissing = usedSources(current).filter((s) => !registry.has(s.id));
    const opened: string[] = [];
    const newHandles: Record<string, FileSystemFileHandle> = {};
    const unused = [...picked];
    for (const source of stillMissing) {
      let index = unused.findIndex((p) => sameFile(source, p.file));
      // 名前や大きさが変わっていても、1本ずつなら長さが足りるかで判断する
      if (index < 0 && stillMissing.length === 1 && unused.length === 1) {
        const result = await probeFile(unused[0].file);
        const needed = Math.max(...current.clips.filter((c) => c.sourceId === source.id).map((c) => c.end));
        if (result.ok && result.info.endTime >= needed - 0.05) {
          current = updateSource(current, source.id, {
            name: result.info.name,
            size: result.info.size,
            lastModified: result.info.lastModified,
          });
          index = 0;
        }
      }
      if (index < 0) continue;
      const [p] = unused.splice(index, 1);
      registry.set(source.id, p.file);
      analysis.request(source, p.file);
      opened.push(source.id);
      if (p.handle) newHandles[source.id] = p.handle;
    }
    if (current !== projectRef.current) setHistory((h) => ({ ...h, present: current }));
    setHandles((h) => ({ ...h, ...newHandles }));
    setOpenIds((ids) => [...ids, ...opened]);
    setPermissionIds((ids) => ids.filter((id) => !opened.includes(id)));
    const left = stillMissing.length - opened.length;
    if (left > 0) {
      const names = stillMissing.filter((s) => !opened.includes(s.id)).map((s) => `「${s.name}」`);
      setNotice({ kind: 'error', text: `選んだファイルの中に、${names.join('・')} が見つかりませんでした。` });
    } else {
      setNotice({ kind: 'info', text: '録画を開き直しました。続きから作業できます。' });
    }
  };

  const openProjectFile = async (file: File) => {
    const result = parseProject(await file.text());
    if (!result.ok) {
      setNotice({ kind: 'error', text: result.error });
      return;
    }
    if (projectRef.current.clips.length > 0 && !confirm('いまの作品を閉じて、選んだ作品ファイルを開きますか？（いまの作品は、ファイルに保存していなければ消えます）')) {
      return;
    }
    const missingAssets = await decodeAssets(result.project.assets, result.assetData);
    void forgetAssetsExcept(new Set(result.project.assets.map((a) => a.id)));
    registry.clear();
    setHistory(createHistory(result.project));
    setHandles({});
    setOpenIds([]);
    setPermissionIds([]);
    setSelection(null);
    setSelected(null);
    setStep('import');
    playerRef.current?.seek(0);
    setNotice({
      kind: missingAssets.length > 0 ? 'error' : 'info',
      text:
        '作品ファイルを開きました。続けて「録画を選び直す」から、使っていた録画を選んでください。' +
        (missingAssets.length > 0 ? `\n作品ファイルに入っていなかった画像・曲があります：${missingAssets.map((a) => a.name).join('、')}` : ''),
    });
  };

  const openProject = async () => {
    if (exporting) return;
    try {
      const file = await openTextFile();
      if (file) await openProjectFile(file);
    } catch (e) {
      setNotice({ kind: 'error', text: `作品ファイルを開けませんでした（${errorText(e)}）` });
    }
  };

  const saveProject = async () => {
    if (projectRef.current.sources.length === 0) {
      setNotice({ kind: 'info', text: 'まだ録画が入っていないので、保存するものがありません。' });
      return;
    }
    try {
      const p = dropUnusedAssets(projectRef.current);
      const { data, missing: lost } = await encodeAssets(p.assets);
      const saved = await saveTextFile(`${p.name || '作品'}${PROJECT_FILE_EXTENSION}`, serializeProject(p, new Date().toISOString(), data));
      if (saved) {
        setNotice(
          lost.length > 0
            ? { kind: 'error', text: `作品ファイルに保存しましたが、見つからない画像・曲がありました：${lost.map((a) => a.name).join('、')}` }
            : { kind: 'info', text: '作品ファイルに保存しました（画像と曲も入っています）。録画のファイルは別に残しておいてください。' },
        );
      }
    } catch (e) {
      setNotice({ kind: 'error', text: `保存できませんでした（${errorText(e)}）` });
    }
  };

  const newProject = () => {
    if (exporting) return;
    if (projectRef.current.sources.length > 0 && !confirm('新しい作品を作りますか？ いまの作品は消えます（ファイルに保存しておけば、あとで開けます）。')) {
      return;
    }
    registry.clear();
    void forgetAssetsExcept(new Set());
    setHistory(createHistory(emptyProject()));
    setHandles({});
    setOpenIds([]);
    setPermissionIds([]);
    setSelection(null);
    setSelected(null);
    setStep('import');
  };

  const deleteSelection = () => {
    if (!selection || exporting) return;
    const next = deleteRange(projectRef.current, selection[0], selection[1]);
    setSelection(null);
    if (next !== projectRef.current) {
      apply(next);
      playerRef.current?.seek(selection[0]);
    }
  };

  const doUndo = () => {
    if (exporting) return;
    setSelection(null);
    setHistory((h) => undo(h));
  };

  const doRedo = () => {
    if (exporting) return;
    setSelection(null);
    setHistory((h) => redo(h));
  };

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    setTheme(next);
    applyTheme(next);
    saveThemePreference(next);
  };

  const goExport = () => {
    if (project.clips.length === 0 || missing.length > 0) return;
    playerRef.current?.pause();
    setSelection(null);
    setStep('export');
  };

  const goStep = (id: StepId) => {
    setPendingCut(null);
    stopPreview();
    if (id !== 'decorate') setSelected(null);
    if (id === 'export') return goExport();
    if (id !== 'import' && (project.clips.length === 0 || missing.length > 0)) return;
    setSelection(null);
    setLastCut(null);
    setKept(new Set());
    setLastFillerCut(null);
    setKeptFillers(new Set());
    setNormalized(null);
    setStep(id);
  };

  /** 無音カット：まとめて切る */
  const cutSilences = () => {
    const length = candidatesLength(candidates, kept);
    const next = applyCandidates(projectRef.current, candidates, kept);
    if (next === projectRef.current) return;
    playerRef.current?.pause();
    apply(next);
    setKept(new Set());
    setLastCut(length);
  };

  const toggleKept = (id: string) =>
    setKept((k) => {
      const n = new Set(k);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** 飾り：画像を選んで置く（なぞった範囲、なければ再生位置から数秒） */
  const addImageFile = async () => {
    let file: File | null;
    try {
      file = await pickMediaFile(IMAGE_FILE_KIND);
    } catch (e) {
      setNotice({ kind: 'error', text: `画像を選べませんでした（${errorText(e)}）` });
      return;
    }
    if (!file) return;
    const result = await readImageFile(file);
    if (!result.ok) {
      setNotice({ kind: 'error', text: `「${file.name}」：${result.reason}` });
      return;
    }
    await keepAsset(result.asset.id, result.blob);
    const p = projectRef.current;
    const now = playerRef.current?.currentTime() ?? 0;
    const [from, to] = selection ?? [now, Math.min(totalDuration(p), now + NEW_IMAGE_SECONDS)];
    const r = addImage(p, result.asset, from, to, 'top-right', FRAME_ASPECT);
    if (!r.id) {
      setNotice({ kind: 'info', text: '画像を出す時間がありません。動画の終わりより前の位置で置いてください。' });
      return;
    }
    apply(r.project);
    setSelection(null);
    setSelected({ kind: 'image', id: r.id });
    playerRef.current?.seek(from);
  };

  /** なぞった範囲、なければ再生位置から seconds 秒 */
  const rangeOrNow = (seconds: number): [number, number] => {
    const now = playerRef.current?.currentTime() ?? 0;
    return selection ?? [now, Math.min(totalDuration(projectRef.current), now + seconds)];
  };

  const addShapeAt = (kind: ShapeKind) => {
    const [from, to] = rangeOrNow(NEW_SHAPE_SECONDS);
    const r = addShape(projectRef.current, kind, from, to, FRAME_ASPECT);
    if (!r.id) return;
    apply(r.project);
    setSelection(null);
    setSelected({ kind: 'shape', id: r.id });
    playerRef.current?.seek(from);
  };

  const addZoomAt = () => {
    const [from, to] = rangeOrNow(NEW_ZOOM_SECONDS);
    const r = addZoom(projectRef.current, from, to);
    if (!r.id) return;
    apply(r.project);
    setSelection(null);
    setDecorateTab('zoom');
    setSelected({ kind: 'zoom', id: r.id });
    // 寄り終わったあたりを見せる
    playerRef.current?.seek(Math.min(to, from + 0.5));
  };

  /** 出す時間を、タイムラインの端のドラッグで変える（画像・矢印や枠・拡大） */
  const resizeRanged = (lane: string, item: LaneItem, from: number, to: number) => {
    const p = projectRef.current;
    const pieces = (lane === 'images' ? imagesOnTimeline(p) : lane === 'shapes' ? shapesOnTimeline(p) : zoomsOnTimeline(p)).filter((x) => x.id === item.id);
    if (pieces.length === 0) return;
    const start = Math.abs(from - item.from) > 1e-6 ? from : pieces[0].from;
    const end = Math.abs(to - item.to) > 1e-6 ? to : pieces[pieces.length - 1].to;
    const set = lane === 'images' ? setImageTime : lane === 'shapes' ? setShapeTime : setZoomTime;
    apply(set(p, item.id, start, end));
  };

  const removeSelected = (target: Selected) => {
    const p = projectRef.current;
    apply(target.kind === 'image' ? removeImage(p, target.id) : target.kind === 'shape' ? removeShape(p, target.id) : removeZoom(p, target.id));
    if (selected?.id === target.id) setSelected(null);
  };

  const selectItem = (target: Selected | null) => {
    setSelected(target);
    if (!target) return;
    setDecorateTab(target.kind);
    const list = target.kind === 'image' ? timelineImages : target.kind === 'shape' ? timelineShapes : timelineZooms;
    const piece = list.find((x) => x.id === target.id);
    const t = playerRef.current?.currentTime() ?? 0;
    if (piece && !(t >= piece.from && t < piece.to)) playerRef.current?.seek(target.kind === 'zoom' ? Math.min(piece.to, piece.from + 0.5) : piece.from);
  };


  /** BGM：自分で用意した曲を選ぶ */
  const pickMusic = async () => {
    let file: File | null;
    try {
      file = await pickMediaFile(MUSIC_FILE_KIND);
    } catch (e) {
      setNotice({ kind: 'error', text: `曲を選べませんでした（${errorText(e)}）` });
      return;
    }
    if (!file) return;
    setBusy('曲を調べています…');
    const result = await readMusicFile(file);
    setBusy(null);
    if (!result.ok) {
      setNotice({ kind: 'error', text: `「${file.name}」：${result.reason}` });
      return;
    }
    await keepAsset(result.asset.id, result.blob);
    const p = addAsset(projectRef.current, result.asset);
    const bgm: BgmSetting = { track: { kind: 'asset', assetId: result.asset.id }, volume: p.bgm?.volume ?? DEFAULT_BGM_VOLUME, duck: p.bgm?.duck ?? true };
    apply({ ...p, bgm });
    setNotice({ kind: 'info', text: `「${file.name}」を BGM にしました。` });
  };

  const previewMusic = (track: BgmSetting['track']) => {
    const key = track.kind === 'builtin' ? `music:${track.id}` : `music:${track.assetId}`;
    setPreviewing(key);
    const buffer = track.kind === 'builtin' ? builtinMusic(track.id) : assetMusic(track.assetId);
    void playerRef.current?.preview(buffer, 15, 0.7, () => setPreviewing((k) => (k === key ? null : k)));
  };

  const previewSound = (sound: SoundId) => {
    const key = `sound:${sound}`;
    setPreviewing(key);
    void playerRef.current?.preview(effectBuffer(sound), 3, Math.max(0.3, projectRef.current.effectsVolume), () =>
      setPreviewing((k) => (k === key ? null : k)),
    );
  };

  function stopPreview() {
    if (previewing) playerRef.current?.stopListening();
    setPreviewing(null);
  }

  /** 書き出しに渡す画像・曲の中身 */
  const exportAssets = async () => {
    const p = projectRef.current;
    const blobs: Record<string, Blob> = {};
    const lost: string[] = [];
    for (const id of usedAssetIds(p)) {
      const blob = await assetBlob(id);
      if (blob) blobs[id] = blob;
      else lost.push(p.assets.find((a) => a.id === id)?.name ?? id);
    }
    return { blobs, missing: lost };
  };

  /** 音の設定を変える（元に戻せる操作として記録する） */
  const changeAudio = (sourceId: string, audio: SourceAudio) => apply(setSourceAudio(projectRef.current, sourceId, audio));

  /** 口ぐせの候補をまとめて切る */
  const cutFillers = () => {
    const targets = fillers.filter((c) => !keptFillers.has(c.id));
    if (targets.length === 0) return;
    const next = removeSourceRanges(projectRef.current, targets);
    if (next === projectRef.current) return;
    playerRef.current?.pause();
    apply(next);
    setKeptFillers(new Set());
    setLastFillerCut(fillerLength);
  };

  /** 声の大きさをそろえる（元に戻せる） */
  const normalize = () => {
    const p = projectRef.current;
    const loudness = new Map(usedSources(p).map((s) => [s.id, analysis.voiceLoudness(s.id, sourceAudio(p, s.id)) ?? null]));
    const r = normalizeVoices(p, loudness);
    if (r.changes.length > 0) apply(r.project);
    setNormalized(r.changes.map((c) => ({ name: p.sources.find((s) => s.id === c.sourceId)?.name ?? '', db: c.db })));
  };

  /** 雑音を減らす。はじめて使う録画は、静かな部分から雑音の音色を調べる */
  const changeDenoise = async (strength: DenoiseStrength | 'off') => {
    let p = projectRef.current;
    const failed: string[] = [];
    for (const s of usedSources(p)) {
      const audio = sourceAudio(p, s.id);
      if (strength === 'off') {
        if (audio.denoise) p = setSourceAudio(p, s.id, { ...audio, denoise: null });
        continue;
      }
      if (audio.denoise) {
        if (audio.denoise.strength !== strength) p = setSourceAudio(p, s.id, { ...audio, denoise: { ...audio.denoise, strength } });
        continue;
      }
      const level = analysis.voiceLevel(s.id, audio);
      const ranges = level ? quietRanges(level) : [];
      setBusy('雑音の音色を調べています…');
      const profile = ranges.length > 0 ? await measureSourceNoise(registry, s.id, voiceTracks(audio), ranges).catch(() => null) : null;
      setBusy(null);
      if (!profile) {
        failed.push(s.name);
        continue;
      }
      p = setSourceAudio(p, s.id, { ...audio, denoise: { strength, profile } });
    }
    if (p !== projectRef.current) apply(p);
    if (failed.length > 0) {
      setNotice({ kind: 'error', text: `しゃべっていない静かな部分が見つからず、雑音の音色を調べられませんでした：${failed.join('、')}` });
    }
  };

  const listen = async (track: number, from: number) => {
    if (!audioFor) return;
    setListening(track);
    await playerRef.current?.listen(audioFor, track, from, LISTEN_SECONDS);
    setTimeout(() => setListening((l) => (l === track ? null : l)), LISTEN_SECONDS * 1000);
  };

  const stopListening = () => {
    playerRef.current?.stopListening();
    setListening(null);
  };

  // キーボード操作
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    if (showKeys || showAbout || audioFor || showAi || showTypos) return;
    const action = actionForKey(e, isTyping(e.target));
    if (!action) return;
    const player = playerRef.current;
    e.preventDefault();
    switch (action) {
      case 'playPause':
        player?.toggle();
        break;
      case 'back':
        player?.seek(player.currentTime() - STEP_SECONDS);
        break;
      case 'forward':
        player?.seek(player.currentTime() + STEP_SECONDS);
        break;
      case 'backLong':
        player?.seek(player.currentTime() - LONG_STEP_SECONDS);
        break;
      case 'forwardLong':
        player?.seek(player.currentTime() + LONG_STEP_SECONDS);
        break;
      case 'deleteSelection':
        deleteSelection();
        break;
      case 'clearSelection':
        setSelection(null);
        break;
      case 'undo':
        doUndo();
        break;
      case 'redo':
        doRedo();
        break;
      case 'saveFile':
        void saveProject();
        break;
      case 'zoomIn':
        timelineControl.current?.zoomIn();
        break;
      case 'zoomOut':
        timelineControl.current?.zoomOut();
        break;
      case 'showKeys':
        setShowKeys(true);
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ファイルを画面に落として読み込む
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files') || exporting) return;
    e.preventDefault();
    setDragOver(true);
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer || exporting) return;
    try {
      await handlePicked(await droppedFiles(e.dataTransfer));
    } catch (err) {
      setNotice({ kind: 'error', text: `読み込めませんでした（${errorText(err)}）` });
    }
  };

  const message = guideMessage(project, { step, hasSelection: selection !== null, missingSources: missing.length });
  const joinMarks = useMemo(() => {
    const starts = clipStarts(project);
    const index = new Map(project.clips.map((c, i) => [c.id, i]));
    return activeJoinFades(project).flatMap((id) => (index.has(id) ? [starts[index.get(id)!]] : []));
  }, [project.clips, project.joinFades]);
  /** プレビューの上で動かせるもの（飾りの手順で選んでいて、いま映っているもの） */
  const handle = step === 'decorate' && selected && !playback.playing ? boxHandleFor(project, boxDraft, selected, playback.time) : null;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div
      class="app"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <header class="topbar">
        <div class="brand">
          テロッパ<small>（仮）{APP_VERSION_SHORT}</small>
        </div>
        <nav class="steps" aria-label="手順">
          {STEPS.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 && <span class="step-arrow">→</span>}
              <button
                class={`step ${i === stepIndex ? 'active' : ''}`}
                aria-current={i === stepIndex ? 'step' : undefined}
                aria-label={s.label}
                title={s.label}
                disabled={exporting || (s.id !== 'import' && (project.clips.length === 0 || missing.length > 0))}
                onClick={() => goStep(s.id)}
              >
                <span class="num">{i + 1}</span>
                <span class="step-label">{s.label}</span>
              </button>
            </Fragment>
          ))}
        </nav>
        <div class="tools">
          <button class="btn icon ghost" title="元に戻す（Ctrl+Z）" aria-label="元に戻す" onClick={doUndo} disabled={!canUndo(history) || exporting}>
            <Icon name="undo" />
          </button>
          <button class="btn icon ghost" title="やり直す（Ctrl+Y）" aria-label="やり直す" onClick={doRedo} disabled={!canRedo(history) || exporting}>
            <Icon name="redo" />
          </button>
          <span class="tool-sep" />
          <button class="btn small ghost" title="作品をファイルに保存（Ctrl+S）" aria-label="保存" onClick={saveProject}>
            <Icon name="save" />
            <span class="tool-label">保存</span>
          </button>
          <button class="btn small ghost" title="保存した作品ファイルを開く" aria-label="開く" onClick={openProject} disabled={exporting}>
            <Icon name="open" />
            <span class="tool-label">開く</span>
          </button>
          <button class="btn small ghost" title="新しい作品を作る" aria-label="新しく" onClick={newProject} disabled={exporting}>
            <Icon name="new" />
            <span class="tool-label">新しく</span>
          </button>
          <span class="tool-sep" />
          <button class="btn icon ghost" title={`画面の明るさ：${THEME_LABELS[theme]}（押すと切り替え）`} aria-label={`画面の明るさ：${THEME_LABELS[theme]}`} onClick={cycleTheme}>
            <Icon name="theme" />
          </button>
          <button class="btn small ghost" title="AI に調べものや台本の下書きを手伝ってもらう" aria-label="AIに聞く" onClick={() => setShowAi(true)}>
            <Icon name="ai" />
            <span class="tool-label">AIに聞く</span>
          </button>
          <button class="btn icon ghost" title="キーの一覧（?）" aria-label="キーの一覧" onClick={() => setShowKeys(true)}>
            <Icon name="keys" />
          </button>
          <button class="btn icon ghost" title="このソフトについて（個人情報の扱い・ライセンス）" aria-label="このソフトについて" onClick={() => setShowAbout(true)}>
            <Icon name="info" />
          </button>
        </div>
      </header>

      <main class="workspace">
        <section class="stage" aria-label="プレビュー">
          <div class="preview-box" ref={boxRef}>
            <canvas ref={canvasRef} onClick={() => playerRef.current?.toggle()} title="押すと再生・一時停止（スペース）" />
            {handle && selected && boxRef.current && (
              <BoxHandles
                {...handle}
                container={boxRef.current}
                frameAspect={FRAME_ASPECT}
                onDraft={(box) => setBoxDraft({ ...selected, box })}
                onCommit={(box) => {
                  setBoxDraft(null);
                  apply(moveBox(projectRef.current, selected, box));
                }}
              />
            )}
            {total === 0 && (
              <div class="preview-empty">
                <div>
                  <Icon name="film" />
                  <div>録画を入れると、ここに映ります</div>
                </div>
              </div>
            )}
          </div>
          <div class="controls">
            <button
              class="btn primary"
              onClick={() => playerRef.current?.toggle()}
              disabled={total === 0}
              title={playback.playing ? '一時停止（スペース）' : '再生（スペース）'}
            >
              <Icon name={playback.playing ? 'pause' : 'play'} />
              {playback.playing ? '一時停止' : '再生'}
            </button>
            <span class="time">
              <strong>{formatClock(playback.time, true)}</strong> / {formatClock(total, true)}
            </span>
          </div>
        </section>

        {step === 'silence' ? (
          <SilencePanel
            tab={silenceTab}
            onTab={(tab) => {
              setSilenceTab(tab);
              setLastCut(null);
              setLastFillerCut(null);
            }}
            fillers={{
              candidates: fillers,
              kept: keptFillers,
              length: fillerLength,
              lastCut: lastFillerCut,
              onCut: cutFillers,
              onSeek: (t) => playerRef.current?.seek(t),
              onToggle: (id) =>
                setKeptFillers((k) => {
                  const n = new Set(k);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                }),
            }}
            progress={analysisProgress}
            ready={analysisReady}
            count={candidates.length}
            length={candidatesLength(candidates, kept)}
            keptCount={candidates.filter((c) => kept.has(c.id)).length}
            strength={strength}
            lastCut={lastCut}
            unconfirmed={unconfirmed}
            onStrength={(i) => {
              setStrength(i);
              setKept(new Set());
            }}
            onCut={cutSilences}
            onNext={() => goStep('subtitles')}
            onPlayResult={() => {
              playerRef.current?.seek(0);
              void playerRef.current?.play();
            }}
            onAudioSettings={setAudioFor}
          />
        ) : step === 'subtitles' ? (
          <SubtitlePanel
            project={project}
            items={timelineSubtitles}
            currentId={currentSubtitle?.id ?? null}
            phase={transcription.phase}
            modelId={transcription.modelId}
            usable={transcription.usable}
            remaining={transcription.remaining}
            analysisReady={analysisReady}
            analysisProgress={analysisProgress}
            onModel={transcription.setModelId}
            onTranscribe={() => {
              playerRef.current?.pause();
              transcription.request();
            }}
            onConsent={transcription.consent}
            onCancelConsent={transcription.cancelConsent}
            onCancel={transcription.cancel}
            onSeek={(t) => playerRef.current?.seek(t)}
            onText={(id, text) => apply(setSubtitleText(projectRef.current, id, text))}
            onSplit={(id, at) => apply(splitSubtitle(projectRef.current, id, at))}
            onMerge={(id) => apply(mergeWithNext(projectRef.current, id))}
            onRemove={(id) => apply(removeSubtitle(projectRef.current, id))}
            pendingCutId={pendingCut}
            onAskCut={(id) => {
              setPendingCut(id);
              const piece = timelineSubtitles.find((x) => x.id === id);
              if (piece) playerRef.current?.seek(piece.from);
            }}
            onConfirmCut={() => {
              if (pendingCut) apply(cutSubtitle(projectRef.current, pendingCut));
              setPendingCut(null);
            }}
            onCancelCut={() => setPendingCut(null)}
            onAdd={() => {
              const r = addSubtitleAt(projectRef.current, playerRef.current?.currentTime() ?? 0, '（ここに文字を入れる）');
              if (r.id) apply(r.project);
              else setNotice({ kind: 'info', text: 'ここにはすでに字幕があるか、字幕を足す余地がありません。' });
            }}
            onStyle={(style) => apply({ ...projectRef.current, subtitleStyle: style })}
            onExportSrt={exportSrt}
            onImportSrt={importSrtFile}
            onFixTypos={() => setShowTypos(true)}
            onNext={() => goStep('decorate')}
          />
        ) : step === 'decorate' ? (
          <DecoratePanel
            project={project}
            tab={decorateTab}
            selected={selected}
            selection={selection}
            images={timelineImages}
            shapes={timelineShapes.map((g) => ({ ...g, name: shapeName(g.kind) }))}
            zooms={timelineZooms.map((z) => ({ ...z, name: `${z.factor.toFixed(1)}倍の拡大` }))}
            join={nearestJoin(project, playback.time)}
            speed={speedAt(project, playback.time)}
            onTab={(tab) => {
              setDecorateTab(tab);
              if (selected && selected.kind !== tab) setSelected(null);
            }}
            onSelect={selectItem}
            onAddImage={addImageFile}
            onImagePlace={(id, place) => apply(setImagePlace(projectRef.current, id, place, FRAME_ASPECT))}
            onAddShape={addShapeAt}
            onShapeStyle={(id, style) => apply(setShapeStyle(projectRef.current, id, style))}
            onShapePlace={(id, place) => apply(placeShape(projectRef.current, id, place, FRAME_ASPECT))}
            onAddZoom={addZoomAt}
            onZoomFactor={(id, f) => apply(setZoomFactor(projectRef.current, id, f))}
            onUseSelection={(target) => {
              if (!selection) return;
              const set = target.kind === 'image' ? setImageTime : target.kind === 'shape' ? setShapeTime : setZoomTime;
              apply(set(projectRef.current, target.id, selection[0], selection[1]));
              setSelection(null);
            }}
            onRemove={removeSelected}
            onSpeed={(speed) => {
              if (!selection) return;
              const next = setSpeed(projectRef.current, selection[0], selection[1], speed);
              setSelection(null);
              if (next !== projectRef.current) {
                apply(next);
                playerRef.current?.seek(selection[0]);
                setNotice({ kind: 'info', text: speed === 1 ? 'なぞった範囲を元の速さに戻しました。' : `なぞった範囲を${speed}倍の速さにしました。` });
              }
            }}
            onToggleJoin={(clipId) => apply(toggleJoinFade(projectRef.current, clipId))}
            onFadeSourceChanges={() => {
              const r = fadeSourceChanges(projectRef.current);
              if (r.count > 0) {
                apply(r.project);
                setNotice({ kind: 'info', text: `${r.count}か所のつなぎ目にフェードを入れました。` });
              } else {
                setNotice({ kind: 'info', text: '録画が切り替わるつなぎ目には、すでにフェードが入っています。' });
              }
            }}
            onEndFade={(on) => apply({ ...projectRef.current, endFade: on })}
            onNext={() => goStep('sound')}
          />
        ) : step === 'sound' ? (
          <SoundPanel
            project={project}
            tab={soundTab}
            onTab={(tab) => {
              setSoundTab(tab);
              stopPreview();
            }}
            voices={used.map((s) => ({
              id: s.id,
              name: s.name,
              gainDb: toDb(sourceAudio(project, s.id).voiceGain),
              loudness: analysis.voiceLoudness(s.id, sourceAudio(project, s.id)),
            }))}
            denoise={used.map((s) => sourceAudio(project, s.id).denoise?.strength).find((x) => x) ?? 'off'}
            normalized={normalized}
            onNormalize={normalize}
            onDenoise={(d) => void changeDenoise(d)}
            effects={timelineEffects}
            previewing={previewing}
            speechReady={analysisReady}
            onBgm={(bgm) => apply({ ...projectRef.current, bgm })}
            onPickMusic={pickMusic}
            onPreviewMusic={previewMusic}
            onPreviewSound={previewSound}
            onStopPreview={stopPreview}
            onAddEffect={(sound) => {
              const r = addEffect(projectRef.current, playerRef.current?.currentTime() ?? 0, sound);
              if (r.id) apply(r.project);
            }}
            onRemoveEffect={(id) => apply(removeEffect(projectRef.current, id))}
            onEffectsVolume={(v) => apply({ ...projectRef.current, effectsVolume: v })}
            onSeek={(t) => playerRef.current?.seek(t)}
            onNext={goExport}
          />
        ) : step === 'export' ? (
          <ExportPanel
            project={project}
            files={() => registry.allFiles()}
            assets={exportAssets}
            speech={speech}
            speechReady={analysisReady}
            speechProgress={analysisProgress}
            onBack={() => setStep('import')}
            onRunningChange={setExporting}
            onExportSrt={exportSrt}
            onPublish={() => goStep('publish')}
          />
        ) : step === 'publish' ? (
          <PublishPanel
            project={project}
            tab={publishTab}
            time={playback.time}
            onTab={setPublishTab}
            onChange={(publish) => apply({ ...projectRef.current, publish })}
            onSeek={(t) => playerRef.current?.seek(t)}
            notify={(text) => setNotice({ kind: 'info', text })}
          />
        ) : (
          <GuidePanel
            message={message}
            project={project}
            hasSelection={selection !== null}
            missing={missing}
            needPermission={permissionIds.filter((id) => missingSet.has(id)).length}
            onPick={pick}
            onAllow={allow}
            onLocate={locate}
            onDelete={deleteSelection}
            onClearSelection={() => setSelection(null)}
            onNext={() => goStep('silence')}
            nextLabel="次へ：「間」を切る"
            onAudioSettings={setAudioFor}
          />
        )}
      </main>

      <section class="timeline-area" aria-label="タイムライン">
        <Timeline
          project={project}
          time={playback.time}
          playing={playback.playing}
          selection={selection}
          waveform={(id) => analysis.waveform(id, sourceAudio(project, id))?.peaks}
          binSeconds={analysis.binSeconds}
          levelsTick={levelsTick}
          marks={
            step === 'silence' && silenceTab === 'fillers'
              ? fillers.map((c) => ({ id: c.id, from: c.from, to: c.to, kept: keptFillers.has(c.id) }))
              : step === 'silence' && lastCut === null
              ? marks
              : step === 'subtitles' && pendingCut
                ? timelineSubtitles.filter((x) => x.id === pendingCut).map((x) => ({ id: x.key, from: x.from, to: x.to, kept: false }))
                : undefined
          }
          onToggleMark={
            step !== 'silence'
              ? undefined
              : silenceTab === 'fillers'
                ? (id) =>
                    setKeptFillers((k) => {
                      const n = new Set(k);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    })
                : toggleKept
          }
          lanes={lanes}
          onLaneItemClick={(lane, id, t) => {
            playerRef.current?.seek(t);
            if (lane === 'images' || lane === 'shapes' || lane === 'zooms') {
              if (step !== 'decorate') goStep('decorate');
              const kind = lane === 'images' ? 'image' : lane === 'shapes' ? 'shape' : 'zoom';
              setSelected({ kind, id });
              setDecorateTab(kind);
            }
          }}
          onLaneItemResize={(lane, item, from, to) => (lane === 'subtitles' ? resizeSubtitle(item, from, to) : resizeRanged(lane, item, from, to))}
          joinMarks={joinMarks}
          selectionAction={
            step !== 'decorate'
              ? undefined
              : decorateTab === 'image'
                ? { label: 'ここに画像を置く', icon: 'image', onClick: addImageFile }
                : decorateTab === 'zoom'
                  ? { label: 'ここを拡大する', icon: 'plus', onClick: addZoomAt }
                  : undefined
          }
          missing={missingSet}
          disabled={exporting}
          control={timelineControl}
          onSeek={(t) => playerRef.current?.seek(t)}
          onSelect={setSelection}
          onDelete={deleteSelection}
          onMove={(from, to) => apply(moveClip(projectRef.current, from, to))}
        />
      </section>

      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      {showKeys && <KeysDialog onClose={() => setShowKeys(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showAi && <AiDialog topic={project.publish.title || project.name} onClose={() => setShowAi(false)} />}
      {showTypos && (
        <TypoDialog
          project={project}
          onClose={() => setShowTypos(false)}
          onApply={(changes) => {
            let p = projectRef.current;
            for (const c of changes) p = setSubtitleText(p, c.id, breakLines(c.text));
            apply(p);
            setNotice({ kind: 'info', text: `${changes.length}行の字幕を直しました。気に入らなければ「元に戻す」で戻せます。` });
          }}
        />
      )}
      {audioFor && project.sources.some((s) => s.id === audioFor) && (
        <AudioDialog
          source={project.sources.find((s) => s.id === audioFor)!}
          audio={sourceAudio(project, audioFor)}
          levels={(i) => analysis.track(audioFor, i)}
          binSeconds={analysis.binSeconds}
          listening={listening}
          onListen={listen}
          onStopListening={stopListening}
          onChange={(a) => changeAudio(audioFor, a)}
          onClose={() => setAudioFor(null)}
        />
      )}
      {dragOver && <DropOverlay />}
      {busy && <BusyOverlay text={busy} />}
    </div>
  );
}
