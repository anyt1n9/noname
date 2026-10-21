// 書き出しの音。かたまりごとに、鳴らす音（声・ゲームの音など）を読んで混ぜ、48kHz・ステレオで書く
import { AudioSample, AudioSampleSink, type AudioSampleSource, type InputAudioTrack } from 'mediabunny';
import { AudioConverter } from '../core/audio-convert';
import { bgmGains, type BgmEnvelope } from '../core/bgm';
import { effectsOnTimeline } from '../core/effects';
import { fadeGains } from '../core/fades';
import { audioSlice, samplesFor } from '../core/frames';
import { activeTracks, clipSpeed, sourceAudio, type Clip, type Project } from '../core/project';
import { renderSound } from '../core/sfx';
import { NoiseReducer } from '../core/denoise';
import { Limiter } from '../core/limiter';
import { TimeStretcher } from '../core/stretch';
import { clipLength } from '../core/timeline';
import { OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE } from '../data/quality';
import type { SoundId } from '../data/sfx';

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

/** 録画の音を読む係（速さを変えたかたまりでも同じように使う） */
interface SampleReader {
  read(count: number): Promise<Float32Array[]>;
  close(): Promise<void>;
}

/** 音を少しずつ加工する係（雑音を減らす・速さを変える）。入れたものを少し遅れて出す */
export interface Processor {
  push(data: Float32Array[]): Float32Array[];
  flush(): Float32Array[];
}

/** 録画の音を読みながら、順に加工する（雑音を減らす → 速さを変える） */
export class ProcessReader implements SampleReader {
  private chunks: Float32Array[][] = [];
  private queued = 0;
  private consumed = 0;
  private sourceNeeded: number;
  private flushed = false;

  constructor(
    private reader: TrackReader,
    clip: Clip,
    private processors: Processor[],
  ) {
    this.sourceNeeded = samplesFor(clip.end - clip.start, OUTPUT_SAMPLE_RATE);
  }

  async read(count: number): Promise<Float32Array[]> {
    while (this.queued < count && !this.flushed) {
      if (this.consumed < this.sourceNeeded) {
        const take = Math.min(BLOCK, this.sourceNeeded - this.consumed);
        this.consumed += take;
        let data = await this.reader.read(take);
        for (const p of this.processors) data = p.push(data);
        this.add(data);
      } else {
        // 前の係の残りを、後ろの係に通してから出し切る
        let data: Float32Array[] | null = null;
        for (const p of this.processors) {
          const pushed: Float32Array[] | null = data ? p.push(data) : null;
          const rest: Float32Array[] = p.flush();
          data = pushed ? pushed.map((d: Float32Array, c: number) => concat(d, rest[c])) : rest;
        }
        if (data) this.add(data);
        this.flushed = true;
      }
    }
    const out = Array.from({ length: OUTPUT_CHANNELS }, () => new Float32Array(count));
    let filled = 0;
    while (filled < count && this.chunks.length > 0) {
      const head = this.chunks[0];
      const take = Math.min(head[0].length, count - filled);
      for (let c = 0; c < OUTPUT_CHANNELS; c++) out[c].set(head[c].subarray(0, take), filled);
      filled += take;
      this.queued -= take;
      if (take === head[0].length) this.chunks.shift();
      else this.chunks[0] = head.map((h) => h.subarray(take));
    }
    return out;
  }

  private add(part: Float32Array[]): void {
    if (part[0].length === 0) return;
    this.chunks.push(part);
    this.queued += part[0].length;
  }

  async close(): Promise<void> {
    await this.reader.close();
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** かたまりの音を読む係を作る（声の雑音を減らす・速さを変えるときは加工する係を通す） */
function trackReaderFor(project: Project, clip: Clip, track: InputAudioTrack, index: number): SampleReader {
  const reader = new TrackReader(track, clip);
  const audio = sourceAudio(project, clip.sourceId);
  const processors: Processor[] = [];
  if (audio.denoise && audio.roles[index] === 'voice') {
    processors.push(new NoiseReducer(OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE, audio.denoise.profile, audio.denoise.strength));
  }
  if (clipSpeed(clip) !== 1) processors.push(new TimeStretcher(OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE, clipSpeed(clip)));
  return processors.length === 0 ? reader : new ProcessReader(reader, clip, processors);
}

/** BGM を順に取り出す係（最後まで来たら最初に戻る） */
export interface BgmReader {
  read(count: number): Promise<Float32Array[]>;
  close(): Promise<void>;
}

/** すでに作ってある曲（入っている曲）をくり返す */
export class LoopBuffer implements BgmReader {
  private pos = 0;
  constructor(private channels: Float32Array[]) {}
  async read(count: number): Promise<Float32Array[]> {
    const length = this.channels[0].length;
    const out = this.channels.map(() => new Float32Array(count));
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < out.length; c++) out[c][i] = this.channels[c][this.pos];
      this.pos = (this.pos + 1) % length;
    }
    return out;
  }
  async close(): Promise<void> {}
}

/** つなぎ目でぷつっと鳴らないよう、くり返しの前後を少しだけ小さくする（サンプル数） */
const LOOP_EDGE = Math.round(OUTPUT_SAMPLE_RATE * 0.01);

/** 曲のファイルを少しずつ読みながらくり返す（長い曲でもメモリに溜めない） */
export class LoopTrack implements BgmReader {
  private reader: TrackReader;
  private produced = 0;
  private length: number;
  private clip: Clip;
  constructor(
    private track: InputAudioTrack,
    duration: number,
  ) {
    this.clip = { id: 'bgm', sourceId: 'bgm', start: 0, end: duration };
    this.length = samplesFor(duration, OUTPUT_SAMPLE_RATE);
    this.reader = new TrackReader(track, this.clip);
  }
  async read(count: number): Promise<Float32Array[]> {
    const out = Array.from({ length: OUTPUT_CHANNELS }, () => new Float32Array(count));
    let filled = 0;
    while (filled < count) {
      const take = Math.min(count - filled, this.length - this.produced);
      const part = await this.reader.read(take);
      for (let c = 0; c < OUTPUT_CHANNELS; c++) {
        const o = out[c];
        for (let i = 0; i < take; i++) {
          const k = this.produced + i;
          const edge = Math.min(1, k / LOOP_EDGE, (this.length - 1 - k) / LOOP_EDGE);
          o[filled + i] = part[c][i] * edge;
        }
      }
      filled += take;
      this.produced += take;
      if (this.produced >= this.length) {
        await this.reader.close();
        this.reader = new TrackReader(this.track, this.clip);
        this.produced = 0;
      }
    }
    return out;
  }
  async close(): Promise<void> {
    await this.reader.close();
  }
}

export interface BgmForExport {
  reader: BgmReader;
  volume: number;
  envelope: BgmEnvelope;
}

export interface AudioContextForExport {
  project: Project;
  /** 録画の ID → 録画に入っている順の音（読めない音は null） */
  tracks: Map<string, (InputAudioTrack | null)[]>;
  bgm: BgmForExport | null;
  source: AudioSampleSource;
  checkCanceled(): void;
  onProgress(seconds: number): void;
}

/** 効果音を、完成した動画の時刻に合わせて足していく係 */
class EffectMixer {
  private list: { at: number; data: Float32Array }[];
  private next = 0;
  private playing: { at: number; data: Float32Array }[] = [];
  private gain: number;
  constructor(project: Project) {
    const sounds = new Map<SoundId, Float32Array>();
    this.gain = project.effectsVolume;
    this.list = effectsOnTimeline(project).map((e) => {
      let data = sounds.get(e.sound);
      if (!data) {
        data = renderSound(e.sound, OUTPUT_SAMPLE_RATE);
        sounds.set(e.sound, data);
      }
      return { at: Math.round(e.time * OUTPUT_SAMPLE_RATE), data };
    });
  }
  /** from サンプル目から count サンプルの範囲に鳴る効果音を mix に足す */
  add(mix: Float32Array[], from: number, count: number): void {
    const to = from + count;
    while (this.next < this.list.length && this.list[this.next].at < to) this.playing.push(this.list[this.next++]);
    this.playing = this.playing.filter((e) => e.at + e.data.length > from);
    for (const e of this.playing) {
      const a = Math.max(from, e.at);
      const b = Math.min(to, e.at + e.data.length);
      for (let k = a; k < b; k++) {
        const v = e.data[k - e.at] * this.gain;
        for (const m of mix) m[k - from] += v;
      }
    }
  }
}

export async function writeAudio(ctx: AudioContextForExport): Promise<void> {
  let outStart = 0;
  /** 完成した動画の何サンプル目まで書いたか（BGM・効果音・フェードの位置に使う） */
  let position = 0;
  const effects = new EffectMixer(ctx.project);
  // 音が割れないように抑える係。先読みのため、かたまりを1つ遅らせて書く
  const limiter = new Limiter(OUTPUT_SAMPLE_RATE);
  let held: { mix: Float32Array[]; count: number; timestamp: number } | null = null;
  const write = async (mix: Float32Array[], count: number, timestamp: number) => {
    if (held) {
      limiter.process(held.mix, mix);
      await addPlanar(ctx.source, held.mix, held.count, held.timestamp);
    }
    held = { mix, count, timestamp };
  };
  for (const clip of ctx.project.clips) {
    const length = clipLength(clip);
    const needed = samplesFor(length, OUTPUT_SAMPLE_RATE);
    const available = ctx.tracks.get(clip.sourceId) ?? [];
    const readers: { reader: SampleReader; gain: number }[] = [];
    for (const { index, gain } of activeTracks(sourceAudio(ctx.project, clip.sourceId))) {
      const track = available[index];
      if (!track || gain <= 0) continue;
      readers.push({ reader: trackReaderFor(ctx.project, clip, track, index), gain });
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
        const t0 = position / OUTPUT_SAMPLE_RATE;
        // つなぎ目のフェードは録画の音だけにかける（BGM は続ける）
        const fade = fadeGains(ctx.project, t0, count, OUTPUT_SAMPLE_RATE);
        if (fade) for (const m of mix) for (let i = 0; i < count; i++) m[i] *= fade[i];
        effects.add(mix, position, count);
        if (ctx.bgm) {
          const part = await ctx.bgm.reader.read(count);
          const gains = bgmGains(ctx.bgm.envelope, t0, count, OUTPUT_SAMPLE_RATE);
          const volume = ctx.bgm.volume;
          for (let c = 0; c < OUTPUT_CHANNELS; c++) {
            const m = mix[c];
            const p = part[c];
            for (let i = 0; i < count; i++) m[i] += p[i] * gains[i] * volume;
          }
        }
        position += count;
        await write(mix, count, outStart + written / OUTPUT_SAMPLE_RATE);
        written += count;
        ctx.onProgress(outStart + written / OUTPUT_SAMPLE_RATE);
      }
    } finally {
      for (const { reader } of readers) await reader.close().catch(() => undefined);
    }
    outStart += length;
  }
  const last = held as { mix: Float32Array[]; count: number; timestamp: number } | null;
  if (last) {
    limiter.process(last.mix, null);
    await addPlanar(ctx.source, last.mix, last.count, last.timestamp);
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
