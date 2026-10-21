// 書き出しを始める・やめる（画面側）
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import type { ExportPlan } from '../core/export-plan';
import type { Project } from '../core/project';
import { AUDIO_CODEC_PREFERENCE, OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE, VIDEO_CODEC_PREFERENCE } from '../data/quality';
import type { ExportEvent, ExportRequest } from './export-protocol';

export interface CodecChoice {
  video: { codec: string; label: string };
  audio: { codec: string; label: string };
  /** 標準の形式（H.264 と AAC）が使えなかったか */
  fallback: boolean;
}

/** このパソコンで書き出せる形式を選ぶ。どれも使えなければ null */
export async function chooseCodecs(plan: ExportPlan): Promise<CodecChoice | null> {
  let video: CodecChoice['video'] | null = null;
  for (const v of VIDEO_CODEC_PREFERENCE) {
    if (await canEncodeVideo(v.codec, { width: plan.width, height: plan.height, bitrate: plan.videoBitrate })) {
      video = { codec: v.codec, label: v.label };
      break;
    }
  }
  let audio: CodecChoice['audio'] | null = null;
  for (const a of AUDIO_CODEC_PREFERENCE) {
    const ok = await canEncodeAudio(a.codec, {
      numberOfChannels: OUTPUT_CHANNELS,
      sampleRate: OUTPUT_SAMPLE_RATE,
      bitrate: plan.audioBitrate,
    });
    if (ok) {
      audio = { codec: a.codec, label: a.label };
      break;
    }
  }
  if (!video || !audio) return null;
  return {
    video,
    audio,
    fallback: video.codec !== VIDEO_CODEC_PREFERENCE[0].codec || audio.codec !== AUDIO_CODEC_PREFERENCE[0].codec,
  };
}

export class ExportJob {
  private worker: Worker;

  constructor(private onEvent: (e: ExportEvent) => void) {
    this.worker = new Worker(new URL('./export-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<ExportEvent>) => {
      this.onEvent(e.data);
      if (e.data.type !== 'progress') this.worker.terminate();
    };
    this.worker.onerror = (e) => {
      this.onEvent({ type: 'error', message: e.message || '書き出しの作業場所が止まりました' });
      this.worker.terminate();
    };
  }

  start(
    project: Project,
    files: Record<string, File>,
    plan: ExportPlan,
    codecs: CodecChoice,
    target: FileSystemFileHandle,
    assets: Record<string, Blob>,
    speech: [number, number][],
  ): void {
    const req: ExportRequest = {
      type: 'start',
      project,
      files,
      plan,
      videoCodec: codecs.video.codec,
      audioCodec: codecs.audio.codec,
      target,
      assets,
      speech,
    };
    this.worker.postMessage(req);
  }

  cancel(): void {
    this.worker.postMessage({ type: 'cancel' });
  }
}
