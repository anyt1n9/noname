// 文字起こしの作業場所（Web Worker）とのやりとりの形
import type { WhisperModel } from '../data/models';

export interface TranscribeItem {
  sourceId: string;
  file: File;
  /** 声の音の番号（複数あれば混ぜる） */
  voiceTracks: number[];
  /** 文字起こしする範囲（録画の中の時刻） */
  windows: [number, number][];
}

export interface TranscribeRequest {
  type: 'start';
  items: TranscribeItem[];
  model: WhisperModel;
}

export type TranscribeCommand = TranscribeRequest | { type: 'cancel' };

export interface TranscribedSegment {
  text: string;
  start: number;
  end: number;
}

export type TranscribeEvent =
  | { type: 'loading'; progress: number; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'window'; sourceId: string; range: [number, number]; segments: TranscribedSegment[] }
  | { type: 'done' }
  | { type: 'canceled' }
  | { type: 'error'; message: string };
