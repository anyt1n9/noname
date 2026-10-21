// 「AIに聞く」（v0.8）：動画の内容の調べもの・台本の下書き。どちらも AI のサイトで聞く
import { useEffect, useState } from 'preact/hooks';
import { researchPrompt, scriptPrompt } from '../core/prompts';
import { VIDEO_KINDS } from '../data/ai';
import { AskAi } from './AskAi';

export function AiDialog({ topic: initialTopic, onClose }: { topic: string; onClose(): void }) {
  const [tab, setTab] = useState<'research' | 'script'>('research');
  const [topic, setTopic] = useState(initialTopic);
  const [minutes, setMinutes] = useState(10);
  const [kind, setKind] = useState<string>(VIDEO_KINDS[0]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const prompt = topic.trim() === '' ? '' : tab === 'research' ? researchPrompt(topic) : scriptPrompt(topic, minutes, kind);
  return (
    <div class="overlay" onClick={onClose}>
      <div class="dialog wide" role="dialog" aria-modal="true" aria-label="AIに聞く" onClick={(e) => e.stopPropagation()}>
        <h2>AIに聞く</h2>
        <div class="tabs" role="tablist" aria-label="聞くこと">
          <button role="tab" aria-selected={tab === 'research'} class={tab === 'research' ? 'on' : ''} onClick={() => setTab('research')}>
            動画の内容の調べもの
          </button>
          <button role="tab" aria-selected={tab === 'script'} class={tab === 'script' ? 'on' : ''} onClick={() => setTab('script')}>
            台本の下書き
          </button>
        </div>
        <p class="hint-text">
          {tab === 'research'
            ? '動画で話す内容について、押さえるべき要点や、確かめるべき事実を AI に聞きます。AI の答えには間違いがあるので、元の情報（公式の資料など）で確かめてから話しましょう。'
            : '録画の前に、話す流れ（はじめに・本題・まとめ）を AI に考えてもらいます。そのまま読むのではなく、自分の言葉で話すときの手がかりにしましょう。'}
        </p>
        <label class="field">
          <span>動画のテーマ</span>
          <input type="text" value={topic} placeholder="例：〇〇のボスの倒し方" onInput={(e) => setTopic((e.target as HTMLInputElement).value)} aria-label="動画のテーマ" />
        </label>
        {tab === 'script' && (
          <div class="style-row">
            <label class="field inline">
              <span>長さ（分）</span>
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(180, Number((e.target as HTMLInputElement).value) || 10)))} aria-label="動画の長さ（分）" />
            </label>
            <div class="segmented" role="radiogroup" aria-label="動画の種類">
              {VIDEO_KINDS.map((k) => (
                <button key={k} role="radio" aria-checked={kind === k} class={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {k}
                </button>
              ))}
            </div>
          </div>
        )}
        {prompt ? <AskAi prompt={prompt} /> : <p class="hint-text">テーマを入れると、質問文を作ります。</p>}
        <div class="actions">
          <button class="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
