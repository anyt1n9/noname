// 練習（v1.0）の案内。見本の録画で練習している間、手順ごとに「やってみること」を出す
import { PRACTICE_TIPS } from '../data/practice';
import type { StepId } from '../data/steps';

export function PracticeTip({ step, onStop }: { step: StepId; onStop(): void }) {
  return (
    <div class="practice-tip" role="note">
      <strong>練習</strong>
      <span>{PRACTICE_TIPS[step]}</span>
      <button class="btn small ghost" onClick={onStop} title="練習の案内を出さないようにする（作品はそのまま）">
        練習をやめる
      </button>
    </div>
  );
}
