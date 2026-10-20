// 画面上の手順の案内。版が上がるたびに手順が増える

export type StepId = 'import' | 'silence' | 'export';

export interface Step {
  id: StepId;
  label: string;
}

export const STEPS: readonly Step[] = [
  { id: 'import', label: '読み込み' },
  { id: 'silence', label: '「間」を切る' },
  { id: 'export', label: '書き出し' },
];
