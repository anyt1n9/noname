// 声の仕上げ（v0.7）の数値

/** 声の大きさの目標（LUFS）。BGM やゲームの音を足して、YouTube の基準（-14 LUFS くらい）に近くなるようにする */
export const VOICE_TARGET_LUFS = -16;
/** 自動で変える声の大きさの上限（dB） */
export const MAX_VOICE_BOOST_DB = 12;
export const MAX_VOICE_CUT_DB = 12;

/** 音が割れないように抑える上限（dBFS）。これより大きい音はなめらかに小さくする */
export const LIMIT_CEILING_DB = -1;

/** 雑音を減らす強さ */
export type DenoiseStrength = 'weak' | 'strong';
export const DENOISE_STRENGTHS: readonly { value: DenoiseStrength; label: string; over: number; floor: number }[] = [
  { value: 'weak', label: '弱く', over: 1.5, floor: 0.25 },
  { value: 'strong', label: '強く', over: 2.2, floor: 0.1 },
];
/** 雑音の特徴を調べるのに使う、静かな部分の長さの合計（秒） */
export const NOISE_SAMPLE_SECONDS = 8;

/** 口ぐせとして見つける言葉（字幕の文字から） */
export const FILLER_WORDS = ['えー', 'えーと', 'ええと', 'えっと', 'あー', 'あのー', 'あの', 'うーん', 'うー', 'んー', 'まあ', 'まー', 'なんか', 'そのー', 'えへへ'];
/** 音から口ぐせ（「えー」「あー」など、同じ音をのばす声）を見つけるときの長さ（秒） */
export const FILLER_MIN_SECONDS = 0.3;
export const FILLER_MAX_SECONDS = 1.6;
/** 口ぐせの前後に、しゃべっていない時間がこれだけある（秒） */
export const FILLER_PAUSE_SECONDS = 0.15;
