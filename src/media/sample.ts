// 練習用の見本の録画を用意する（v1.0）。ブラウザの中の保存場所（OPFS）に作り、2回目からはそれを使う
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { SAMPLE_FILE_NAME, SAMPLE_HEIGHT, SAMPLE_WIDTH } from '../core/sample';
import { AUDIO_CODEC_PREFERENCE, VIDEO_CODEC_PREFERENCE } from '../data/quality';
import type { SampleEvent, SampleRequest } from './sample-worker';

/** 見本の録画（ファイルと、次に開くときのための手がかり） */
export async function sampleRecording(onProgress: (progress: number) => void): Promise<{ file: File; handle: FileSystemFileHandle }> {
  const root = await navigator.storage.getDirectory();
  try {
    const handle = await root.getFileHandle(SAMPLE_FILE_NAME);
    const file = await handle.getFile();
    if (file.size > 0) return { file, handle };
  } catch {
    // まだ作っていない
  }
  const handle = await root.getFileHandle(SAMPLE_FILE_NAME, { create: true });
  let videoCodec: string | null = null;
  for (const v of VIDEO_CODEC_PREFERENCE) {
    if (await canEncodeVideo(v.codec, { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, bitrate: 1_500_000 })) {
      videoCodec = v.codec;
      break;
    }
  }
  let audioCodec: string | null = null;
  for (const a of AUDIO_CODEC_PREFERENCE) {
    if (await canEncodeAudio(a.codec, { numberOfChannels: 2, sampleRate: 48000, bitrate: 128_000 })) {
      audioCodec = a.codec;
      break;
    }
  }
  if (!videoCodec || !audioCodec) throw new Error('このブラウザでは見本の録画を作れません');
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./sample-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SampleEvent>) => {
      if (e.data.type === 'progress') onProgress(e.data.progress);
      else {
        worker.terminate();
        if (e.data.type === 'done') resolve();
        else reject(new Error(e.data.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || '見本を作る作業場所が止まりました'));
    };
    worker.postMessage({ target: handle, videoCodec, audioCodec } satisfies SampleRequest);
  }).catch(async (e) => {
    await root.removeEntry(SAMPLE_FILE_NAME).catch(() => undefined);
    throw e;
  });
  return { file: await handle.getFile(), handle };
}
