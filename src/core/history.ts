// 元に戻す・やり直すための記録

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** 覚えておく操作の数。これを超えたら古いものから忘れる */
export const HISTORY_LIMIT = 300;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** 新しい状態を記録する。同じ状態なら何もしない。やり直しの記録は消える */
export function record<T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const previous = history.past[history.past.length - 1];
  return { past, present: previous, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [next, ...future] = history.future;
  return { past: [...history.past, history.present], present: next, future };
}
