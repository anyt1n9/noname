// 画面全体。作品のデータ・再生・保存をまとめる
import { Fragment } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { guideMessage } from '../core/guide';
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from '../core/history';
import { actionForKey } from '../core/keys';
import { addSources, emptyProject, updateSource, usedSources, type Project, type SourceInfo } from '../core/project';
import { parseProject, PROJECT_FILE_EXTENSION, serializeProject } from '../core/project-file';
import { formatClock } from '../core/time';
import { deleteRange, moveClip, totalDuration } from '../core/timeline';
import { LONG_STEP_SECONDS, STEP_SECONDS } from '../data/keys';
import { STEPS, type StepId } from '../data/steps';
import {
  droppedFiles,
  ensureReadPermission,
  isProjectFileName,
  isRecordingFileName,
  openTextFile,
  pickRecordings,
  saveTextFile,
  type PickedFile,
} from '../media/files';
import { PeaksStore } from '../media/peaks';
import { Player, type PlayerState } from '../media/player';
import { errorText, probeFile } from '../media/probe';
import { SourceRegistry } from '../media/registry';
import { loadWork, saveWork } from '../media/storage';
import { AboutDialog, BusyOverlay, DropOverlay, KeysDialog, Toast, type Notice } from './Dialogs';
import { ExportPanel } from './ExportPanel';
import { GuidePanel } from './GuidePanel';
import { Icon } from './icons';
import { applyTheme, loadThemePreference, saveThemePreference, THEME_LABELS, THEME_ORDER, type ThemePreference } from './theme';
import { Timeline, type TimelineControl } from './Timeline';

/** 録画のファイルが、作品に記録した録画と同じものか */
function sameFile(source: SourceInfo, file: File): boolean {
  return file.name === source.name && file.size === source.size;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
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
  const [peaksTick, setPeaksTick] = useState(0);
  const peaks = useMemo(() => new PeaksStore(() => setPeaksTick((t) => t + 1)), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  /** 作品を変える（元に戻せるように記録する） */
  const apply = useCallback((next: Project) => setHistory((h) => record(h, next)), []);

  // プレビュー
  useEffect(() => {
    const player = new Player(canvasRef.current!, registry, setPlayback);
    playerRef.current = player;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    playerRef.current?.setProject(project);
  }, [project]);

  useEffect(() => {
    playerRef.current?.refresh();
  }, [openIds]);

  // 自動保存した作品を読み込む
  useEffect(() => {
    void (async () => {
      const work = await loadWork();
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
                peaks.request(s, file);
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
        peaks.request(s, accepted[i].file);
        const handle = accepted[i].handle;
        if (handle) newHandles[s.id] = handle;
      });
      setHandles((h) => ({ ...h, ...newHandles }));
      setOpenIds((ids) => [...ids, ...added.map((s) => s.id)]);
      apply(next);
      setStep('import');
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
            peaks.request(source, file);
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
      peaks.request(source, p.file);
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
    registry.clear();
    setHistory(createHistory(result.project));
    setHandles({});
    setOpenIds([]);
    setPermissionIds([]);
    setSelection(null);
    setStep('import');
    playerRef.current?.seek(0);
    setNotice({ kind: 'info', text: '作品ファイルを開きました。続けて「録画を選び直す」から、使っていた録画を選んでください。' });
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
      const p = projectRef.current;
      const saved = await saveTextFile(`${p.name || '作品'}${PROJECT_FILE_EXTENSION}`, serializeProject(p, new Date().toISOString()));
      if (saved) setNotice({ kind: 'info', text: '作品ファイルに保存しました。録画のファイルは別に残しておいてください。' });
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
    setHistory(createHistory(emptyProject()));
    setHandles({});
    setOpenIds([]);
    setPermissionIds([]);
    setSelection(null);
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

  // キーボード操作
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    if (showKeys || showAbout) return;
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
          テロッパ<small>（仮）v0.1</small>
        </div>
        <nav class="steps" aria-label="手順">
          {STEPS.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 && <span class="step-arrow">→</span>}
              <button
                class={`step ${i === stepIndex ? 'active' : ''}`}
                aria-current={i === stepIndex ? 'step' : undefined}
                disabled={exporting || (s.id === 'export' && (project.clips.length === 0 || missing.length > 0))}
                onClick={() => (s.id === 'export' ? goExport() : setStep(s.id))}
              >
                <span class="num">{i + 1}</span>
                {s.label}
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
          <button class="btn small ghost" title="作品をファイルに保存（Ctrl+S）" onClick={saveProject}>
            <Icon name="save" />
            保存
          </button>
          <button class="btn small ghost" title="保存した作品ファイルを開く" onClick={openProject} disabled={exporting}>
            <Icon name="open" />
            開く
          </button>
          <button class="btn small ghost" title="新しい作品を作る" onClick={newProject} disabled={exporting}>
            <Icon name="new" />
            新しく
          </button>
          <span class="tool-sep" />
          <button class="btn icon ghost" title={`画面の明るさ：${THEME_LABELS[theme]}（押すと切り替え）`} aria-label={`画面の明るさ：${THEME_LABELS[theme]}`} onClick={cycleTheme}>
            <Icon name="theme" />
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
          <div class="preview-box">
            <canvas ref={canvasRef} onClick={() => playerRef.current?.toggle()} title="押すと再生・一時停止（スペース）" />
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

        {step === 'export' ? (
          <ExportPanel
            project={project}
            files={() => registry.allFiles()}
            onBack={() => setStep('import')}
            onRunningChange={setExporting}
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
            onNext={goExport}
          />
        )}
      </main>

      <section class="timeline-area" aria-label="タイムライン">
        <Timeline
          project={project}
          time={playback.time}
          playing={playback.playing}
          selection={selection}
          peaks={peaks}
          peaksTick={peaksTick}
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
      {dragOver && <DropOverlay />}
      {busy && <BusyOverlay text={busy} />}
    </div>
  );
}
