// 書き出しの画質（数値は仮。使いながら調整する）

export type QualityId = 'high' | 'normal' | 'light';

export interface QualityPreset {
  id: QualityId;
  /** 画面に出す名前 */
  label: string;
  /** 短い説明 */
  description: string;
  width: number;
  height: number;
  /** 映像のビットレート（1秒あたり30コマ以下のとき） */
  videoBitrate: number;
  /** 映像のビットレート（1秒あたり30コマより多いとき） */
  videoBitrateHighFps: number;
  /** 音のビットレート */
  audioBitrate: number;
}

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  {
    id: 'high',
    label: 'きれい',
    description: 'YouTube に上げるならこれ',
    width: 1920,
    height: 1080,
    videoBitrate: 10_000_000,
    videoBitrateHighFps: 15_000_000,
    audioBitrate: 192_000,
  },
  {
    id: 'normal',
    label: 'ふつう',
    description: 'ファイルを小さめにしたいとき',
    width: 1920,
    height: 1080,
    videoBitrate: 5_000_000,
    videoBitrateHighFps: 8_000_000,
    audioBitrate: 128_000,
  },
  {
    id: 'light',
    label: '軽い',
    description: '確認用・人に送る用',
    width: 1280,
    height: 720,
    videoBitrate: 2_500_000,
    videoBitrateHighFps: 4_000_000,
    audioBitrate: 128_000,
  },
];

export const DEFAULT_QUALITY: QualityId = 'high';

export function qualityPreset(id: QualityId): QualityPreset {
  return QUALITY_PRESETS.find((q) => q.id === id) ?? QUALITY_PRESETS[0];
}

/** 書き出しに使う形式。上から順に、使えるものを選ぶ */
export const VIDEO_CODEC_PREFERENCE = [
  { codec: 'avc', label: 'H.264' },
  { codec: 'vp9', label: 'VP9' },
  { codec: 'av1', label: 'AV1' },
] as const;

export const AUDIO_CODEC_PREFERENCE = [
  { codec: 'aac', label: 'AAC' },
  { codec: 'opus', label: 'Opus' },
] as const;

/** 書き出す音の形式 */
export const OUTPUT_SAMPLE_RATE = 48_000;
export const OUTPUT_CHANNELS = 2;
