// 字幕の誤字を AI で直す（v0.8）。直した案を見せて、選んだものだけを直す
import { useMemo, useState } from 'preact/hooks';
import { builtinTypos } from '../ai/builtin';
import type { Project } from '../core/project';
import { parseTypoAnswer, transcriptLines, typoPrompt } from '../core/prompts';
import { formatClock } from '../core/time';
import { AskAi } from './AskAi';
import { AiProgress, BuiltinNotice } from './BuiltinAi';
import { useBuiltinAi } from './useBuiltinAi';

interface Props {
  project: Project;
  onApply(changes: { id: string; text: string }[]): void;
  onClose(): void;
}

interface Suggestion {
  id: string;
  time: number;
  before: string;
  after: string;
}

export function TypoDialog(p: Props) {
  const ai = useBuiltinAi();
  const lines = useMemo(() => transcriptLines(p.project), [p.project]);
  const numbered = useMemo(() => lines.map((l, i) => ({ no: i + 1, text: l.text })), [lines]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<'builtin' | 'ask'>('builtin');

  const show = (fixes: Map<number, string>) => {
    const list: Suggestion[] = [];
    for (const [no, text] of fixes) {
      const line = lines[no - 1];
      if (line && text.replace(/\s/g, '') !== line.text.replace(/\s/g, '')) list.push({ id: line.id, time: line.time, before: line.text, after: text });
    }
    setSuggestions(list);
    setChosen(new Set(list.map((s) => s.id)));
  };

  const useBuiltin = ai.usable && method === 'builtin';
  return (
    <div class="overlay" onClick={p.onClose}>
      <div class="dialog wide" role="dialog" aria-modal="true" aria-label="字幕の誤字を AI で直す" onClick={(e) => e.stopPropagation()}>
        <h2>字幕の誤字を AI で直す</h2>
        {lines.length === 0 ? (
          <p>まだ字幕がありません。</p>
        ) : suggestions ? (
          <>
            {suggestions.length === 0 ? (
              <p>直すところは見つかりませんでした。</p>
            ) : (
              <>
                <p>AI が直した案です。直したいものに印を付けて「選んだものを直す」を押してください（元に戻せます）。</p>
                <ul class="typo-list">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <label class="check">
                        <input
                          type="checkbox"
                          checked={chosen.has(s.id)}
                          onChange={() =>
                            setChosen((c) => {
                              const n = new Set(c);
                              if (n.has(s.id)) n.delete(s.id);
                              else n.add(s.id);
                              return n;
                            })
                          }
                        />
                        <span class="item-time">{formatClock(s.time)}</span>
                        <span>
                          <span class="typo-before">{s.before}</span>
                          <span class="typo-arrow"> → </span>
                          <strong>{s.after}</strong>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p class="hint-text">AI は間違えることがあります。確かめてから直してください。</p>
            <div class="actions">
              {suggestions.length > 0 && (
                <button
                  class="btn primary"
                  disabled={chosen.size === 0}
                  onClick={() => {
                    p.onApply(suggestions.filter((s) => chosen.has(s.id)).map((s) => ({ id: s.id, text: s.after })));
                    p.onClose();
                  }}
                >
                  選んだものを直す（{chosen.size}行）
                </button>
              )}
              <button class="btn" onClick={() => setSuggestions(null)}>
                やり直す
              </button>
              <button class="btn ghost" onClick={p.onClose}>
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            <div class="segmented" role="radiogroup" aria-label="AI の使い方">
              <button role="radio" aria-checked={useBuiltin} class={useBuiltin ? 'on' : ''} disabled={!ai.usable} onClick={() => setMethod('builtin')}>
                このパソコンの AI
              </button>
              <button role="radio" aria-checked={!useBuiltin} class={!useBuiltin ? 'on' : ''} onClick={() => setMethod('ask')}>
                AIに聞く（AI のサイト）
              </button>
            </div>
            {!ai.usable && <p class="hint-text">このブラウザ・パソコンでは、パソコンの中の AI が使えません。「AIに聞く」を使ってください。</p>}
            {useBuiltin ? (
              <>
                <p>{lines.length}行の字幕を、少しずつ区切って AI に読ませます。字幕はネットに送りません。</p>
                {ai.job.kind === 'notice' ? (
                  <BuiltinNotice state={ai.state} onAccept={ai.accept} onCancel={ai.dismiss} />
                ) : ai.job.kind === 'idle' || ai.job.kind === 'error' ? (
                  <div class="actions">
                    <button class="btn primary" onClick={() => ai.run((s, progress, signal) => builtinTypos(s, numbered, progress, signal), show)}>
                      AI で直す
                    </button>
                  </div>
                ) : null}
                <AiProgress job={ai.job} onCancel={ai.cancel} />
              </>
            ) : (
              <AskAi prompt={typoPrompt(numbered)} containsWork answerLabel="AI の答え（「番号: 直した文」の行）を貼る" onAnswer={(text) => show(parseTypoAnswer(text))} />
            )}
            <div class="actions">
              <button class="btn ghost" onClick={p.onClose}>
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
