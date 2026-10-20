// 押されたキーから、どの操作をするかを決める
import type { KeyAction } from '../data/keys';

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * typing が true のとき（文字を入力している欄にいるとき）は、キーを文字の入力に使うので何もしない。
 * 当てはまる操作がなければ null。
 */
export function actionForKey(input: KeyInput, typing: boolean): KeyAction | null {
  if (typing || input.altKey) return null;
  const command = input.ctrlKey || input.metaKey;
  const key = input.key;
  if (command) {
    const lower = key.toLowerCase();
    if (lower === 'z') return input.shiftKey ? 'redo' : 'undo';
    if (lower === 'y') return 'redo';
    if (lower === 's') return 'saveFile';
    return null;
  }
  switch (key) {
    case ' ':
      return 'playPause';
    case 'ArrowLeft':
      return input.shiftKey ? 'backLong' : 'back';
    case 'ArrowRight':
      return input.shiftKey ? 'forwardLong' : 'forward';
    case 'Delete':
    case 'Backspace':
      return 'deleteSelection';
    case 'Escape':
      return 'clearSelection';
    case '+':
    case '=':
    case ';':
      return 'zoomIn';
    case '-':
      return 'zoomOut';
    case '?':
      return 'showKeys';
    default:
      return null;
  }
}
