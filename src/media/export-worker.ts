// 書き出しの作業場所（Web Worker）。画面とは別の場所で、録画を読み、つなぎ、MP4 に書き出す
import {
  AudioSampleSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSource,
  type AudioCodec,
  type InputAudioTrack,
  type InputVideoTrack,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny';
import { bgmEnvelope } from '../core/bgm';
import { renderMusic } from '../core/music';
import { musicTrack } from '../data/music';
import { OUTPUT_SAMPLE_RATE } from '../data/quality';
import { setImageSource } from './compose';
import { LoopBuffer, LoopTrack, writeAudio, type BgmForExport } from './export-audio';
import type { ExportCommand, ExportEvent, ExportRequest } from './export-protocol';
import { writeVideo } from './export-video';
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

async function run(req: ExportRequest): Promise<void> {
  const inputs = new Map<string, ReturnType<typeof openInput>>();
  const videos = new Map<string, InputVideoTrack>();
  const audios = new Map<string, (InputAudioTrack | null)[]>();
  let writable: FileSystemWritableFileStream | null = null;
  let output: Output | null = null;
  let bgm: BgmForExport | null = null;
  setImageSource(async (id) => req.assets[id] ?? null);
  try {
    bgm = await openBgm(req, inputs);
    for (const clip of req.project.clips) {
      if (videos.has(clip.sourceId)) continue;
      const file = req.files[clip.sourceId];
      if (!file) throw new Error('開けない録画があります');
      const input = openInput(file);
      inputs.set(clip.sourceId, input);
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new Error(`${file.name} に映像がありません`);
      const audioTracks = await input.getAudioTracks();
      videos.set(clip.sourceId, video);
      audios.set(clip.sourceId, await Promise.all(audioTracks.map(async (t) => ((await t.canDecode()) ? t : null))));
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
      writeVideo({
        project: req.project,
        plan,
        videos,
        source: videoSource,
        checkCanceled,
        onProgress: (t) => {
          videoDone = t;
          report();
        },
      }),
      writeAudio({
        project: req.project,
        tracks: audios,
        bgm,
        source: audioSource,
        checkCanceled,
        onProgress: (t) => {
          audioDone = t;
          report();
        },
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
    await bgm?.reader.close().catch(() => undefined);
    for (const input of inputs.values()) input.dispose();
  }
}

/** BGM を用意する（入っている曲は作り、自分で用意した曲はファイルから読む） */
async function openBgm(req: ExportRequest, inputs: Map<string, ReturnType<typeof openInput>>): Promise<BgmForExport | null> {
  const setting = req.project.bgm;
  if (!setting) return null;
  const envelope = bgmEnvelope(req.project, req.speech);
  if (setting.track.kind === 'builtin') {
    const track = musicTrack(setting.track.id);
    if (!track) return null;
    const music = renderMusic(track, OUTPUT_SAMPLE_RATE);
    return { reader: new LoopBuffer(music.channels), volume: setting.volume, envelope };
  }
  const blob = req.assets[setting.track.assetId];
  if (!blob) throw new Error('BGM の曲のファイルが見つかりません');
  const input = openInput(blob);
  inputs.set('bgm', input);
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) throw new Error('BGM の曲を読めませんでした');
  const duration = await track.computeDuration();
  return { reader: new LoopTrack(track, duration), volume: setting.volume, envelope };
}

function checkCanceled(): void {
  if (canceled) throw new Canceled();
}

