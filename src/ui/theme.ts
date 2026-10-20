// 画面の明るさ（暗い・明るい・パソコンに合わせる）

export type ThemePreference = 'auto' | 'dark' | 'light';

const KEY = 'teroppa.theme';

export const THEME_LABELS: Record<ThemePreference, string> = {
  auto: 'パソコンに合わせる',
  dark: '暗い画面',
  light: '明るい画面',
};

export const THEME_ORDER: ThemePreference[] = ['auto', 'dark', 'light'];

export function loadThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'auto' || v === 'dark' || v === 'light') return v;
  } catch {
    // 保存できない環境では毎回「パソコンに合わせる」
  }
  return 'auto';
}

export function saveThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // 保存できなくても使える
  }
}

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'auto') delete root.dataset.theme;
  else root.dataset.theme = pref;
  window.dispatchEvent(new Event('teroppa-theme'));
}

/** 明るさが変わったら呼ぶ（パソコンの設定が変わったときも） */
export function onThemeChange(callback: () => void): () => void {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', callback);
  window.addEventListener('teroppa-theme', callback);
  return () => {
    media.removeEventListener('change', callback);
    window.removeEventListener('teroppa-theme', callback);
  };
}

/** CSS に定義した色を読む（タイムラインの描画で使う） */
export function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
