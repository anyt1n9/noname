// 字幕の見た目（定番：白文字＋黒縁）

export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitlePosition = 'bottom' | 'top';

export interface SubtitleStyle {
  color: string;
  size: SubtitleSize;
  position: SubtitlePosition;
}

export const SUBTITLE_COLORS: readonly { value: string; label: string }[] = [
  { value: '#ffffff', label: '白' },
  { value: '#ffe14d', label: '黄' },
  { value: '#7fd8ff', label: '水色' },
  { value: '#ff9ccb', label: 'ピンク' },
  { value: '#a6f07a', label: '黄緑' },
];

export const SUBTITLE_SIZES: readonly { value: SubtitleSize; label: string; ratio: number }[] = [
  { value: 'small', label: '小', ratio: 0.048 },
  { value: 'medium', label: '中', ratio: 0.058 },
  { value: 'large', label: '大', ratio: 0.07 },
];

export const SUBTITLE_POSITIONS: readonly { value: SubtitlePosition; label: string }[] = [
  { value: 'bottom', label: '下' },
  { value: 'top', label: '上' },
];

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = { color: '#ffffff', size: 'medium', position: 'bottom' };

/** 字幕の文字（OFL のフォント） */
export const SUBTITLE_FONT_FAMILY = 'Noto Sans JP';
export const SUBTITLE_FONT_WEIGHT = 700;

/** 字幕を新しく足すときの長さ（秒） */
export const NEW_SUBTITLE_SECONDS = 2;
