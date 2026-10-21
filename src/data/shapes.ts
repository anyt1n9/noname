// 矢印・四角い枠・丸（v0.6）

export type ShapeKind = 'arrow' | 'rect' | 'circle';
export type ShapeThickness = 'thin' | 'normal' | 'thick';
export type ArrowDirection = 'up-left' | 'up' | 'up-right' | 'left' | 'right' | 'down-left' | 'down' | 'down-right';

export const SHAPE_KINDS: readonly { value: ShapeKind; label: string }[] = [
  { value: 'arrow', label: '矢印' },
  { value: 'rect', label: '四角い枠' },
  { value: 'circle', label: '丸' },
];

export const SHAPE_COLORS: readonly { value: string; label: string }[] = [
  { value: '#ff3b30', label: '赤' },
  { value: '#ffd60a', label: '黄' },
  { value: '#ffffff', label: '白' },
  { value: '#5ac8fa', label: '水色' },
  { value: '#a6f07a', label: '黄緑' },
];

/** 線の太さ（画面の高さに対する割合） */
export const SHAPE_THICKNESS: readonly { value: ShapeThickness; label: string; ratio: number }[] = [
  { value: 'thin', label: '細い', ratio: 0.006 },
  { value: 'normal', label: 'ふつう', ratio: 0.011 },
  { value: 'thick', label: '太い', ratio: 0.018 },
];

/** 矢印の向き（ボタンに出す矢印の文字と、向きの名前） */
export const ARROW_DIRECTIONS: readonly { value: ArrowDirection; mark: string; label: string }[] = [
  { value: 'up-left', mark: '↖', label: '左上へ' },
  { value: 'up', mark: '↑', label: '上へ' },
  { value: 'up-right', mark: '↗', label: '右上へ' },
  { value: 'left', mark: '←', label: '左へ' },
  { value: 'right', mark: '→', label: '右へ' },
  { value: 'down-left', mark: '↙', label: '左下へ' },
  { value: 'down', mark: '↓', label: '下へ' },
  { value: 'down-right', mark: '↘', label: '右下へ' },
];

/** 置いたときの大きさ（画面の幅に対する割合） */
export const SHAPE_SIZE = 0.2;
export const NEW_SHAPE_SECONDS = 4;
/** 置き場所（画像と同じ四隅と中央） */
export const SHAPE_PLACES = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'] as const;
export type ShapePlace = (typeof SHAPE_PLACES)[number];

export function isShapeKind(v: unknown): v is ShapeKind {
  return SHAPE_KINDS.some((k) => k.value === v);
}
