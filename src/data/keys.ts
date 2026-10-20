// キーボード操作の一覧（キーの一覧画面に出す）

export type KeyAction =
  | 'playPause'
  | 'back'
  | 'forward'
  | 'backLong'
  | 'forwardLong'
  | 'deleteSelection'
  | 'clearSelection'
  | 'undo'
  | 'redo'
  | 'saveFile'
  | 'zoomIn'
  | 'zoomOut'
  | 'showKeys';

export interface KeyHelp {
  keys: string;
  description: string;
}

export const KEY_HELP: readonly KeyHelp[] = [
  { keys: 'スペース', description: '再生・一時停止' },
  { keys: '← →', description: '1秒戻る・進む' },
  { keys: 'Shift + ← →', description: '5秒戻る・進む' },
  { keys: 'Delete', description: 'なぞった範囲を消す' },
  { keys: 'Esc', description: 'なぞった範囲をやめる' },
  { keys: 'Ctrl + Z', description: '元に戻す' },
  { keys: 'Ctrl + Y', description: 'やり直す' },
  { keys: 'Ctrl + S', description: 'ファイルに保存' },
  { keys: '＋ / −', description: 'タイムラインの拡大・縮小' },
  { keys: '?', description: 'キーの一覧を表示' },
];

/** ← → で動く秒数 */
export const STEP_SECONDS = 1;
export const LONG_STEP_SECONDS = 5;
