// 練習用の見本の録画を作る作業場所（Web Worker）。画面の絵と声のような音をプログラムで作り、MP4 に書く
import { AudioSample, AudioSampleSource, Mp4OutputFormat, Output, StreamTarget, VideoSample, VideoSampleSource, type AudioCodec, type StreamTargetChunk, type VideoCodec } from 'mediabunny';
import { SAMPLE_BOSS, SAMPLE_FRAME_RATE, SAMPLE_HEIGHT, SAMPLE_SECONDS, SAMPLE_WIDTH, SampleAudio } from '../core/sample';
import { SUBTITLE_FONT_FAMILY, SUBTITLE_FONT_WEIGHT } from '../data/subtitle-style';
import { loadCaptionGlyphs } from './caption-font';
import { errorText } from './probe';

export interface SampleRequest {
  target: FileSystemFileHandle;
  videoCodec: string;
  audioCodec: string;
}

export type SampleEvent = { type: 'progress'; progress: number } | { type: 'done' } | { type: 'error'; message: string };

const RATE = 48000;
const TITLE = 'テロッパの練習';
const HUD = '練習用の見本（テロッパで作った絵と音）';

onmessage = async (e: MessageEvent<SampleRequest>) => {
  const { target, videoCodec, audioCodec } = e.data;
  let writable: FileSystemWritableFileStream | null = null;
  try {
    await loadCaptionGlyphs(`${TITLE}${HUD}SCORE0123456789ボス`);
    writable = await target.createWritable();
    const file = writable;
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          async write(chunk) {
            await file.write({ type: 'write', position: chunk.position, data: chunk.data });
          },
        }),
        { chunked: true },
      ),
    });
    const video = new VideoSampleSource({ codec: videoCodec as VideoCodec, bitrate: 1_500_000, keyFrameInterval: 2 });
    const audio = new AudioSampleSource({ codec: audioCodec as AudioCodec, bitrate: 128_000 });
    output.addVideoTrack(video, { frameRate: SAMPLE_FRAME_RATE });
    output.addAudioTrack(audio);
    await output.start();

    const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const g = canvas.getContext('2d')!;
    const frames = Math.round(SAMPLE_SECONDS * SAMPLE_FRAME_RATE);
    const sound = new SampleAudio(RATE);
    const block = RATE / 2;
    let audioDone = 0;
    for (let k = 0; k < frames; k++) {
      const t = k / SAMPLE_FRAME_RATE;
      drawScene(g, t);
      const sample = new VideoSample(canvas, { timestamp: t, duration: 1 / SAMPLE_FRAME_RATE });
      await video.add(sample);
      sample.close();
      // 音は映像に少し先立って書く
      while (audioDone < Math.min(SAMPLE_SECONDS * RATE, (t + 1) * RATE)) {
        const count = Math.min(block, SAMPLE_SECONDS * RATE - audioDone);
        const mono = sound.next(count);
        const data = new Float32Array(count * 2);
        data.set(mono, 0);
        data.set(mono, count);
        const a = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: RATE, timestamp: audioDone / RATE });
        await audio.add(a);
        a.close();
        audioDone += count;
      }
      if (k % 12 === 0) postMessage({ type: 'progress', progress: k / frames } satisfies SampleEvent);
    }
    await output.finalize();
    await writable.close();
    writable = null;
    postMessage({ type: 'done' } satisfies SampleEvent);
  } catch (err) {
    if (writable) await writable.abort().catch(() => undefined);
    postMessage({ type: 'error', message: errorText(err) } satisfies SampleEvent);
  }
};

const font = (px: number) => `${SUBTITLE_FONT_WEIGHT} ${px}px "${SUBTITLE_FONT_FAMILY}", sans-serif`;

/** 見本の画面（ゲームのような絵）を描く */
function drawScene(g: OffscreenCanvasRenderingContext2D, t: number): void {
  const W = SAMPLE_WIDTH;
  const H = SAMPLE_HEIGHT;
  const boss = t >= SAMPLE_BOSS[0] && t < SAMPLE_BOSS[1];
  // 空と地面
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, boss ? '#3a2350' : '#5ec8ff');
  sky.addColorStop(1, boss ? '#7a3b5a' : '#d6f3ff');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  g.fillStyle = boss ? '#4a3a3a' : '#5bbf4a';
  g.fillRect(0, H * 0.78, W, H * 0.22);
  // 流れる雲（ボス戦では岩）
  g.fillStyle = boss ? 'rgba(40, 20, 30, 0.6)' : 'rgba(255, 255, 255, 0.85)';
  for (let i = 0; i < 5; i++) {
    const x = ((i * 300 - t * 60) % (W + 300) + W + 300) % (W + 300) - 150;
    g.beginPath();
    g.ellipse(x, 120 + (i % 3) * 60, 90, 32, 0, 0, Math.PI * 2);
    g.fill();
  }
  // コイン
  g.fillStyle = '#ffd60a';
  for (let i = 0; i < 6; i++) {
    const x = ((i * 220 - t * 180) % (W + 220) + W + 220) % (W + 220) - 60;
    g.beginPath();
    g.ellipse(x, H * 0.62, 14 * Math.abs(Math.cos(t * 3 + i)) + 3, 16, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 主人公（青い丸）
  const px = W * 0.3 + Math.sin(t * 0.8) * W * 0.12;
  const py = H * 0.78 - 50 - Math.abs(Math.sin(t * 3.2)) * 90;
  g.fillStyle = '#2f7cf6';
  g.beginPath();
  g.arc(px, py, 50, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(px + 15, py - 12, 11, 0, Math.PI * 2);
  g.arc(px + 38, py - 12, 11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(px + 18, py - 12, 5, 0, Math.PI * 2);
  g.arc(px + 41, py - 12, 5, 0, Math.PI * 2);
  g.fill();
  // ボス（赤い大きな丸）
  if (boss) {
    const bx = W * 0.76 + Math.sin(t * 9) * 6;
    const by = H * 0.5;
    g.fillStyle = '#e5383b';
    g.beginPath();
    g.arc(bx, by, 150, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#111';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(bx - 90, by - 70);
    g.lineTo(bx - 25, by - 40);
    g.moveTo(bx + 90, by - 70);
    g.lineTo(bx + 25, by - 40);
    g.stroke();
    g.fillStyle = '#111';
    g.fillRect(bx - 60, by + 40, 120, 18);
    g.font = font(34);
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.fillText('ボス', bx, by - 170);
  }
  // 上の文字
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.font = font(26);
  g.fillStyle = 'rgba(0, 0, 0, 0.45)';
  g.fillRect(16, 16, g.measureText(HUD).width + 24, 44);
  g.fillStyle = '#fff';
  g.fillText(HUD, 28, 24);
  g.textAlign = 'right';
  g.font = font(32);
  g.fillText(`SCORE ${String(Math.floor(t * 137)).padStart(6, '0')}`, W - 28, 22);
  // はじめの題名
  if (t < 4) {
    g.globalAlpha = t < 3 ? 1 : 4 - t;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(96);
    g.lineWidth = 16;
    g.lineJoin = 'round';
    g.strokeStyle = '#123';
    g.strokeText(TITLE, W / 2, H * 0.36);
    g.fillStyle = '#ffe14d';
    g.fillText(TITLE, W / 2, H * 0.36);
    g.globalAlpha = 1;
  }
}
