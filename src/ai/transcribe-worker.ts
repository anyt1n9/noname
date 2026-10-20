// 文字起こしの作業場所（Web Worker）。録画の声を 16kHz にして、Whisper 系の AI で文字にする
import { env, pipeline } from '@huggingface/transformers';
import { AudioSampleSink, type InputAudioTrack } from 'mediabunny';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { AudioConverter } from '../core/audio-convert';
import { audioSlice, samplesFor } from '../core/frames';
import { chunksToSegments, type WhisperChunk } from '../core/transcribe-plan';
import { errorText, openInput } from '../media/probe';
import type { TranscribeCommand, TranscribeEvent, TranscribeRequest } from './transcribe-protocol';

// AI の部品は Hugging Face からだけ取る。動かすためのファイル（WebAssembly）はテロッパの中のものを使う
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };

const SAMPLE_RATE = 16_000;

let canceled = false;
let running = false;
const post = (e: TranscribeEvent) => postMessage(e);

onmessage = (e: MessageEvent<TranscribeCommand>) => {
  if (e.data.type === 'cancel') {
    canceled = true;
    return;
  }
  if (running) return;
  running = true;
  canceled = false;
  void run(e.data).finally(() => {
    running = false;
  });
};

/** 声の音（複数なら混ぜる）を 16kHz・1チャンネルで読む */
async function readVoice(tracks: InputAudioTrack[], start: number, end: number): Promise<Float32Array> {
  const total = samplesFor(end - start, SAMPLE_RATE);
  const mix = new Float32Array(total);
  for (const track of tracks) {
    const converter = new AudioConverter(SAMPLE_RATE, 1);
    let written = 0;
    let sourceWritten = 0;
    let rate = 0;
    let needed = 0;
    for await (const sample of new AudioSampleSink(track).samples(start, end)) {
      if (rate === 0) {
        rate = sample.sampleRate;
        needed = samplesFor(end - start, rate);
      }
      const slice = audioSlice(sample.timestamp, sample.numberOfFrames, rate, start, sourceWritten, needed);
      const channels: Float32Array[] = [];
      for (let c = 0; c < sample.numberOfChannels; c++) {
        const data = new Float32Array(slice.silence + slice.count);
        if (slice.count > 0) {
          sample.copyTo(data.subarray(slice.silence), { planeIndex: c, format: 'f32-planar', frameOffset: slice.offset, frameCount: slice.count });
        }
        channels.push(data);
      }
      sample.close();
      sourceWritten += slice.silence + slice.count;
      if (channels.length > 0 && channels[0].length > 0) {
        const [mono] = converter.push(channels, rate);
        const n = Math.min(mono.length, total - written);
        for (let i = 0; i < n; i++) mix[written + i] += mono[i];
        written += n;
      }
      if (sourceWritten >= needed) break;
    }
  }
  if (tracks.length > 1) for (let i = 0; i < mix.length; i++) mix[i] /= tracks.length;
  return mix;
}

async function run(req: TranscribeRequest): Promise<void> {
  const inputs: ReturnType<typeof openInput>[] = [];
  try {
    // AI の部品を読み込む（初めてのときはダウンロード。次からはブラウザの中に残ったものを使う）
    const fileProgress = new Map<string, { loaded: number; total: number }>();
    const transcriber = await pipeline('automatic-speech-recognition', req.model.repo, {
      device: req.model.device,
      dtype: req.model.dtype as never,
      progress_callback: (info) => {
        if (info.status === 'progress') {
          fileProgress.set(info.file, { loaded: info.loaded, total: info.total });
          let loaded = 0;
          let total = 0;
          for (const f of fileProgress.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          post({ type: 'loading', progress: total > 0 ? loaded / total : 0, loaded, total });
        }
      },
    });
    post({ type: 'ready' });

    for (const item of req.items) {
      const input = openInput(item.file);
      inputs.push(input);
      const audioTracks = await input.getAudioTracks();
      const tracks = item.voiceTracks.map((i) => audioTracks[i]).filter((t): t is InputAudioTrack => !!t);
      if (tracks.length === 0) continue;
      for (const [start, end] of item.windows) {
        if (canceled) {
          post({ type: 'canceled' });
          return;
        }
        const audio = await readVoice(tracks, start, end);
        const output = await transcriber(audio, {
          language: 'japanese',
          task: 'transcribe',
          return_timestamps: true,
        });
        const result = (Array.isArray(output) ? output[0] : output) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
        const chunks: WhisperChunk[] = (result.chunks ?? []).map((c) => ({ text: c.text, timestamp: [c.timestamp[0], c.timestamp[1] ?? null] }));
        if (chunks.length === 0 && result.text.trim()) chunks.push({ text: result.text, timestamp: [0, end - start] });
        post({ type: 'window', sourceId: item.sourceId, range: [start, end], segments: chunksToSegments(chunks, start, end) });
      }
    }
    post({ type: 'done' });
  } catch (err) {
    if (canceled) post({ type: 'canceled' });
    else post({ type: 'error', message: errorText(err) });
  } finally {
    for (const input of inputs) input.dispose();
  }
}
