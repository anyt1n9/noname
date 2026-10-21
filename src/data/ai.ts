// AI のお手伝い（v0.8）

/** 「AIに聞く」で開ける AI のサイト。ロゴは使わず、名前を文字で書くだけにする */
export interface AiService {
  id: string;
  name: string;
  /** 送った文章を受け取る会社 */
  company: string;
  url: string;
}

export const AI_SERVICES: readonly AiService[] = [
  { id: 'chatgpt', name: 'ChatGPT', company: 'OpenAI', url: 'https://chatgpt.com/' },
  { id: 'claude', name: 'Claude', company: 'Anthropic', url: 'https://claude.ai/new' },
  { id: 'gemini', name: 'Gemini', company: 'Google', url: 'https://gemini.google.com/app' },
  { id: 'copilot', name: 'Microsoft Copilot', company: 'Microsoft', url: 'https://copilot.microsoft.com/' },
];

export function aiService(id: string): AiService {
  return AI_SERVICES.find((s) => s.id === id) ?? AI_SERVICES[0];
}

/** Chrome に入っている AI（Prompt API）を使うときに、使う人にも当てはまる Google の禁止事項ポリシー */
export const GOOGLE_AI_POLICY_URL = 'https://policies.google.com/terms/generative-ai/use-policy';
/** Chrome に入っている AI を使うのに要る、パソコンの空き容量の目安（Chrome の説明より） */
export const BUILTIN_AI_FREE_SPACE_GB = 22;

/** YouTube のチャプターのルール（2026年10月に YouTube ヘルプで確かめた） */
export const CHAPTER_MIN_COUNT = 3;
export const CHAPTER_MIN_SECONDS = 10;

/** Chrome に入っている AI は小さいので、字幕は少しずつ区切って渡す */
export const BUILTIN_TYPO_BATCH = 15;
export const BUILTIN_CHUNK_CHARS = 1500;
/** Chrome に入っている AI でチャプターを作るときの、チャプターの数の目安（2分に1つ・3〜12） */
export const BUILTIN_CHAPTER_SECONDS = 120;
export const BUILTIN_CHAPTER_MAX = 12;

/** 動画の種類（台本の下書きで使う） */
export const VIDEO_KINDS = ['解説', 'ゲーム実況', '雑談', 'レビュー', 'ハウツー'] as const;
