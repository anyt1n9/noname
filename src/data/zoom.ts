// 画面の一部を拡大（v0.6）

/** 寄るとき・戻るときにかける時間（秒） */
export const ZOOM_EASE_SECONDS = 0.3;
/** 拡大を入れたときの、見せる範囲の幅（画面の幅に対する割合。0.5 なら2倍） */
export const DEFAULT_ZOOM_WIDTH = 0.5;
/** 一番大きく拡大したときの幅（約6倍） */
export const MIN_ZOOM_WIDTH = 0.15;
/** すぐ選べる拡大の大きさ */
export const ZOOM_FACTORS = [1.5, 2, 3] as const;
/** 範囲をなぞらずに入れたときの長さ（秒） */
export const NEW_ZOOM_SECONDS = 4;
