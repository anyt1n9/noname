// 公開の準備の手順（v0.8）：タイトル・概要欄・チャプターの案を AI と作る
import { useMemo, useState } from 'preact/hooks';
import { builtinChapters, builtinTitle } from '../ai/builtin';
import { chapterTime, fixChapters, formatChapters, parseChapters, type Chapter } from '../core/chapters';
import type { Project, PublishInfo } from '../core/project';
import { chaptersPrompt, parseTitleAnswer, titlePrompt, transcriptLines, transcriptText } from '../core/prompts';
import { totalDuration } from '../core/timeline';
import { AskAi, copyText } from './AskAi';
import { AiProgress, BuiltinNotice } from './BuiltinAi';
import { Icon } from './icons';
import { useBuiltinAi } from './useBuiltinAi';

export type PublishTab = 'title' | 'chapters';

interface Props {
  project: Project;
  tab: PublishTab;
  time: number;
  onTab(tab: PublishTab): void;
  onChange(publish: PublishInfo): void;
  onSeek(t: number): void;
  notify(text: string): void;
}

/** 「1:02」「1:02:03」を秒に。読めなければ null */
function readTime(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{2})\s*$/.exec(text);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export function PublishPanel(p: Props) {
  const lines = useMemo(() => transcriptLines(p.project), [p.project.subtitles, p.project.clips]);
  const duration = totalDuration(p.project);
  return (
    <div class="guide publish-panel" aria-live="polite">
      <h2>公開の準備をしましょう</h2>
      <p>YouTube に上げるときの、タイトル・概要欄・チャプター（目次）の案を作ります。AI の案は、確かめてから使ってください。</p>
      <div class="tabs" role="tablist" aria-label="公開の準備">
        <button role="tab" aria-selected={p.tab === 'title'} class={p.tab === 'title' ? 'on' : ''} onClick={() => p.onTab('title')}>
          タイトル・概要欄
        </button>
        <button role="tab" aria-selected={p.tab === 'chapters'} class={p.tab === 'chapters' ? 'on' : ''} onClick={() => p.onTab('chapters')}>
          チャプター
        </button>
      </div>
      {lines.length === 0 && <p class="note">字幕があると、AI が動画の内容から案を作れます。字幕がなくても、自分で書けます。</p>}
      {p.tab === 'title' ? <TitleTab {...p} lines={lines} /> : <ChaptersTab {...p} lines={lines} duration={duration} />}
    </div>
  );
}

function TitleTab(p: Props & { lines: { time: number; text: string }[] }) {
  const ai = useBuiltinAi();
  const [ideas, setIdeas] = useState<{ titles: string[]; description: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const pub = p.project.publish;
  const chaptersOk = fixChapters(pub.chapters, totalDuration(p.project)).ok && pub.chapters.length > 0;
  return (
    <>
      <label class="field">
        <span>タイトル</span>
        <input type="text" value={pub.title} maxLength={100} onChange={(e) => p.onChange({ ...pub, title: (e.target as HTMLInputElement).value })} aria-label="タイトル" />
      </label>
      <label class="field">
        <span>概要欄</span>
        <textarea rows={5} value={pub.description} onChange={(e) => p.onChange({ ...pub, description: (e.target as HTMLTextAreaElement).value })} aria-label="概要欄" />
      </label>
      <div class="actions">
        <button class="btn small" disabled={!pub.title} onClick={async () => p.notify((await copyText(pub.title)) ? 'タイトルをコピーしました。' : 'コピーできませんでした。')}>
          タイトルをコピー
        </button>
        <button
          class="btn small"
          disabled={!pub.description && !chaptersOk}
          onClick={async () => {
            const text = [pub.description, chaptersOk ? formatChapters(pub.chapters, totalDuration(p.project)) : ''].filter((x) => x).join('\n\n');
            p.notify((await copyText(text)) ? `概要欄をコピーしました${chaptersOk ? '（チャプターも入っています）' : ''}。` : 'コピーできませんでした。');
          }}
        >
          概要欄をコピー{chaptersOk && '（チャプターも）'}
        </button>
      </div>
      <div class="section-title">AI に案を作ってもらう</div>
      {p.lines.length > 0 && (
        <>
          {ai.job.kind === 'notice' && <BuiltinNotice state={ai.state} onAccept={ai.accept} onCancel={ai.dismiss} />}
          <div class="actions">
            {ai.usable && (
              <button class="btn primary" disabled={ai.job.kind === 'download' || ai.job.kind === 'running'} onClick={() => ai.run((s, progress, signal) => builtinTitle(s, p.lines, progress, signal), setIdeas)}>
                このパソコンの AI で案を作る
              </button>
            )}
            <button class="btn" onClick={() => setAsking((a) => !a)}>
              AIに聞く（AI のサイト）
            </button>
          </div>
          <AiProgress job={ai.job} onCancel={ai.cancel} />
          {asking && (
            <AskAi
              prompt={titlePrompt(transcriptText(p.lines))}
              containsWork
              answerLabel="AI の答え（タイトル案と概要欄）を貼る"
              onAnswer={(text) => {
                setIdeas(parseTitleAnswer(text));
                setAsking(false);
              }}
            />
          )}
        </>
      )}
      {ideas && (
        <div class="item-settings">
          <div class="section-title">AI の案（押すと使えます）</div>
          <div class="chips">
            {ideas.titles.map((t) => (
              <button key={t} class="chip" onClick={() => p.onChange({ ...pub, title: t })}>
                {t}
              </button>
            ))}
          </div>
          {ideas.description && (
            <>
              <p class="pre">{ideas.description}</p>
              <div class="actions">
                <button class="btn small" onClick={() => p.onChange({ ...pub, description: ideas.description })}>
                  この文章を概要欄に入れる
                </button>
              </div>
            </>
          )}
          <p class="hint-text">AI は間違えることがあります。動画の内容と合っているか、確かめてから使ってください。</p>
        </div>
      )}
    </>
  );
}

function ChaptersTab(p: Props & { lines: { time: number; text: string }[]; duration: number }) {
  const ai = useBuiltinAi();
  const [asking, setAsking] = useState(false);
  const [fixes, setFixes] = useState<string[]>([]);
  const pub = p.project.publish;
  const check = fixChapters(pub.chapters, p.duration);
  const withHours = p.duration >= 3600;

  const accept = (chapters: Chapter[]) => {
    const r = fixChapters(chapters, p.duration);
    setFixes(r.fixes);
    p.onChange({ ...pub, chapters: r.chapters });
  };
  const edit = (index: number, change: Partial<Chapter>) => p.onChange({ ...pub, chapters: pub.chapters.map((c, i) => (i === index ? { ...c, ...change } : c)) });

  return (
    <>
      <p class="hint-text">YouTube のルール：最初は 0:00、3つ以上、時刻の順、それぞれ10秒以上。時刻は、書き出した動画（カットしたあと）の時刻です。</p>
      {pub.chapters.length > 0 && (
        <ul class="chapter-list" aria-label="チャプター">
          {pub.chapters.map((c, i) => (
            <li key={`${i}-${c.time}`}>
              <button class="item-time" onClick={() => p.onSeek(c.time)} title="この位置へ動く">
                ▶
              </button>
              <input
                class="chapter-time"
                type="text"
                value={chapterTime(c.time, withHours)}
                aria-label={`${i + 1}つ目のチャプターの時刻`}
                onChange={(e) => {
                  const t = readTime((e.target as HTMLInputElement).value);
                  if (t !== null) edit(i, { time: t });
                }}
              />
              <input type="text" value={c.title} aria-label={`${i + 1}つ目のチャプターの見出し`} onChange={(e) => edit(i, { title: (e.target as HTMLInputElement).value })} />
              <button class="btn icon ghost" title="このチャプターを消す" aria-label="このチャプターを消す" onClick={() => p.onChange({ ...pub, chapters: pub.chapters.filter((_, k) => k !== i) })}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {fixes.length > 0 && <p class="note">{fixes.join('')}</p>}
      {pub.chapters.length > 0 && !check.ok && <p class="note warn">{check.problem}</p>}
      <div class="actions">
        <button
          class="btn small"
          onClick={() => {
            const t = Math.floor(p.time);
            if (pub.chapters.some((c) => Math.abs(c.time - t) < 1)) return;
            p.onChange({ ...pub, chapters: [...pub.chapters, { time: t, title: '新しいチャプター' }].sort((a, b) => a.time - b.time) });
          }}
        >
          <Icon name="add" />
          再生位置にチャプターを足す
        </button>
        {pub.chapters.length > 0 && (
          <button class="btn small" onClick={() => accept(pub.chapters)}>
            ルールに合わせて直す
          </button>
        )}
        <button
          class="btn small"
          disabled={!check.ok || pub.chapters.length === 0}
          onClick={async () => p.notify((await copyText(formatChapters(check.chapters, p.duration))) ? 'チャプターをコピーしました。概要欄に貼ってください。' : 'コピーできませんでした。')}
        >
          チャプターをコピー
        </button>
      </div>
      {p.lines.length > 0 && (
        <>
          <div class="section-title">AI に案を作ってもらう</div>
          {ai.job.kind === 'notice' && <BuiltinNotice state={ai.state} onAccept={ai.accept} onCancel={ai.dismiss} />}
          <div class="actions">
            {ai.usable && (
              <button
                class="btn primary"
                disabled={ai.job.kind === 'download' || ai.job.kind === 'running'}
                onClick={() => ai.run((s, progress, signal) => builtinChapters(s, p.lines, p.duration, progress, signal), accept)}
              >
                このパソコンの AI で案を作る
              </button>
            )}
            <button class="btn" onClick={() => setAsking((a) => !a)}>
              AIに聞く（AI のサイト）
            </button>
          </div>
          <AiProgress job={ai.job} onCancel={ai.cancel} />
          {asking && (
            <AskAi
              prompt={chaptersPrompt(transcriptText(p.lines), p.duration)}
              containsWork
              answerLabel="AI の答え（「0:00 見出し」の行）を貼る"
              onAnswer={(text) => {
                const chapters = parseChapters(text);
                if (chapters.length === 0) {
                  p.notify('答えからチャプターを読み取れませんでした。「0:00 見出し」の形か確かめてください。');
                  return;
                }
                accept(chapters);
                setAsking(false);
              }}
            />
          )}
        </>
      )}
    </>
  );
}
