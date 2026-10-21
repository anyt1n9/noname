// Chrome に入っている AI を使う前の案内と、使っている間の表示（v0.8）
import { BUILTIN_AI_FREE_SPACE_GB, GOOGLE_AI_POLICY_URL } from '../data/ai';
import type { BuiltinState } from '../ai/builtin';

export function BuiltinNotice(p: { state: BuiltinState; onAccept(): void; onCancel(): void }) {
  return (
    <div class="note rights" role="dialog" aria-label="パソコンの中の AI を使う前の確認">
      <strong>パソコンの中の AI（Chrome に入っている AI）を使います</strong>
      <ul class="steps-list about-list">
        <li>文章はこのパソコンの中で処理され、ネットには送りません。</li>
        {p.state !== 'available' && (
          <li>
            はじめて使うときは、Chrome が AI の部品を Google からダウンロードします（大きいファイルです。パソコンに {BUILTIN_AI_FREE_SPACE_GB}GB ほどの空きが必要です）。
          </li>
        )}
        <li>
          Google の生成 AI の禁止事項ポリシーが、使う人にも当てはまります。
          <a href={GOOGLE_AI_POLICY_URL} target="_blank" rel="noopener noreferrer">
            ポリシーを読む
          </a>
        </li>
        <li>AI は間違えることがあります。答えは案として出すので、確かめてから使ってください。</li>
      </ul>
      <div class="actions">
        <button class="btn primary small" onClick={p.onAccept}>
          了承して使う
        </button>
        <button class="btn small" onClick={p.onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}

/** AI の作業の進み具合 */
export type AiJob =
  | { kind: 'idle' }
  | { kind: 'notice' }
  | { kind: 'download'; progress: number }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'error'; message: string };

export function AiProgress(p: { job: AiJob; onCancel(): void }) {
  if (p.job.kind === 'download') {
    return (
      <div class="ai-progress">
        <p>Chrome が AI の部品をダウンロードしています… {Math.floor(p.job.progress * 100)}%</p>
        <div class="progress">
          <div style={{ width: `${p.job.progress * 100}%` }} />
        </div>
        <button class="btn small" onClick={p.onCancel}>
          やめる
        </button>
      </div>
    );
  }
  if (p.job.kind === 'running') {
    const ratio = p.job.total > 0 ? p.job.done / p.job.total : 0;
    return (
      <div class="ai-progress">
        <p>
          AI が考えています…（{p.job.done}/{p.job.total}）
        </p>
        <div class="progress">
          <div style={{ width: `${ratio * 100}%` }} />
        </div>
        <button class="btn small" onClick={p.onCancel}>
          やめる
        </button>
      </div>
    );
  }
  if (p.job.kind === 'error') return <p class="note warn">{p.job.message}</p>;
  return null;
}
