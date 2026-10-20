// 音の形（波形）を作る作業場所（Web Worker）。長い録画でも画面を止めない
import { AudioSampleSink } from 'mediabunny';
import { addToPeaks, peakBinCount, PEAK_BIN_SECONDS } from '../core/peaks';
import { errorText, openInput } from './probe';

export interface PeaksRequest {
  file: File;
  endTime: number;
}

export type PeaksEvent =
  | { type: 'partial'; peaks: Float32Array; progress: number }
  | { type: 'done'; peaks: Float32Array }
  | { type: 'none' }
  | { type: 'error'; message: string };

const post = (e: PeaksEvent) => postMessage(e);

onmessage = async (e: MessageEvent<PeaksRequest>) => {
  const { file, endTime } = e.data;
  const input = openInput(file);
  try {
    const tracks = await input.getAudioTracks();
    const track = tracks[0];
    if (!track || !(await track.canDecode())) {
      post({ type: 'none' });
      return;
    }
    const peaks = new Float32Array(peakBinCount(endTime));
    const sink = new AudioSampleSink(track);
    let last = performance.now();
    for await (const sample of sink.samples()) {
      const channels: Float32Array[] = [];
      for (let c = 0; c < sample.numberOfChannels; c++) {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { planeIndex: c, format: 'f32-planar' });
        channels.push(data);
      }
      addToPeaks(peaks, PEAK_BIN_SECONDS, sample.timestamp, sample.sampleRate, channels);
      const t = sample.timestamp + sample.duration;
      sample.close();
      const now = performance.now();
      if (now - last > 1500) {
        last = now;
        post({ type: 'partial', peaks: peaks.slice(), progress: Math.min(1, t / endTime) });
      }
    }
    post({ type: 'done', peaks });
  } catch (err) {
    post({ type: 'error', message: errorText(err) });
  } finally {
    input.dispose();
  }
};
