// 書き出しの作業場所（Web Worker）とのやりとりの形
import type { ExportPlan } from '../core/export-plan';
import type { Project } from '../core/project';

export interface ExportRequest {
  type: 'start';
  project: Project;
  /** 録画の ID → ファイル */
  files: Record<string, File>;
  plan: ExportPlan;
  videoCodec: string;
  audioCodec: string;
  /** 書き出し先のファイル */
  target: FileSystemFileHandle;
}

export interface ExportCancel {
  type: 'cancel';
}

export type ExportCommand = ExportRequest | ExportCancel;

export type ExportEvent =
  | { type: 'progress'; progress: number }
  | { type: 'done'; bytes: number }
  | { type: 'canceled' }
  | { type: 'error'; message: string };
