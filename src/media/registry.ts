// 開いている録画ファイルの置き場。プレビュー用の読み出し口もここで作る
import { AudioBufferSink, CanvasSink, type Input, type InputAudioTrack, type InputVideoTrack } from 'mediabunny';
import { openInput } from './probe';

/** プレビューの内部の大きさ（画面では縮めたり広げたりして表示する） */
export const PREVIEW_WIDTH = 1280;
export const PREVIEW_HEIGHT = 720;

export interface OpenSource {
  file: File;
  input: Input;
  video: InputVideoTrack;
  /** v0.1 では1つ目の音を使う（v0.2 で声を選べるようにする） */
  audio: InputAudioTrack | null;
  canvasSink: CanvasSink;
  audioSink: AudioBufferSink | null;
}

export class SourceRegistry {
  private files = new Map<string, File>();
  private opened = new Map<string, Promise<OpenSource | null>>();

  set(sourceId: string, file: File): void {
    this.release(sourceId);
    this.files.set(sourceId, file);
  }

  has(sourceId: string): boolean {
    return this.files.has(sourceId);
  }

  file(sourceId: string): File | undefined {
    return this.files.get(sourceId);
  }

  /** 書き出しの作業場所に渡すためのファイルの一覧 */
  allFiles(): Record<string, File> {
    return Object.fromEntries(this.files);
  }

  /** プレビュー用に開く。開けなければ null */
  open(sourceId: string): Promise<OpenSource | null> {
    let p = this.opened.get(sourceId);
    if (!p) {
      p = this.openNow(sourceId);
      this.opened.set(sourceId, p);
    }
    return p;
  }

  private async openNow(sourceId: string): Promise<OpenSource | null> {
    const file = this.files.get(sourceId);
    if (!file) return null;
    const input = openInput(file);
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    const audioTracks = await input.getAudioTracks();
    let audio: InputAudioTrack | null = audioTracks[0] ?? null;
    if (audio && !(await audio.canDecode())) audio = null;
    const canvasSink = new CanvasSink(video, {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      fit: 'contain',
      poolSize: 2,
    });
    return { file, input, video, audio, canvasSink, audioSink: audio ? new AudioBufferSink(audio) : null };
  }

  release(sourceId: string): void {
    const p = this.opened.get(sourceId);
    this.opened.delete(sourceId);
    this.files.delete(sourceId);
    p?.then((s) => s?.input.dispose()).catch(() => undefined);
  }

  clear(): void {
    for (const id of [...this.files.keys()]) this.release(id);
  }
}
