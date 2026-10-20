// 書き出しの音。かたまりごとに、鳴らす音（声・ゲームの音など）を読んで混ぜ、48kHz・ステレオで書く
import { AudioSample, AudioSampleSink, type AudioSampleSource, type InputAudioTrack } from 'mediabunny';
import { AudioConverter } from '../core/audio-convert';
import { audioSlice, samplesFor } from '../core/frames';
import { activeTracks, sourceAudio, type Clip, type Project } from '../core/project';
import { clipLength } from '../core/timeline';
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE } from '../data/quality';

/** 1回に混ぜる長さ（サンプル数） */
const BLOCK = OUTPUT_SAMPLE_RATE / 2;

/**
 * 1つの音の、かたまりの範囲を順に読み、48kHz・ステレオにそろえて、必要な数ずつ取り出す。
 * 音が途切れていたり早く終わったりしても、無音で埋めて長さを合わせる。
 */
export class TrackReader {
  private iterator: AsyncGenerator<AudioSample, void, unknown>;
  private converter = new AudioConverter(OUTPUT_SAMPLE_RATE, OUTPUT_CHANNELS);
  private chunks: Float32Array[][] = [];
  private queued = 0;
  private headOffset = 0;
  private sourceRate = 0;
  private sourceNeeded = 0;
  private sourceWritten = 0;
  private ended = false;

  constructor(
    track: InputAudioTrack,
    private clip: Clip,
  ) {
    this.iterator = new AudioSampleSink(track).samples(clip.start, clip.end);
  }

  /** count サンプルを取り出す（チャンネルごとの配列） */
  async read(count: number): Promise<Float32Array[]> {
    while (this.queued < count && !this.ended) await this.pull();
    const out = Array.from({ length: OUTPUT_CHANNELS }, () => new Float32Array(count));
    let filled = 0;
    while (filled < count && this.chunks.length > 0) {
      const head = this.chunks[0];
      const available = head[0].length - this.headOffset;
      const take = Math.min(available, count - filled);
      for (let c = 0; c < OUTPUT_CHANNELS; c++) out[c].set(head[c].subarray(this.headOffset, this.headOffset + take), filled);
      filled += take;
      this.headOffset += take;
      this.queued -= take;
      if (this.headOffset >= head[0].length) {
        this.chunks.shift();
        this.headOffset = 0;
      }
    }
    return out;
  }

  async close(): Promise<void> {
    await this.iterator.return(undefined);
  }

  private async pull(): Promise<void> {
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return;
    }
    const sample = next.value;
    const length = this.clip.end - this.clip.start;
    if (this.sourceRate === 0) {
      this.sourceRate = sample.sampleRate;
      this.sourceNeeded = samplesFor(length, this.sourceRate);
    }
    const slice = audioSlice(sample.timestamp, sample.numberOfFrames, this.sourceRate, this.clip.start, this.sourceWritten, this.sourceNeeded);
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
    this.sourceWritten += slice.silence + slice.count;
    if (channels.length > 0 && channels[0].length > 0) {
      const converted = this.converter.push(channels, this.sourceRate);
      if (converted[0].length > 0) {
        this.chunks.push(converted);
        this.queued += converted[0].length;
      }
    }
    if (this.sourceWritten >= this.sourceNeeded) {
      this.ended = true;
      await this.close();
    }
  }
}

export interface AudioContextForExport {
  project: Project;
  /** 録画の ID → 録画に入っている順の音（読めない音は null） */
  tracks: Map<string, (InputAudioTrack | null)[]>;
  source: AudioSampleSource;
  checkCanceled(): void;
  onProgress(seconds: number): void;
}

export async function writeAudio(ctx: AudioContextForExport): Promise<void> {
  let outStart = 0;
  for (const clip of ctx.project.clips) {
    const length = clipLength(clip);
    const needed = samplesFor(length, OUTPUT_SAMPLE_RATE);
    const available = ctx.tracks.get(clip.sourceId) ?? [];
    const readers: { reader: TrackReader; gain: number }[] = [];
    for (const { index, gain } of activeTracks(sourceAudio(ctx.project, clip.sourceId))) {
      const track = available[index];
      if (track && gain > 0) readers.push({ reader: new TrackReader(track, clip), gain });
    }
    let written = 0;
    try {
      while (written < needed) {
        ctx.checkCanceled();
        const count = Math.min(BLOCK, needed - written);
        const mix = Array.from({ length: OUTPUT_CHANNELS }, () => new Float32Array(count));
        for (const { reader, gain } of readers) {
          const part = await reader.read(count);
          for (let c = 0; c < OUTPUT_CHANNELS; c++) {
            const m = mix[c];
            const p = part[c];
            for (let i = 0; i < count; i++) m[i] += p[i] * gain;
          }
        }
        // 音が大きすぎて割れないよう、はみ出した分は切る（v0.7 でなめらかに抑える）
        for (const m of mix) for (let i = 0; i < m.length; i++) m[i] = m[i] > 1 ? 1 : m[i] < -1 ? -1 : m[i];
        await addPlanar(ctx.source, mix, count, outStart + written / OUTPUT_SAMPLE_RATE);
        written += count;
        ctx.onProgress(outStart + written / OUTPUT_SAMPLE_RATE);
      }
    } finally {
      for (const { reader } of readers) await reader.close().catch(() => undefined);
    }
    outStart += length;
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
