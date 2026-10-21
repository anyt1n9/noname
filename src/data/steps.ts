// 画面上の手順の案内。版が上がるたびに手順が増える

export type StepId = 'import' | 'silence' | 'subtitles' | 'decorate' | 'sound' | 'export' | 'publish';

export interface Step {
  id: StepId;
  label: string;
}

export const STEPS: readonly Step[] = [
  { id: 'import', label: '読み込み' },
  { id: 'silence', label: '「間」を切る' },
  { id: 'subtitles', label: '字幕' },
  { id: 'decorate', label: '飾り' },
  { id: 'sound', label: '音の仕上げ' },
  { id: 'export', label: '書き出し' },
  { id: 'publish', label: '公開の準備' },
];

/** 次の手順 */
export function nextStep(id: StepId): Step | undefined {
  const i = STEPS.findIndex((s) => s.id === id);
  return STEPS[i + 1];
}
