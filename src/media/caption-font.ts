// 字幕のフォント（Noto Sans JP の太字。SIL Open Font License）。
// 画面側でも書き出しの作業場所でも同じように使えるよう、FontFace で登録する。
// フォントは文字のまとまりごとに分かれていて、使う文字の分だけ読み込む。
import css from '@fontsource/noto-sans-jp/700.css?raw';
import { SUBTITLE_FONT_FAMILY, SUBTITLE_FONT_WEIGHT } from '../data/subtitle-style';

const files = import.meta.glob('/node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-[0-9]*-700-normal.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** フォントの登録先（画面なら document.fonts、作業場所なら self.fonts） */
function fontSet(): FontFaceSet | null {
  const g = globalThis as unknown as { fonts?: FontFaceSet; document?: Document };
  return g.document?.fonts ?? g.fonts ?? null;
}

let registered = false;

function register(set: FontFaceSet): void {
  if (registered) return;
  registered = true;
  const byName = new Map<string, string>();
  for (const [path, url] of Object.entries(files)) byName.set(path.split('/').pop()!, url);
  const blocks = css.split('@font-face').slice(1);
  for (const block of blocks) {
    const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    const url = file ? byName.get(file) : undefined;
    if (!url || !range) continue;
    set.add(
      new FontFace(SUBTITLE_FONT_FAMILY, `url(${url}) format('woff2')`, {
        weight: String(SUBTITLE_FONT_WEIGHT),
        unicodeRange: range.trim(),
        display: 'swap',
      }),
    );
  }
}

const loaded = new Set<string>();

/** text を描くのに必要な文字を読み込む。読み込み済みなら何もしない */
export async function loadCaptionGlyphs(text: string): Promise<void> {
  const set = fontSet();
  if (!set) return;
  register(set);
  const chars = [...new Set(text.replace(/\s/g, ''))].filter((c) => !loaded.has(c));
  if (chars.length === 0) return;
  try {
    await set.load(`${SUBTITLE_FONT_WEIGHT} 48px "${SUBTITLE_FONT_FAMILY}"`, chars.join(''));
  } catch {
    // 読み込めないときは、パソコンに入っている文字で描く
  }
  // 読み込めなかった文字も、何度も読み込もうとしないよう「済み」にする
  for (const c of chars) loaded.add(c);
}

/** text の文字がすでに読み込まれているか */
export function captionGlyphsReady(text: string): boolean {
  for (const c of text.replace(/\s/g, '')) if (!loaded.has(c)) return false;
  return true;
}
