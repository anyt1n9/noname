// Chrome に入っている AI を使うときの、案内・ダウンロード・進み具合・やめる をまとめる（v0.8）
import { useEffect, useRef, useState } from 'preact/hooks';
import { builtinState, hasBuiltinConsent, openSession, saveBuiltinConsent, type BuiltinState } from '../ai/builtin';
import type { AiJob } from './BuiltinAi';

export type AiTask<T> = (session: LanguageModelSession, progress: (done: number, total: number) => void, signal: AbortSignal) => Promise<T>;

export function useBuiltinAi() {
  const [state, setState] = useState<BuiltinState>('unsupported');
  const [job, setJob] = useState<AiJob>({ kind: 'idle' });
  const pending = useRef<(() => void) | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void builtinState().then(setState);
  }, []);

  /** パソコンの中の AI が使えるか（ダウンロードが要るときも含む） */
  const usable = state === 'available' || state === 'downloadable' || state === 'downloading';

  const start = async <T,>(task: AiTask<T>, onDone: (result: T) => void) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      setJob(state === 'available' ? { kind: 'running', done: 0, total: 1 } : { kind: 'download', progress: 0 });
      const session = await openSession((p) => setJob({ kind: 'download', progress: p }), ctrl.signal);
      setState('available');
      setJob({ kind: 'running', done: 0, total: 1 });
      try {
        const result = await task(session, (done, total) => setJob({ kind: 'running', done, total }), ctrl.signal);
        setJob({ kind: 'idle' });
        onDone(result);
      } finally {
        session.destroy();
      }
    } catch (e) {
      if (ctrl.signal.aborted) setJob({ kind: 'idle' });
      else setJob({ kind: 'error', message: `パソコンの中の AI を使えませんでした。「AIに聞く」を使ってください。（くわしい理由：${e instanceof Error ? e.message : String(e)}）` });
    } finally {
      abort.current = null;
    }
  };

  /** AI に作業を頼む（はじめてなら、先に案内を出す） */
  const run = <T,>(task: AiTask<T>, onDone: (result: T) => void) => {
    if (!hasBuiltinConsent()) {
      pending.current = () => void start(task, onDone);
      setJob({ kind: 'notice' });
      return;
    }
    void start(task, onDone);
  };

  return {
    state,
    usable,
    job,
    run,
    accept: () => {
      saveBuiltinConsent();
      const f = pending.current;
      pending.current = null;
      setJob({ kind: 'idle' });
      f?.();
    },
    dismiss: () => {
      pending.current = null;
      setJob({ kind: 'idle' });
    },
    cancel: () => abort.current?.abort(),
  };
}
