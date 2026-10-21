// 画像の置き方（v0.5）

export type ImagePlace = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left' | 'center' | 'full' | 'free';

export interface ImagePlaceOption {
  value: Exclude<ImagePlace, 'free'>;
  label: string;
}

export const IMAGE_PLACES: readonly ImagePlaceOption[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'center', label: '中央' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' },
  { value: 'full', label: '画面いっぱい' },
];

/** 四隅に置くときの幅（画面の幅に対する割合） */
export const CORNER_WIDTH = 0.3;
/** 中央に置くときの幅 */
export const CENTER_WIDTH = 0.5;
/** 画面の端からの余白（画面の高さに対する割合） */
export const IMAGE_MARGIN = 0.04;
/** ドラッグで変えられる幅の範囲 */
export const MIN_IMAGE_WIDTH = 0.05;
export const MAX_IMAGE_WIDTH = 1;

/** 範囲をなぞらずに置いたときの長さ（秒） */
export const NEW_IMAGE_SECONDS = 5;

/** 読み込める画像 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
/** 大きすぎる画像は入れない（作品ファイルに入れるため） */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
