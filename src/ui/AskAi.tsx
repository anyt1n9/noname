// 「AIに聞く」（v0.8）：質問文をコピーして、使う人が選んだ AI のサイトを新しいタブで開く。
// 貼り付け・送信・答えのコピーは使う人が自分で行う（AI のサイトをプログラムで操作しない。各社の利用規約のため）。
import { useEffect, useState } from 'preact/hooks';
import { AI_SERVICES, aiService } from '../data/ai';
import { Icon } from './icons';

const SERVICE_KEY = 'teroppa.aiService';

function loadService(): string {
  try {
    return localStorage.getItem(SERVICE_KEY) ?? AI_SERVICES[0].id;
  } catch {
    return AI_SERVICES[0].id;
  }
}

/** 文字をコピーする（できなければ false） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // クリップボードが使えないときは、選んでコピーする昔の方法を試す
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

interface Props {
  /** 質問文（使う人が直せる） */
  prompt: string;
  /** 質問文に字幕などの作品の中身が入っているか（送る前の案内に使う） */
  containsWork?: boolean;
  /** 答えを貼り戻す欄の説明。なければ欄を出さない */
  answerLabel?: string;
  onAnswer?(text: string): void;
}

export function AskAi(p: Props) {
  const [serviceId, setServiceId] = useState(loadService);
  const [prompt, setPrompt] = useState(p.prompt);
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState<boolean | null>(null);
  const service = aiService(serviceId);
  useEffect(() => setPrompt(p.prompt), [p.prompt]);

  const open = async () => {
    const ok = await copyText(prompt);
    setCopied(ok);
    window.open(service.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div class="ask-ai">
      <div class="style-row">
        <span class="section-title">使う AI</span>
        <div class="segmented" role="radiogroup" aria-label="使う AI のサイト">
          {AI_SERVICES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={serviceId === s.id}
              class={serviceId === s.id ? 'on' : ''}
              onClick={() => {
                setServiceId(s.id);
                try {
                  localStorage.setItem(SERVICE_KEY, s.id);
                } catch {
                  // 覚えられなくても使える
                }
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <label class="field">
        <span>質問文（直してもかまいません）</span>
        <textarea rows={6} value={prompt} onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)} aria-label="AI への質問文" />
      </label>
      <p class="note">
        この文章を {service.name}（{service.company}）のサイトに貼り付けて送ると、{service.company} に送られます。
        {p.containsWork && '字幕の文章が入っています。'}
        送るかどうかは、あなたが決めます。{service.name} の利用規約に従って使ってください。
      </p>
      <ol class="steps-list">
        <li>下のボタンで、質問文をコピーして {service.name} を開く</li>
        <li>開いたサイトの入力欄に貼り付けて（Ctrl+V）、送る</li>
        {p.onAnswer && <li>AI の答えをコピーして、下の欄に貼る</li>}
      </ol>
      <div class="actions">
        <button class="btn primary" onClick={open}>
          <Icon name="open" />
          質問文をコピーして {service.name} を開く
        </button>
      </div>
      {copied === true && <p class="hint-text">質問文をコピーしました。開いたタブで貼り付けてください。</p>}
      {copied === false && <p class="note warn">コピーできませんでした。上の質問文を選んで、自分でコピーしてください。</p>}
      {p.onAnswer && (
        <>
          <label class="field">
            <span>{p.answerLabel}</span>
            <textarea rows={5} value={answer} onInput={(e) => setAnswer((e.target as HTMLTextAreaElement).value)} aria-label="AI の答えを貼る欄" />
          </label>
          <div class="actions">
            <button class="btn" disabled={answer.trim() === ''} onClick={() => p.onAnswer?.(answer)}>
              答えを読み込む
            </button>
          </div>
        </>
      )}
      <p class="hint-text">AI は間違えることがあります。確かめてから使ってください。</p>
    </div>
  );
}
