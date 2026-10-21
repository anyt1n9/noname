// テロッパに入っている BGM（v0.5）。どの曲も src/core/music.ts でプログラムで作る（自作の曲）。
// 並びの書き方：1小節を steps 個の目盛りに分け、目盛りごとに空白で区切って書く。
//   数字 … 和音の何番目の音か（0 が根の音。和音の音の数を超えると1つ上の高さ）
//   c … 和音をまとめて鳴らす　x … 打楽器を鳴らす　- … 前の音をのばす　. … 休み
//   後ろに ! を付けると強く、? を付けると弱く鳴らす

export type Instrument = 'pluck' | 'epiano' | 'pad' | 'bass' | 'chip' | 'chipBass' | 'bell' | 'kick' | 'snare' | 'hat' | 'openHat';

export interface MusicPart {
  instrument: Instrument;
  gain: number;
  /** 左右の位置（-1 が左、1 が右） */
  pan?: number;
  /** 高さを何オクターブ動かすか */
  octave?: number;
  /** 1小節の目盛りの数 */
  steps: number;
  /** 小節ごとの並び。順に使い、足りなければくり返す */
  bars: string[];
  /** やまびこ（響き）の量 0〜1 */
  echo?: number;
}

export interface MusicTrack {
  id: string;
  label: string;
  /** どんな動画に合うか */
  mood: string;
  bpm: number;
  /** 小節ごとの和音。この数がくり返しの長さになる */
  chords: string[];
  parts: MusicPart[];
}

const FOUR_HATS = 'x x? x x? x x? x x?';

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    id: 'sunny',
    label: '明るい',
    mood: 'ゲーム実況・楽しい話',
    bpm: 116,
    chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'],
    parts: [
      { instrument: 'pad', gain: 0.16, octave: 1, steps: 1, bars: ['c'] },
      { instrument: 'pluck', gain: 0.32, octave: 1, pan: 0.25, steps: 8, echo: 0.3, bars: ['0 1 2 3 4 3 2 1', '0 1 2 3 4 3 2 3'] },
      { instrument: 'bass', gain: 0.5, octave: -1, steps: 8, bars: ['0 - 0 . 0 - 2 .'] },
      { instrument: 'kick', gain: 0.6, steps: 16, bars: ['X . . . . . x . x . . . . . . .'] },
      { instrument: 'snare', gain: 0.32, steps: 16, bars: ['. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . x? x'] },
      { instrument: 'hat', gain: 0.14, steps: 8, bars: [FOUR_HATS] },
    ],
  },
  {
    id: 'calm',
    label: 'おだやか',
    mood: '解説・雑談',
    bpm: 82,
    chords: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7', 'Fmaj7', 'Em7', 'Dm7', 'G7'],
    parts: [
      { instrument: 'epiano', gain: 0.3, octave: 1, steps: 8, echo: 0.25, bars: ['c - - . . c? - .', 'c - - . . . c? -'] },
      { instrument: 'bass', gain: 0.42, octave: -1, steps: 8, bars: ['0 - - - . 2 0 -'] },
      { instrument: 'kick', gain: 0.45, steps: 16, bars: ['x . . . . . . . x . x? . . . . .'] },
      { instrument: 'snare', gain: 0.2, steps: 16, bars: ['. . . . x . . . . . . . x . . .'] },
      { instrument: 'hat', gain: 0.1, steps: 16, bars: ['x . x? . x . x? . x . x? . x . x? .'] },
      { instrument: 'bell', gain: 0.1, octave: 2, steps: 8, echo: 0.45, bars: ['2 - - - . . . .', '. . . . 1 - - -', '0 - - - . . . .', '. . . . 1 - 2 -'] },
    ],
  },
  {
    id: 'game',
    label: 'わくわく',
    mood: 'アクション・対戦の実況',
    bpm: 140,
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'],
    parts: [
      { instrument: 'chip', gain: 0.2, octave: 1, pan: -0.3, steps: 16, echo: 0.2, bars: ['0 1 2 3 0 1 2 3 0 1 2 3 0 1 2 3', '3 2 1 0 3 2 1 0 3 2 1 0 3 2 1 0'] },
      { instrument: 'chip', gain: 0.13, octave: 2, pan: 0.3, steps: 8, bars: ['0 - 1 - 2 - 1 0', '2 - - - 1 - 0 -', '0 - 1 - 2 - 3 -', '2 - - - - - . .'] },
      { instrument: 'chipBass', gain: 0.34, octave: -1, steps: 8, bars: ['0 3 0 3 0 3 0 3'] },
      { instrument: 'kick', gain: 0.5, steps: 16, bars: ['X . . . x . . . x . . . x . . .'] },
      { instrument: 'snare', gain: 0.3, steps: 16, bars: ['. . . . x . . . . . . . x . . .', '. . . . x . . . . . . . x . x x'] },
      { instrument: 'hat', gain: 0.08, steps: 16, bars: ['x x? x x? x x? x x? x x? x x? x x? x x?'] },
    ],
  },
  {
    id: 'quiet',
    label: 'しっとり',
    mood: '落ち着いた解説・しんみりした話',
    bpm: 70,
    chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G'],
    parts: [
      { instrument: 'pad', gain: 0.24, octave: 1, steps: 1, bars: ['c'] },
      { instrument: 'bass', gain: 0.26, octave: -1, steps: 2, bars: ['0 -'] },
      { instrument: 'pluck', gain: 0.12, octave: 1, pan: -0.2, steps: 8, echo: 0.35, bars: ['0 . 2 . 3 . 2 .'] },
      { instrument: 'bell', gain: 0.14, octave: 2, pan: 0.2, steps: 8, echo: 0.5, bars: ['2 - - - . . . .', '. . 3 - - - . .', '4 - - - . . 3 -', '. . . . . . . .'] },
    ],
  },
  {
    id: 'cool',
    label: 'かっこいい',
    mood: '紹介・まとめ・攻略',
    bpm: 96,
    chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'C'],
    parts: [
      { instrument: 'pad', gain: 0.09, octave: 1, steps: 1, bars: ['c'] },
      { instrument: 'pluck', gain: 0.22, octave: 1, steps: 16, echo: 0.3, bars: ['. . c . . . c . . . c . . c? . .'] },
      { instrument: 'bass', gain: 0.5, octave: -1, steps: 16, bars: ['0 - . 0 . . 0 - . . 0 . 2 . 3 .'] },
      { instrument: 'kick', gain: 0.55, steps: 16, bars: ['X . . . . . x . . . x . . . . .'] },
      { instrument: 'snare', gain: 0.34, steps: 16, bars: ['. . . . x . . . . . . . x . . .'] },
      { instrument: 'hat', gain: 0.11, steps: 16, bars: ['x . x? x x . x? . x . x? x x . x? .'] },
      { instrument: 'openHat', gain: 0.07, steps: 16, bars: ['. . . . . . . . . . . . . . x .'] },
    ],
  },
];

export function musicTrack(id: string): MusicTrack | undefined {
  return MUSIC_TRACKS.find((t) => t.id === id);
}

/** BGM の大きさの初期値（声より小さくする） */
export const DEFAULT_BGM_VOLUME = 0.35;
/** しゃべっている間の BGM の大きさ（ふだんの大きさに対する割合） */
export const DUCK_LEVEL = 0.3;
/** しゃべり始める少し前から小さくし始める（秒） */
export const DUCK_ATTACK = 0.25;
/** しゃべり終わってから元の大きさに戻すまで（秒） */
export const DUCK_RELEASE = 0.6;
/** この長さより短い「しゃべっていない時間」は、小さいままにする（秒） */
export const DUCK_HOLD = 0.8;
/** BGM の始まりと終わりのフェード（秒） */
export const BGM_FADE_IN = 1.5;
export const BGM_FADE_OUT = 3;

/** 自分で用意した曲として読み込める形式 */
export const MUSIC_EXTENSIONS = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;
/** 長すぎる曲は入れない（作品ファイルとメモリに入れるため） */
export const MAX_MUSIC_SECONDS = 10 * 60;
export const MAX_MUSIC_BYTES = 40 * 1024 * 1024;
