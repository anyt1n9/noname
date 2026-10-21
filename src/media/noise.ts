// 録画の静かな部分を読んで、雑音の音色を調べる（v0.7）。読むのは数秒分だけなので、画面側で行う
import type { AudioBufferSink } from 'mediabunny';
import { measureNoise, type NoiseProfile } from '../core/denoise';
import type { SourceRegistry } from './registry';

/** from〜to 秒の音を、チャンネルを混ぜた1本の音にして読む */
async function readMono(sink: AudioBufferSink, from: number, to: number): Promise<{ data: Float32Array; rate: number }> {
  const parts: Float32Array[] = [];
  let rate = 0;
  for await (const { buffer, timestamp } of sink.buffers(from, to)) {
    rate = buffer.sampleRate;
    const a = Math.max(0, Math.round((from - timestamp) * rate));
    const b = Math.min(buffer.length, Math.round((to - timestamp) * rate));
    if (b <= a) continue;
    const mono = new Float32Array(b - a);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = a; i < b; i++) mono[i - a] += d[i] / buffer.numberOfChannels;
    }
    parts.push(mono);
  }
  const data = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    data.set(p, o);
    o += p.length;
  }
  return { data, rate };
}

export async function measureSourceNoise(registry: SourceRegistry, sourceId: string, tracks: number[], ranges: [number, number][]): Promise<NoiseProfile | null> {
  const source = await registry.open(sourceId).catch(() => null);
  if (!source) return null;
  const sinks = tracks.map((i) => source.audioSinks[i]).filter((s): s is AudioBufferSink => !!s);
  if (sinks.length === 0) return null;
  const pieces: Float32Array[] = [];
  let rate = 0;
  for (const [from, to] of ranges) {
    // 声の音が複数あれば混ぜる
    let piece: Float32Array | null = null;
    for (const sink of sinks) {
      const r = await readMono(sink, from, to);
      if (r.rate === 0) continue;
      rate = r.rate;
      if (!piece) piece = r.data;
      else for (let i = 0; i < Math.min(piece.length, r.data.length); i++) piece[i] += r.data[i];
    }
    if (piece) pieces.push(piece);
  }
  return rate > 0 ? measureNoise(pieces, rate) : null;
}
