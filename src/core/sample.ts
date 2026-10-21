// 練習用の見本の録画（v1.0）。画面も声もプログラムで作る（自作なので権利の心配がない）。
// 声は本物のことばではなく、しゃべっているように聞こえる音。練習用の字幕は別に用意する。
import { Noise } from './synth';

export const SAMPLE_SECONDS = 46;
export const SAMPLE_WIDTH = 1280;
export const SAMPLE_HEIGHT = 720;
export const SAMPLE_FRAME_RATE = 24;
/** 作りを変えたら番号を上げる（ブラウザの中に残っている古い見本を使わないように） */
export const SAMPLE_FILE_NAME = 'teroppa-sample-v1.mp4';

export interface SampleLine {
  start: number;
  end: number;
  /** 練習用の字幕（わざとまちがいを2か所入れてある） */
  subtitle: string;
  /** 正しい文 */
  correct: string;
  filler?: boolean;
}

export const SAMPLE_LINES: readonly SampleLine[] = [
  { start: 0.8, end: 4.2, subtitle: 'こんにちは。今日はテロッパの練習をします', correct: 'こんにちは。今日はテロッパの練習をします' },
  { start: 5.0, end: 8.6, subtitle: 'この見本には、しゃべっていない「間」が入っています', correct: 'この見本には、しゃべっていない「間」が入っています' },
  { start: 12.0, end: 12.8, subtitle: 'えー', correct: 'えー', filler: true },
  { start: 13.6, end: 17.4, subtitle: 'まずは「間」を切って、動画を短くしてみましょう', correct: 'まずは「間」を切って、動画を短くしてみましょう' },
  { start: 18.2, end: 22.0, subtitle: '次に字幕を入れて、まちがいを治してみましょう', correct: '次に字幕を入れて、まちがいを直してみましょう' },
  { start: 25.0, end: 29.0, subtitle: 'ここからボス戦です。画像や矢印も入れてみましょう', correct: 'ここからボス戦です。画像や矢印も入れてみましょう' },
  { start: 29.8, end: 33.4, subtitle: 'BGM を選ぶと、しゃべっている間は小さくなります', correct: 'BGM を選ぶと、しゃべっている間は小さくなります' },
  { start: 36.0, end: 39.6, subtitle: '最後に書き出して、動画を完成させましょう', correct: '最後に書き出して、動画を完成させましょう' },
  { start: 40.4, end: 43.0, subtitle: 'おつかれさまでした。また明日！', correct: 'おつかれさまでした。またね！' },
];

/** ボスが出てくる時間（画面の絵に使う） */
export const SAMPLE_BOSS: [number, number] = [24.5, 35.5];

/** 母音の音色（ことばの音に聞こえるよう、声の高さの何倍あたりを強くするか） */
const VOWELS: [number, number][] = [
  [800, 1200], // あ
  [300, 2300], // い
  [350, 1300], // う
  [500, 1900], // え
  [500, 850], // お
];

function resonance(f: number, center: number, width: number): number {
  const d = (f - center) / width;
  return 1 / (1 + d * d);
}

/** 見本の録画の音を、少しずつ作る（1チャンネル） */
export class SampleAudio {
  private phase = 0;
  private position = 0;
  private noise = new Noise(42);
  private hum = 0;

  constructor(private rate: number) {}

  next(count: number): Float32Array {
    const out = new Float32Array(count);
    const rate = this.rate;
    // 母音ごとの倍音の強さは、音節ごとに計算しておく
    let cacheKey = '';
    let weights: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = (this.position + i) / rate;
      // 部屋の雑音（ぶーんという音と、さーという音）
      this.hum += (2 * Math.PI * 60) / rate;
      let v = 0.004 * Math.sin(this.hum) + 0.003 * this.noise.next();
      const lineIndex = SAMPLE_LINES.findIndex((l) => t >= l.start && t < l.end);
      if (lineIndex >= 0) {
        const line = SAMPLE_LINES[lineIndex];
        const local = t - line.start;
        const edge = Math.min(1, local / 0.03, (line.end - t) / 0.03);
        let f0: number;
        let env: number;
        let vowel: [number, number];
        let key: string;
        if (line.filler) {
          // 「えー」：同じ高さ・同じ音色でのばす
          f0 = 125;
          env = 0.85;
          vowel = VOWELS[3];
          key = 'filler';
        } else {
          const syllables = 6.5;
          const n = Math.floor(local * syllables);
          const u = local * syllables - n;
          f0 = 135 + 20 * Math.sin(2 * Math.PI * 1.7 * t + lineIndex) + 12 * Math.sin(2 * Math.PI * 4.1 * t);
          env = Math.pow(Math.sin(Math.PI * u), 0.6);
          vowel = VOWELS[(n * 7 + lineIndex * 3) % VOWELS.length];
          key = `${lineIndex}:${n}`;
          // 音節の始まりに、こすれる音（子音の代わり）を少し
          if (u < 0.08 && (n + lineIndex) % 3 === 0) v += 0.05 * this.noise.next() * (1 - u / 0.08);
        }
        this.phase += (2 * Math.PI * f0) / rate;
        if (key !== cacheKey) {
          cacheKey = key;
          const harmonics = Math.floor(3800 / f0);
          weights = [];
          for (let k = 1; k <= harmonics; k++) {
            const f = k * f0;
            weights.push((resonance(f, vowel[0], 110) + 0.6 * resonance(f, vowel[1], 150)) / Math.sqrt(k));
          }
        }
        let voice = 0;
        for (let k = 0; k < weights.length; k++) voice += weights[k] * Math.sin((k + 1) * this.phase);
        v += 0.12 * voice * env * edge;
      } else {
        // しゃべっていない間も、声の高さの位置は進めておく
        this.phase += (2 * Math.PI * 130) / rate;
      }
      if (this.phase > 1e6) this.phase -= 2 * Math.PI * Math.floor(this.phase / (2 * Math.PI));
      out[i] = Math.max(-0.95, Math.min(0.95, v));
    }
    this.position += count;
    return out;
  }
}

/** 練習用の字幕（録画の中の時刻） */
export function sampleSubtitles(): { start: number; end: number; text: string }[] {
  return SAMPLE_LINES.map((l) => ({ start: l.start, end: l.end, text: l.subtitle }));
}
