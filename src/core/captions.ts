// 字幕の分け方。1行20文字・2行まで（仮）。文の切れ目や読点で分け、言葉の途中では改行しない
// 言葉の区切りは、ブラウザ（と Node.js）に入っている Intl.Segmenter で調べる。

export const MAX_LINE = 20;
export const MAX_LINES = 2;

/** これで終わったら、字幕を区切る */
const SENTENCE_END = /[。！？!?]$/;
/** これで終わったら、区切りやすい */
const COMMA = /[、,，…]$/;
/** これのあとは、区切りやすい（助詞など） */
const PARTICLES = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'も', 'へ', 'の', 'や', 'から', 'まで', 'けど', 'ので', 'て', 'ね', 'よ', 'し', 'けれど', 'たら', 'なら']);

const wordSegmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const graphemeSegmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 文字の数（絵文字なども1文字として数える。改行は数えない） */
export function textLength(text: string): number {
  let n = 0;
  for (const g of graphemeSegmenter.segment(text)) if (g.segment !== '\n') n++;
  return n;
}

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (g) => g.segment);
}

/** 言葉の区切りで分ける */
export function words(text: string): string[] {
  return Array.from(wordSegmenter.segment(text), (s) => s.segment);
}

/** 区切りの良さ（小さいほど良い）。left は区切りの前までの文字列 */
function breakPenalty(left: string): number {
  if (SENTENCE_END.test(left)) return -10;
  if (COMMA.test(left)) return -6;
  const last = words(left).pop() ?? '';
  if (PARTICLES.has(last)) return -3;
  return 0;
}

/** 空白を整える */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ?([、。！？]) ?/g, '$1')
    .trim();
}

/**
 * 字幕1つ分（maxLine × 2行以内）の文字列を、2行に分ける。
 * 両方の行が maxLine 文字以内になる区切りのうち、左右の長さが近く、句読点や助詞のあとになるものを選ぶ。
 */
export function breakLines(text: string, maxLine = MAX_LINE): string {
  const flat = text.replace(/\n/g, '');
  const total = textLength(flat);
  if (total <= maxLine) return flat;
  const tokens = words(flat);
  let best: { at: number; score: number } | null = null;
  let left = 0;
  let leftText = '';
  for (let i = 0; i < tokens.length - 1; i++) {
    left += textLength(tokens[i]);
    leftText += tokens[i];
    const right = total - left;
    // 句読点や小さい文字で次の行が始まらないようにする
    if (/^[、。！？!?,，ー）」』]/.test(tokens[i + 1])) continue;
    if (left > maxLine || right > maxLine) continue;
    const score = Math.abs(left - right) + breakPenalty(leftText);
    if (!best || score < best.score) best = { at: i + 1, score };
  }
  if (best) return tokens.slice(0, best.at).join('') + '\n' + tokens.slice(best.at).join('');
  // どうしても区切れない（長い言葉など）ときは、文字数で区切る
  const g = graphemes(flat);
  return g.slice(0, maxLine).join('') + '\n' + g.slice(maxLine).join('');
}

/** 字幕1つ分の文字列（区切ったもの） */
function chunkText(text: string, maxLine: number, maxLines: number): string[] {
  const capacity = maxLine * maxLines;
  const tokens = words(text);
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = (upTo = current.length) => {
    const piece = current.slice(0, upTo).join('').trim();
    if (piece) chunks.push(piece);
    current = current.slice(upTo);
    length = textLength(current.join(''));
  };
  for (const token of tokens) {
    const tl = textLength(token);
    if (length + tl > capacity && current.length > 0) {
      // 入りきらないので、いまの字幕の中で一番良い区切りで区切る（半分より後ろで）
      let bestAt = current.length;
      let bestScore = Infinity;
      let acc = 0;
      let accText = '';
      for (let i = 0; i < current.length; i++) {
        acc += textLength(current[i]);
        accText += current[i];
        if (acc < capacity * 0.5) continue;
        const score = breakPenalty(accText) - acc / capacity;
        if (score < bestScore) {
          bestScore = score;
          bestAt = i + 1;
        }
      }
      flush(bestAt);
    }
    current.push(token);
    length += tl;
    // 文の終わりでは区切る
    if (SENTENCE_END.test(token)) flush();
  }
  flush();
  return chunks;
}

export interface CaptionPiece {
  text: string;
  start: number;
  end: number;
}

/**
 * しゃべった言葉（text、start〜end 秒）を、字幕に分ける。
 * 時間は文字数に合わせて分ける。字幕の終わりの「。」と「、」は表示しない。
 */
export function splitIntoCaptions(text: string, start: number, end: number, maxLine = MAX_LINE, maxLines = MAX_LINES): CaptionPiece[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const chunks = chunkText(cleaned, maxLine, maxLines)
    .map((c) => c.replace(/[。、]+$/, ''))
    .filter((c) => c.length > 0);
  const lengths = chunks.map((c) => Math.max(1, textLength(c)));
  const total = lengths.reduce((a, b) => a + b, 0);
  const pieces: CaptionPiece[] = [];
  let acc = 0;
  chunks.forEach((c, i) => {
    const a = start + ((end - start) * acc) / total;
    acc += lengths[i];
    const b = start + ((end - start) * acc) / total;
    pieces.push({ text: breakLines(c, maxLine), start: a, end: b });
  });
  return pieces;
}
