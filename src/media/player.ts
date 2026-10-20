// プレビューの再生。タイムラインに並んだかたまりを、順につないで映像と音を出す
import type { AudioBufferSink } from 'mediabunny';
import { activeTracks, emptyProject, sourceAudio, type Clip, type Project } from '../core/project';
import { clamp } from '../core/time';
import { clipLength, clipStarts, locate, totalDuration } from '../core/timeline';
import { drawOverlays, overlaysReady, prepareOverlays } from './compose';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, type SourceRegistry } from './registry';

/** 再生を始めるまでの余裕（秒）。最初の映像と音を用意する時間 */
const START_LEAD = 0.15;
/** 音をどれだけ先まで用意しておくか（秒） */
const AUDIO_AHEAD = 1;

export interface PlayerState {
  time: number;
  playing: boolean;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Player {
  private project: Project = emptyProject();
  private starts: number[] = [];
  private total = 0;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private playingNow = false;
  private pausedAt = 0;
  private ctxStart = 0;
  private timelineStart = 0;
  /** 再生や移動のたびに増やす。古い処理はこれを見て止まる */
  private generation = 0;
  private drawToken = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private draw2d: CanvasRenderingContext2D;

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

  /** 録画が開けるようになったときなどに、いまの位置を描き直す */
  refresh(): void {
    if (!this.playingNow) void this.drawAt(this.pausedAt);
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

  async play(): Promise<void> {
    if (this.playingNow || this.total <= 0) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
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
    void this.runVideo(gen, from);
    void this.runAudio(gen, from);
    void this.tick(gen);
    this.emit();
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
          const showAt = clipStart + Math.max(0, frame.timestamp - clip.start);
          const hideAt = clipStart + Math.min(length, frame.timestamp + frame.duration - clip.start);
          while (gen === this.generation && this.currentTime() < showAt) await nextFrame();
          if (gen !== this.generation) return;
          // 表示が間に合わなかったコマは飛ばす
          if (this.currentTime() > hideAt + 0.05) continue;
          this.draw2d.drawImage(frame.canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
          this.overlay(Math.max(showAt, this.currentTime()));
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
    trackGain.connect(this.gain!);
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

  /**
   * 録画の1つの音だけを、from 秒から seconds 秒だけ鳴らす（どれが自分の声かを聴き比べるため）。
   * 再生中なら止める。
   */
  async listen(sourceId: string, trackIndex: number, from: number, seconds: number): Promise<void> {
    this.pause();
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.generation++;
    const gen = this.generation;
    this.stopAudio();
    const source = await this.registry.open(sourceId).catch(() => null);
    const sink = source?.audioSinks[trackIndex];
    if (!sink || gen !== this.generation) return;
    const ctx = this.ctx;
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

  /** 聴き比べを止める */
  stopListening(): void {
    if (this.playingNow) return;
    this.generation++;
    this.stopAudio();
  }

  private stopAudio(): void {
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
      this.overlay(time);
    } catch (e) {
      console.warn('プレビューの映像を読めませんでした', e);
    }
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
