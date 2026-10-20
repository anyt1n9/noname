// 書き出しの映像。かたまりを順に読み、出力のコマの間隔にそろえて書く
import { VideoSample, VideoSampleSink, type InputVideoTrack, type VideoSampleSource } from 'mediabunny';
import type { ExportPlan } from '../core/export-plan';
import { FrameScheduler } from '../core/frames';
import type { Project } from '../core/project';
import { clipLength } from '../core/timeline';
import { drawOverlays, hasOverlays, prepareOverlays } from './compose';

export interface VideoContextForExport {
  project: Project;
  plan: ExportPlan;
  /** 録画の ID → 映像 */
  videos: Map<string, InputVideoTrack>;
  source: VideoSampleSource;
  checkCanceled(): void;
  onProgress(seconds: number): void;
}

export async function writeVideo(ctx: VideoContextForExport): Promise<void> {
  const { plan, source, checkCanceled, onProgress } = ctx;
  const scheduler = new FrameScheduler(plan.frameRate);
  const frameDuration = 1 / plan.frameRate;
  let black: VideoSample | null = null;
  let outStart = 0;

  // 字幕などを重ねるときは、出力の大きさのキャンバスに描いてから書く
  const compose = hasOverlays(ctx.project);
  const canvas = compose ? new OffscreenCanvas(plan.width, plan.height) : null;
  const g = canvas?.getContext('2d') ?? null;

  const emit = async (sample: VideoSample, from: number, to: number) => {
    const [first, last] = scheduler.take(from, to);
    for (let k = first; k < last; k++) {
      checkCanceled();
      const t = scheduler.timeOf(k);
      if (canvas && g) {
        await prepareOverlays(ctx.project, t);
        g.fillStyle = '#000';
        g.fillRect(0, 0, plan.width, plan.height);
        sample.drawWithFit(g, { fit: 'contain' });
        drawOverlays(g, ctx.project, t, plan.width, plan.height);
        const frame = new VideoSample(canvas, { timestamp: t, duration: frameDuration });
        await source.add(frame);
        frame.close();
      } else {
        const copy = sample.clone();
        copy.setTimestamp(t);
        copy.setDuration(frameDuration);
        await source.add(copy);
        copy.close();
      }
    }
    onProgress(scheduler.timeOf(last));
  };

  for (const clip of ctx.project.clips) {
    const video = ctx.videos.get(clip.sourceId)!;
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

