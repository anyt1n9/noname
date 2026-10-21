// プレビューの再生。タイムラインに並んだかたまりを、順につないで映像と音を出す
import type { AudioBufferSink } from 'mediabunny';
import { bgmEnvelope, bgmLevel, bgmPoints } from '../core/bgm';
import { effectsOnTimeline } from '../core/effects';
import { fadeLevel, fadeWindows } from '../core/fades';
import { activeTracks, clipSpeed, emptyProject, sourceAudio, type Clip, type Project } from '../core/project';
import { TimeStretcher } from '../core/stretch';
import { clamp } from '../core/time';
import { clipLength, clipStarts, locate, totalDuration } from '../core/timeline';
import { applyZoom, drawOverlays, overlaysReady, prepareOverlays, resetZoom } from './compose';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, type SourceRegistry } from './registry';
import { assetMusic, builtinMusic, effectBuffer } from './sounds';

/** 再生を始めるまでの余裕（秒）。最初の映像と音を用意する時間 */
const START_LEAD = 0.15;
/** 音をどれだけ先まで用意しておくか（秒） */
const AUDIO_AHEAD = 1;
/** BGM の大きさの変化をどれだけ先まで予約しておくか（秒） */
const BGM_AHEAD = 6;

export interface PlayerState {
  time: number;
  playing: boolean;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function sameRanges(a: [number, number][], b: [number, number][]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Player {
  private project: Project = emptyProject();
  private starts: number[] = [];
  private total = 0;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  /** 録画の音（つなぎ目のフェードをかける）・BGM・効果音の大きさ */
  private program: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private fxGain: GainNode | null = null;
  /** しゃべっている範囲（BGM を小さくするため） */
  private speech: [number, number][] = [];
  private playingNow = false;
  private pausedAt = 0;
  private ctxStart = 0;
  private timelineStart = 0;
  /** 再生や移動のたびに増やす。古い処理はこれを見て止まる */
  private generation = 0;
  private drawToken = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private draw2d: CanvasRenderingContext2D;
  /** 止まっているときに最後に描いた映像（重ねるものだけを描き直すとき、読み直さないため） */
  private still: { key: string; canvas: OffscreenCanvas } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private registry: SourceRegistry,
    private onState: (state: PlayerState) => void,
  ) {
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    this.draw2d = canvas.getContext('2d')!;
    this.clear();
  }

  get playing(): boolean {
    return this.playingNow;
  }

  get duration(): number {
    return this.total;
  }

  /** いまの再生位置（完成した動画の秒） */
  currentTime(): number {
    if (!this.playingNow || !this.ctx) return this.pausedAt;
    const elapsed = Math.max(0, this.ctx.currentTime - this.ctxStart);
    return clamp(this.timelineStart + elapsed, 0, this.total);
  }

  setProject(project: Project): void {
    const time = this.currentTime();
    this.project = project;
    this.starts = clipStarts(project);
    this.total = totalDuration(project);
    const t = clamp(time, 0, this.total);
    if (this.playingNow && this.total > 0) {
      this.start(t);
    } else {
      if (this.playingNow) this.pause();
      this.pausedAt = t;
      void this.drawAt(t);
      this.emit();
    }
  }

  /** しゃべっている範囲（完成した動画の時刻）。次に再生するときから BGM の大きさに使う */
  setSpeech(speech: [number, number][]): void {
    if (sameRanges(speech, this.speech)) return;
    this.speech = speech;
    if (this.playingNow && this.project.bgm?.duck) this.start(this.currentTime());
  }

  /** 録画が開けるようになったときなどに、いまの位置を描き直す */
  refresh(): void {
    if (!this.playingNow) void this.drawAt(this.pausedAt);
  }

  /** 録画を開き直したときなど、覚えている映像を捨てて描き直す */
  reload(): void {
    this.still = null;
    this.refresh();
  }

  seek(time: number): void {
    const t = clamp(time, 0, this.total);
    if (this.playingNow) {
      this.start(t);
    } else {
      this.pausedAt = t;
      void this.drawAt(t);
      this.emit();
    }
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.gain = ctx.createGain();
      this.gain.connect(ctx.destination);
      const sub = () => {
        const g = ctx.createGain();
        g.connect(this.gain!);
        return g;
      };
      this.program = sub();
      this.bgmGain = sub();
      this.fxGain = sub();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  async play(): Promise<void> {
    if (this.playingNow || this.total <= 0) return;
    await this.ensureContext();
    const from = this.pausedAt >= this.total - 0.01 ? 0 : this.pausedAt;
    this.start(from);
  }

  pause(): void {
    if (!this.playingNow) return;
    this.pausedAt = this.currentTime();
    this.playingNow = false;
    this.generation++;
    this.stopAudio();
    this.emit();
  }

  toggle(): void {
    if (this.playingNow) this.pause();
    else void this.play();
  }

  dispose(): void {
    this.pause();
    void this.ctx?.close();
  }

  private start(from: number): void {
    const ctx = this.ctx!;
    this.generation++;
    const gen = this.generation;
    this.stopAudio();
    this.playingNow = true;
    this.timelineStart = from;
    this.ctxStart = ctx.currentTime + START_LEAD;
    this.scheduleFades(from);
    this.scheduleEffects(from);
    void this.runVideo(gen, from);
    void this.runAudio(gen, from);
    void this.runBgm(gen, from);
    void this.tick(gen);
    this.emit();
  }

  /** 完成した動画の時刻を、AudioContext の時刻に直す */
  private ctxTime(t: number): number {
    return this.ctxStart + (t - this.timelineStart);
  }

  /** つなぎ目のフェード：録画の音の大きさを予約する */
  private scheduleFades(from: number): void {
    const g = this.program!.gain;
    g.cancelScheduledValues(0);
    g.setValueAtTime(fadeLevel(this.project, from), this.ctx!.currentTime);
    for (const w of fadeWindows(this.project)) {
      if (w.to <= from) continue;
      const a = Math.max(w.from, from);
      g.setValueAtTime(fadeLevel(this.project, a), this.ctxTime(a));
      g.linearRampToValueAtTime(w.level1, this.ctxTime(w.to));
    }
  }

  /** 効果音を鳴らす予約をする */
  private scheduleEffects(from: number): void {
    const ctx = this.ctx!;
    this.fxGain!.gain.value = this.project.effectsVolume;
    for (const e of effectsOnTimeline(this.project)) {
      const buffer = effectBuffer(e.sound);
      if (e.time + buffer.duration <= from) continue;
      const offset = Math.max(0, from - e.time);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.fxGain!);
      node.start(this.ctxTime(e.time + offset), offset);
      this.nodes.add(node);
      node.onended = () => this.nodes.delete(node);
    }
  }

  /** BGM をくり返し鳴らし、大きさ（フェード・しゃべっている間は小さく）を少しずつ予約する */
  private async runBgm(gen: number, from: number): Promise<void> {
    const bgm = this.project.bgm;
    const g = this.bgmGain!.gain;
    g.cancelScheduledValues(0);
    g.setValueAtTime(0, this.ctx!.currentTime);
    if (!bgm) return;
    const buffer = await (bgm.track.kind === 'builtin' ? builtinMusic(bgm.track.id) : assetMusic(bgm.track.assetId));
    if (gen !== this.generation || !buffer) return;
    const ctx = this.ctx!;
    const env = bgmEnvelope(this.project, this.speech);
    // 曲の用意に時間がかかったときは、いまの位置から鳴らす
    const when = Math.max(ctx.currentTime + 0.05, this.ctxTime(from));
    const startAt = this.timelineStart + (when - this.ctxStart);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.connect(this.bgmGain!);
    node.start(when, startAt % buffer.duration);
    this.nodes.add(node);
    node.onended = () => this.nodes.delete(node);
    g.setValueAtTime(bgm.volume * bgmLevel(env, startAt), when);
    let scheduledTo = startAt;
    while (gen === this.generation && scheduledTo < this.total) {
      const until = Math.min(this.total, Math.max(this.currentTime(), startAt) + BGM_AHEAD);
      if (until > scheduledTo + 0.5 || until >= this.total) {
        for (const [t, v] of bgmPoints(env, scheduledTo, until).slice(1)) g.linearRampToValueAtTime(bgm.volume * v, this.ctxTime(t));
        scheduledTo = until;
      }
      await sleep(500);
    }
  }

  private async tick(gen: number): Promise<void> {
    while (gen === this.generation) {
      const t = this.currentTime();
      if (t >= this.total - 0.001) {
        this.pause();
        this.pausedAt = this.total;
        this.emit();
        return;
      }
      this.emit();
      await nextFrame();
    }
  }

  private async runVideo(gen: number, from: number): Promise<void> {
    const loc = locate(this.project, from);
    if (!loc) return;
    const clips = this.project.clips;
    for (let i = loc.index; i < clips.length; i++) {
      const clip = clips[i];
      const clipStart = this.starts[i];
      const length = clipLength(clip);
      const sourceFrom = i === loc.index ? loc.sourceTime : clip.start;
      const source = await this.registry.open(clip.sourceId).catch(() => null);
      if (gen !== this.generation) return;
      if (!source) {
        this.drawMissing();
        while (gen === this.generation && this.currentTime() < clipStart + length) await nextFrame();
        continue;
      }
      try {
        for await (const frame of source.canvasSink.canvases(sourceFrom, clip.end)) {
          if (gen !== this.generation) return;
          const speed = clipSpeed(clip);
          const showAt = clipStart + Math.max(0, frame.timestamp - clip.start) / speed;
          const hideAt = clipStart + Math.min(length, (frame.timestamp + frame.duration - clip.start) / speed);
          while (gen === this.generation && this.currentTime() < showAt) await nextFrame();
          if (gen !== this.generation) return;
          // 表示が間に合わなかったコマは飛ばす
          if (this.currentTime() > hideAt + 0.05) continue;
          const t = Math.max(showAt, this.currentTime());
          applyZoom(this.draw2d, this.project, t, PREVIEW_WIDTH, PREVIEW_HEIGHT);
          this.draw2d.drawImage(frame.canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
          resetZoom(this.draw2d);
          this.overlay(t);
        }
      } catch (e) {
        if (gen === this.generation) console.warn('プレビューの映像を読めませんでした', e);
      }
    }
  }

  private async runAudio(gen: number, from: number): Promise<void> {
    const loc = locate(this.project, from);
    if (!this.ctx || !this.gain || !loc) return;
    const clips = this.project.clips;
    for (let i = loc.index; i < clips.length; i++) {
      const clip = clips[i];
      const clipStart = this.starts[i];
      const sourceFrom = i === loc.index ? loc.sourceTime : clip.start;
      const source = await this.registry.open(clip.sourceId).catch(() => null);
      if (gen !== this.generation) return;
      if (!source) continue;
      // 鳴らす音（声・ゲームの音など）を、それぞれの大きさで同時に流す
      const tracks = activeTracks(sourceAudio(this.project, clip.sourceId));
      await Promise.all(
        tracks.map(({ index, gain }) => {
          const sink = source.audioSinks[index];
          if (!sink || gain <= 0) return Promise.resolve();
          return this.scheduleTrack(gen, sink, clip, clipStart, sourceFrom, gain);
        }),
      );
    }
  }

  /** 1つの音を、かたまりの範囲だけ鳴らす予約をする */
  private async scheduleTrack(
    gen: number,
    sink: AudioBufferSink,
    clip: Clip,
    clipStart: number,
    sourceFrom: number,
    gainValue: number,
  ): Promise<void> {
    const ctx = this.ctx!;
    const trackGain = ctx.createGain();
    trackGain.gain.value = gainValue;
    trackGain.connect(this.program!);
    if (clipSpeed(clip) !== 1) return this.scheduleStretched(gen, sink, clip, clipStart, sourceFrom, trackGain);
    try {
      for await (const { buffer, timestamp, duration } of sink.buffers(sourceFrom, clip.end)) {
        if (gen !== this.generation) return;
        const useFrom = Math.max(timestamp, sourceFrom);
        const useTo = Math.min(timestamp + duration, clip.end);
        if (useTo <= useFrom) continue;
        let when = this.ctxStart + (clipStart + (useFrom - clip.start) - this.timelineStart);
        let offset = useFrom - timestamp;
        let length = useTo - useFrom;
        const now = ctx.currentTime;
        if (when < now) {
          // 用意が間に合わなかった分は飛ばす
          const late = now - when;
          offset += late;
          length -= late;
          when = now;
        }
        if (length > 0.001) {
          const node = ctx.createBufferSource();
          node.buffer = buffer;
          node.connect(trackGain);
          node.start(when, offset, length);
          this.nodes.add(node);
          node.onended = () => this.nodes.delete(node);
        }
        while (gen === this.generation && when - ctx.currentTime > AUDIO_AHEAD) await sleep(100);
      }
    } catch (e) {
      if (gen === this.generation) console.warn('プレビューの音を読めませんでした', e);
    }
  }

  /** 速さを変えたかたまりの音：声の高さを変えずに速さを変えてから鳴らす */
  private async scheduleStretched(
    gen: number,
    sink: AudioBufferSink,
    clip: Clip,
    clipStart: number,
    sourceFrom: number,
    out: GainNode,
  ): Promise<void> {
    const ctx = this.ctx!;
    const speed = clipSpeed(clip);
    /** 出す音が始まる、完成した動画の時刻と、終わり */
    const startT = clipStart + (sourceFrom - clip.start) / speed;
    const endT = clipStart + clipLength(clip);
    let stretcher: TimeStretcher | null = null;
    let rate = 0;
    let written = 0;
    const schedule = (data: Float32Array[]) => {
      const room = Math.floor((endT - startT) * rate) - written;
      const length = Math.min(data[0].length, room);
      if (length <= 0) return;
      const buffer = ctx.createBuffer(data.length, length, rate);
      data.forEach((d, c) => buffer.copyToChannel(d.subarray(0, length) as Float32Array<ArrayBuffer>, c));
      let when = this.ctxTime(startT + written / rate);
      let offset = 0;
      written += length;
      const now = ctx.currentTime;
      if (when < now) {
        offset = now - when;
        when = now;
      }
      if (offset >= buffer.duration) return;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(out);
      node.start(when, offset);
      this.nodes.add(node);
      node.onended = () => this.nodes.delete(node);
    };
    try {
      for await (const { buffer, timestamp, duration } of sink.buffers(sourceFrom, clip.end)) {
        if (gen !== this.generation) return;
        const useFrom = Math.max(timestamp, sourceFrom);
        const useTo = Math.min(timestamp + duration, clip.end);
        if (useTo <= useFrom) continue;
        if (!stretcher) {
          rate = buffer.sampleRate;
          stretcher = new TimeStretcher(buffer.numberOfChannels, rate, speed);
        }
        const a = Math.round((useFrom - timestamp) * rate);
        const b = Math.min(buffer.length, Math.round((useTo - timestamp) * rate));
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).subarray(a, b));
        schedule(stretcher.push(channels));
        while (gen === this.generation && this.ctxTime(startT + written / rate) - ctx.currentTime > AUDIO_AHEAD) await sleep(100);
      }
      if (stretcher && gen === this.generation) schedule(stretcher.flush());
    } catch (e) {
      if (gen === this.generation) console.warn('プレビューの音を読めませんでした', e);
    }
  }

  /**
   * 録画の1つの音だけを、from 秒から seconds 秒だけ鳴らす（どれが自分の声かを聴き比べるため）。
   * 再生中なら止める。
   */
  async listen(sourceId: string, trackIndex: number, from: number, seconds: number): Promise<void> {
    this.pause();
    const ctx = await this.ensureContext();
    this.generation++;
    const gen = this.generation;
    this.stopAudio();
    const source = await this.registry.open(sourceId).catch(() => null);
    const sink = source?.audioSinks[trackIndex];
    if (!sink || gen !== this.generation) return;
    const start = ctx.currentTime + 0.1;
    for await (const { buffer, timestamp, duration } of sink.buffers(from, from + seconds)) {
      if (gen !== this.generation) return;
      const useFrom = Math.max(timestamp, from);
      const useTo = Math.min(timestamp + duration, from + seconds);
      if (useTo <= useFrom) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.gain!);
      node.start(Math.max(ctx.currentTime, start + (useFrom - from)), useFrom - timestamp, useTo - useFrom);
      this.nodes.add(node);
      node.onended = () => this.nodes.delete(node);
    }
  }

  /**
   * BGM や効果音を試しに鳴らす（seconds 秒まで。曲が短ければくり返す）。再生中なら止める。
   * 終わったら onEnd を呼ぶ。
   */
  async preview(sound: AudioBuffer | Promise<AudioBuffer | null>, seconds: number, volume: number, onEnd?: () => void): Promise<void> {
    this.pause();
    const ctx = await this.ensureContext();
    this.generation++;
    const gen = this.generation;
    this.stopAudio();
    const buffer = await sound;
    if (!buffer || gen !== this.generation) return;
    const length = Math.min(seconds, buffer.duration * 4);
    const gain = ctx.createGain();
    gain.connect(this.gain!);
    const start = ctx.currentTime + 0.05;
    gain.gain.setValueAtTime(volume, start);
    if (length > 2) {
      gain.gain.setValueAtTime(volume, start + length - 1);
      gain.gain.linearRampToValueAtTime(0, start + length);
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = buffer.duration < length;
    node.connect(gain);
    node.start(start, 0, length);
    this.nodes.add(node);
    node.onended = () => {
      this.nodes.delete(node);
      onEnd?.();
    };
  }

  /** 聴き比べを止める */
  stopListening(): void {
    if (this.playingNow) return;
    this.generation++;
    this.stopAudio();
  }

  private stopAudio(): void {
    if (this.ctx) {
      for (const g of [this.program, this.bgmGain]) g?.gain.cancelScheduledValues(0);
      this.bgmGain?.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // すでに止まっている
      }
    }
    this.nodes.clear();
  }

  private async drawAt(time: number): Promise<void> {
    const token = ++this.drawToken;
    const loc = locate(this.project, time);
    if (!loc) {
      this.clear();
      return;
    }
    const key = `${loc.clip.sourceId}:${loc.sourceTime}`;
    if (this.still?.key === key) {
      this.paintStill(time);
      return;
    }
    const source = await this.registry.open(loc.clip.sourceId).catch(() => null);
    if (token !== this.drawToken) return;
    if (!source) {
      this.drawMissing();
      return;
    }
    try {
      const frame = await source.canvasSink.getCanvas(loc.sourceTime);
      if (token !== this.drawToken || this.playingNow) return;
      if (frame) this.draw2d.drawImage(frame.canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      else this.clear();
      this.keepStill(key);
      this.paintStill(time);
    } catch (e) {
      console.warn('プレビューの映像を読めませんでした', e);
    }
  }

  /** 覚えている映像（拡大していない形）を、拡大と重ねるものを付けて描く */
  private paintStill(time: number): void {
    if (!this.still) return;
    this.clear();
    applyZoom(this.draw2d, this.project, time, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    this.draw2d.drawImage(this.still.canvas, 0, 0);
    resetZoom(this.draw2d);
    this.overlay(time);
  }

  private keepStill(key: string): void {
    const canvas = this.still?.canvas ?? new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    canvas.getContext('2d')!.drawImage(this.draw2d.canvas, 0, 0);
    this.still = { key, canvas };
  }

  /** 字幕などを重ねる。フォントがまだなら読み込み、止まっていれば描き直す */
  private overlay(t: number): void {
    if (!overlaysReady(this.project, t)) {
      void prepareOverlays(this.project, t).then(() => this.refresh());
    }
    drawOverlays(this.draw2d, this.project, t, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  }

  private clear(): void {
    this.draw2d.fillStyle = '#000';
    this.draw2d.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  }

  private drawMissing(): void {
    this.clear();
    this.draw2d.fillStyle = '#ccc';
    this.draw2d.font = '40px system-ui, sans-serif';
    this.draw2d.textAlign = 'center';
    this.draw2d.textBaseline = 'middle';
    this.draw2d.fillText('録画を開けません', PREVIEW_WIDTH / 2, PREVIEW_HEIGHT / 2);
  }

  private emit(): void {
    this.onState({ time: this.currentTime(), playing: this.playingNow });
  }
}
