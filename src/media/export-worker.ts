// 書き出しの作業場所（Web Worker）。画面とは別の場所で、録画を読み、つなぎ、MP4 に書き出す
import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type AudioCodec,
  type InputAudioTrack,
  type InputVideoTrack,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';
import { AudioConverter } from '../core/audio-convert';
import { audioSlice, FrameScheduler, samplesFor } from '../core/frames';
import { clipLength } from '../core/timeline';
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE } from '../data/quality';
import type { ExportCommand, ExportEvent, ExportRequest } from './export-protocol';
import { errorText, openInput } from './probe';

class Canceled extends Error {}

let canceled = false;
let running = false;

const post = (event: ExportEvent) => postMessage(event);

onmessage = (e: MessageEvent<ExportCommand>) => {
  const cmd = e.data;
  if (cmd.type === 'cancel') {
    canceled = true;
    return;
  }
  if (running) return;
  running = true;
  canceled = false;
  run(cmd).finally(() => {
    running = false;
  });
};

interface Opened {
  video: InputVideoTrack;
  audio: InputAudioTrack | null;
}

async function run(req: ExportRequest): Promise<void> {
  const inputs = new Map<string, ReturnType<typeof openInput>>();
  const opened = new Map<string, Opened>();
  let writable: FileSystemWritableFileStream | null = null;
  let output: Output | null = null;
  try {
    for (const clip of req.project.clips) {
      if (opened.has(clip.sourceId)) continue;
      const file = req.files[clip.sourceId];
      if (!file) throw new Error('開けない録画があります');
      const input = openInput(file);
      inputs.set(clip.sourceId, input);
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new Error(`${file.name} に映像がありません`);
      const audioTracks = await input.getAudioTracks();
      const audio = audioTracks[0] && (await audioTracks[0].canDecode()) ? audioTracks[0] : null;
      opened.set(clip.sourceId, { video, audio });
    }

    writable = await req.target.createWritable();
    const fileStream = writable;
    let bytes = 0;
    const sink = new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        await fileStream.write({ type: 'write', position: chunk.position, data: chunk.data });
        bytes = Math.max(bytes, chunk.position + chunk.data.byteLength);
      },
    });
    const { plan } = req;
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(sink, { chunked: true }),
    });
    const videoSource = new VideoSampleSource({
      codec: req.videoCodec as VideoCodec,
      bitrate: plan.videoBitrate,
      keyFrameInterval: 2,
      sizeChangeBehavior: 'passThrough',
      transform: { width: plan.width, height: plan.height, fit: 'contain' },
    });
    const audioSource = new AudioSampleSource({
      codec: req.audioCodec as AudioCodec,
      bitrate: plan.audioBitrate,
    });
    output.addVideoTrack(videoSource, { frameRate: plan.frameRate });
    output.addAudioTrack(audioSource);
    await output.start();

    let videoDone = 0;
    let audioDone = 0;
    let lastReport = 0;
    const report = () => {
      const now = performance.now();
      if (now - lastReport < 250) return;
      lastReport = now;
      const total = Math.max(plan.duration, 1e-6);
      post({ type: 'progress', progress: Math.min(1, Math.min(videoDone, audioDone) / total) });
    };

    await Promise.all([
      writeVideo(req, opened, videoSource, (t) => {
        videoDone = t;
        report();
      }),
      writeAudio(req, opened, audioSource, (t) => {
        audioDone = t;
        report();
      }),
    ]);
    checkCanceled();
    await output.finalize();
    await writable.close();
    writable = null;
    post({ type: 'progress', progress: 1 });
    post({ type: 'done', bytes });
  } catch (e) {
    if (output && output.state !== 'finalized') await output.cancel().catch(() => undefined);
    if (writable) await writable.abort().catch(() => undefined);
    // 途中までのファイルは残さない
    await (req.target as FileSystemFileHandle & { remove?: () => Promise<void> }).remove?.().catch(() => undefined);
    if (e instanceof Canceled || canceled) post({ type: 'canceled' });
    else post({ type: 'error', message: errorText(e) });
  } finally {
    for (const input of inputs.values()) input.dispose();
  }
}

function checkCanceled(): void {
  if (canceled) throw new Canceled();
}

/** 映像：かたまりを順に読み、出力のコマの間隔にそろえて書く */
async function writeVideo(
  req: ExportRequest,
  opened: Map<string, Opened>,
  source: VideoSampleSource,
  onProgress: (seconds: number) => void,
): Promise<void> {
  const { plan } = req;
  const scheduler = new FrameScheduler(plan.frameRate);
  const frameDuration = 1 / plan.frameRate;
  let black: VideoSample | null = null;
  let outStart = 0;

  const emit = async (sample: VideoSample, from: number, to: number) => {
    const [first, last] = scheduler.take(from, to);
    for (let k = first; k < last; k++) {
      checkCanceled();
      const copy = sample.clone();
      copy.setTimestamp(scheduler.timeOf(k));
      copy.setDuration(frameDuration);
      await source.add(copy);
      copy.close();
    }
    onProgress(scheduler.timeOf(last));
  };

  for (const clip of req.project.clips) {
    const { video } = opened.get(clip.sourceId)!;
    const length = clipLength(clip);
    const outEnd = outStart + length;
    let held: VideoSample | null = null;
    let heldFrom = outStart;
    const sink = new VideoSampleSink(video);
    for await (const sample of sink.samples(clip.start, clip.end)) {
      checkCanceled();
      const at = outStart + (sample.timestamp - clip.start);
      if (held) {
        // 前のコマを、次のコマが始まるところまで見せる
        await emit(held, heldFrom, Math.min(at, outEnd));
        held.close();
        heldFrom = Math.max(heldFrom, at);
      }
      held = sample;
    }
    if (held) {
      await emit(held, heldFrom, outEnd);
      held.close();
    } else {
      // 映像が1コマもなかったときは黒で埋める
      black ??= makeBlack(plan.width, plan.height);
      await emit(black, outStart, outEnd);
    }
    outStart = outEnd;
  }
  black?.close();
}

function makeBlack(width: number, height: number): VideoSample {
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, height);
  return new VideoSample(canvas, { timestamp: 0 });
}

/** 音：かたまりを順に読み、48kHz・ステレオにそろえて、途切れず重ならないように書く */
async function writeAudio(
  req: ExportRequest,
  opened: Map<string, Opened>,
  source: AudioSampleSource,
  onProgress: (seconds: number) => void,
): Promise<void> {
  const converter = new AudioConverter(OUTPUT_SAMPLE_RATE, OUTPUT_CHANNELS);
  let outStart = 0;
  for (const clip of req.project.clips) {
    const { audio } = opened.get(clip.sourceId)!;
    const length = clipLength(clip);
    const needed = samplesFor(length, OUTPUT_SAMPLE_RATE);
    let written = 0;
    const write = async (channels: Float32Array[]) => {
      const count = Math.min(channels[0]?.length ?? 0, needed - written);
      if (count <= 0) return;
      await addPlanar(source, channels, count, outStart + written / OUTPUT_SAMPLE_RATE);
      written += count;
    };
    if (audio) {
      converter.reset();
      const sink = new AudioSampleSink(audio);
      let sourceRate = 0;
      let sourceNeeded = 0;
      let sourceWritten = 0;
      for await (const sample of sink.samples(clip.start, clip.end)) {
        checkCanceled();
        if (sourceRate === 0) {
          sourceRate = sample.sampleRate;
          sourceNeeded = samplesFor(length, sourceRate);
        }
        const slice = audioSlice(sample.timestamp, sample.numberOfFrames, sourceRate, clip.start, sourceWritten, sourceNeeded);
        const channels: Float32Array[] = [];
        for (let c = 0; c < sample.numberOfChannels; c++) {
          const data = new Float32Array(slice.silence + slice.count);
          if (slice.count > 0) {
            sample.copyTo(data.subarray(slice.silence), {
              planeIndex: c,
              format: 'f32-planar',
              frameOffset: slice.offset,
              frameCount: slice.count,
            });
          }
          channels.push(data);
        }
        sample.close();
        sourceWritten += slice.silence + slice.count;
        if (channels[0].length > 0) await write(converter.push(channels, sourceRate));
        onProgress(outStart + written / OUTPUT_SAMPLE_RATE);
        if (sourceWritten >= sourceNeeded) break;
      }
    }
    // 音がない録画や、音が途中で終わっている録画は、無音で埋める
    while (written < needed) {
      checkCanceled();
      const count = Math.min(OUTPUT_SAMPLE_RATE, needed - written);
      await write(Array.from({ length: OUTPUT_CHANNELS }, () => new Float32Array(count)));
    }
    outStart += length;
    onProgress(outStart);
  }
}

/** チャンネルごとの配列から count サンプルを、1つの音のかたまりにして入れる */
async function addPlanar(source: AudioSampleSource, channels: Float32Array[], count: number, timestamp: number): Promise<void> {
  const data = new Float32Array(count * channels.length);
  channels.forEach((ch, c) => data.set(ch.subarray(0, count), c * count));
  const sample = new AudioSample({
    data,
    format: 'f32-planar',
    numberOfChannels: channels.length,
    sampleRate: OUTPUT_SAMPLE_RATE,
    timestamp,
  });
  await source.add(sample);
  sample.close();
}
