// 無音カットの「切る強さ」（数値は仮。使いながら調整する）

export interface CutStrength {
  label: string;
  /** これより長くしゃべっていない場所を候補にする（秒） */
  minSilence: number;
  /** しゃべりの前後に残す余白（秒） */
  padding: number;
}

export const CUT_STRENGTHS: readonly CutStrength[] = [
  { label: 'とても弱い', minSilence: 1.5, padding: 0.25 },
  { label: '弱い', minSilence: 1.0, padding: 0.2 },
  { label: 'ふつう', minSilence: 0.5, padding: 0.2 },
  { label: '強い', minSilence: 0.35, padding: 0.12 },
  { label: 'とても強い', minSilence: 0.25, padding: 0.08 },
];

export const DEFAULT_CUT_STRENGTH = 2;

/** これより短い候補は出さない（秒） */
export const MIN_CUT_SECONDS = 0.1;

/** これより短いしゃべり（物音など）は無視して、前後の「間」とつなげる（秒） */
export const MIN_SPEECH_SECONDS = 0.1;
