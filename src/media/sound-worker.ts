// 入っている曲を作る作業場所（Web Worker）。曲を作るのに少し時間がかかるので、画面を止めないようにする
import { renderMusic } from '../core/music';
import { musicTrack } from '../data/music';

export interface SoundRequest {
  id: number;
  trackId: string;
  sampleRate: number;
}

export type SoundResponse =
  | { id: number; ok: true; left: Float32Array; right: Float32Array; loopSeconds: number }
  | { id: number; ok: false };

onmessage = (e: MessageEvent<SoundRequest>) => {
  const { id, trackId, sampleRate } = e.data;
  const track = musicTrack(trackId);
  if (!track) {
    postMessage({ id, ok: false } satisfies SoundResponse);
    return;
  }
  const music = renderMusic(track, sampleRate);
  const [left, right] = music.channels;
  postMessage({ id, ok: true, left, right, loopSeconds: music.loopSeconds } satisfies SoundResponse, { transfer: [left.buffer, right.buffer] });
};
