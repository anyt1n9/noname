// 自動字幕に使う AI（Whisper 系の音声認識。元の Whisper は OpenAI が MIT ライセンスで公開）。
// 配布元は Hugging Face（huggingface.co）。使う人が了承したときだけダウンロードする。

export type ModelId = 'standard' | 'light';

export interface WhisperModel {
  id: ModelId;
  label: string;
  description: string;
  /** Hugging Face の置き場所 */
  repo: string;
  device: 'webgpu' | 'wasm';
  /** 部品ごとの数値の形式（ファイルの大きさと速さが変わる） */
  dtype: Record<string, string>;
  /** 大きさの目安（MB）。配布元に問い合わせられないときに出す */
  approxMB: number;
  /** グラフィックボード（WebGPU）と、16ビットの計算が要るか */
  needsGpu: boolean;
}

export const WHISPER_MODELS: readonly WhisperModel[] = [
  {
    id: 'standard',
    label: '標準',
    description: 'グラフィックボードのあるパソコン向け。速くて正確です。',
    repo: 'onnx-community/whisper-large-v3-turbo',
    device: 'webgpu',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    approxMB: 1400,
    needsGpu: true,
  },
  {
    id: 'light',
    label: '軽いモード',
    description: 'どのパソコンでも動きます。時間がかかり、少し間違いが増えます。',
    repo: 'onnx-community/whisper-small',
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    approxMB: 250,
    needsGpu: false,
  },
];

export function whisperModel(id: ModelId): WhisperModel {
  return WHISPER_MODELS.find((m) => m.id === id) ?? WHISPER_MODELS[1];
}

/** 部品のファイル名に付く印（transformers.js の決まり） */
export const DTYPE_SUFFIX: Record<string, string> = {
  fp32: '',
  fp16: '_fp16',
  q8: '_quantized',
  int8: '_int8',
  uint8: '_uint8',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
};

/** 配布元のサイト（「外部に送る情報」の説明に使う） */
export const MODEL_HOST = 'huggingface.co';
