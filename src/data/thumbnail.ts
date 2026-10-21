// サムネイル（v0.9）の見た目（テンプレート）。どれも自作

export type ThumbTemplate = 'impact' | 'pop' | 'band' | 'simple';
export type ThumbPosition = 'top' | 'middle' | 'bottom';
export type ThumbAlign = 'left' | 'center';
export type ThumbSize = 'medium' | 'large' | 'huge';

export const THUMB_TEMPLATES: readonly { value: ThumbTemplate; label: string; hint: string; color: string }[] = [
  { value: 'impact', label: 'インパクト', hint: '太い黒ふちの大きな文字', color: '#ffe14d' },
  { value: 'pop', label: 'ポップ', hint: '白い文字に色のふち', color: '#ff3b30' },
  { value: 'band', label: '帯', hint: '暗い帯の上に文字', color: '#ffffff' },
  { value: 'simple', label: 'シンプル', hint: '画面を少し暗くして白い文字', color: '#ffffff' },
];

/** 文字の色（「ポップ」では、ふちの色） */
export const THUMB_COLORS: readonly { value: string; label: string }[] = [
  { value: '#ffe14d', label: '黄' },
  { value: '#ffffff', label: '白' },
  { value: '#ff3b30', label: '赤' },
  { value: '#5ac8fa', label: '水色' },
  { value: '#a6f07a', label: '黄緑' },
  { value: '#ff9ccb', label: 'ピンク' },
];

export const THUMB_POSITIONS: readonly { value: ThumbPosition; label: string }[] = [
  { value: 'top', label: '上' },
  { value: 'middle', label: '真ん中' },
  { value: 'bottom', label: '下' },
];

export const THUMB_ALIGNS: readonly { value: ThumbAlign; label: string }[] = [
  { value: 'left', label: '左寄せ' },
  { value: 'center', label: '中央' },
];

/** 文字の大きさ（画面の高さに対する割合。長い行は画面に収まるよう小さくする） */
export const THUMB_SIZES: readonly { value: ThumbSize; label: string; ratio: number }[] = [
  { value: 'medium', label: '中', ratio: 0.13 },
  { value: 'large', label: '大', ratio: 0.17 },
  { value: 'huge', label: '特大', ratio: 0.22 },
];

/** 保存する大きさ（YouTube のサムネイルは 16:9） */
export const THUMB_OUTPUTS: readonly { width: number; height: number; label: string }[] = [
  { width: 1280, height: 720, label: '1280×720（ふつう）' },
  { width: 1920, height: 1080, label: '1920×1080（大きめ）' },
];

/** スマホのアプリから上げるときの大きさの上限（YouTube ヘルプ、2026年10月に確かめた） */
export const THUMB_MOBILE_LIMIT_BYTES = 2 * 1024 * 1024;
/** 文字は3行まで */
export const THUMB_MAX_LINES = 3;
