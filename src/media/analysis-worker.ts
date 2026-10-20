// 録画の音を調べる作業場所（Web Worker）。入っている音それぞれについて、大きさの記録を作る
import { AudioSampleSink } from 'mediabunny';
import { LevelAccumulator, peakBinCount } from '../core/peaks';
import { errorText, openInput } from './probe';

export interface AnalysisRequest {
  file: File;
  endTime: number;
  /** 調べる音の番号（録画に入っている順） */
  tracks: number[];
}

export type AnalysisEvent =
  | { type: 'track'; track: number; peaks: Float32Array; rms: Float32Array; progress: number; done: boolean }
  | { type: 'skip'; track: number }
  | { type: 'finished' }
  | { type: 'error'; message: string };

const post = (e: AnalysisEvent) => postMessage(e);

onmessage = async (e: MessageEvent<AnalysisRequest>) => {
  const { file, endTime, tracks } = e.data;
  const input = openInput(file);
  try {
    const audioTracks = await input.getAudioTracks();
    for (const index of tracks) {
      const track = audioTracks[index];
      if (!track || !(await track.canDecode())) {
        post({ type: 'skip', track: index });
        continue;
      }
      const acc = new LevelAccumulator(peakBinCount(endTime));
      const sink = new AudioSampleSink(track);
      let last = performance.now();
      for await (const sample of sink.samples()) {
        const channels: Float32Array[] = [];
        for (let c = 0; c < sample.numberOfChannels; c++) {
          const data = new Float32Array(sample.numberOfFrames);
          sample.copyTo(data, { planeIndex: c, format: 'f32-planar' });
          channels.push(data);
        }
        acc.add(sample.timestamp, sample.sampleRate, channels);
        const t = sample.timestamp + sample.duration;
        sample.close();
        const now = performance.now();
        if (now - last > 1500) {
          last = now;
          post({ type: 'track', track: index, peaks: acc.peaks.slice(), rms: acc.rms(), progress: Math.min(1, t / endTime), done: false });
        }
      }
      post({ type: 'track', track: index, peaks: acc.peaks, rms: acc.rms(), progress: 1, done: true });
    }
    post({ type: 'finished' });
  } catch (err) {
    post({ type: 'error', message: errorText(err) });
  } finally {
    input.dispose();
  }
};
