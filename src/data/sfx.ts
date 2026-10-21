// 効果音の一覧（v0.5）。音はすべて src/core/sfx.ts でプログラムで作る（自作）

export type SoundId = 'pikon' | 'don' | 'shu' | 'kira' | 'bubu' | 'pon';

export interface SoundOption {
  id: SoundId;
  label: string;
  /** どんな場面で使うか */
  hint: string;
}

export const SOUNDS: readonly SoundOption[] = [
  { id: 'pikon', label: 'ピコン', hint: 'ひらめいたとき・ポイントを出すとき' },
  { id: 'don', label: 'ドン', hint: '強調したいとき' },
  { id: 'shu', label: 'シュッ', hint: '画像や場面が切り替わるとき' },
  { id: 'kira', label: 'キラーン', hint: 'うまくいったとき' },
  { id: 'bubu', label: 'ブブー', hint: '失敗したとき・まちがいのとき' },
  { id: 'pon', label: 'ポン', hint: '軽く区切りたいとき' },
];

export function isSoundId(v: unknown): v is SoundId {
  return SOUNDS.some((s) => s.id === v);
}
