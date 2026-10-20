// 書き出すときの、コマと音の割り当て

/**
 * 出力のコマ（1/frameRate 秒ごと）を、元の録画のコマで順に埋めていく。
 * 元の録画のコマ数が違ったり、コマの間隔がばらばらでも、出力は一定の間隔になる。
 */
export class FrameScheduler {
  private next = 0;

  constructor(readonly frameRate: number) {}

  /** これまでに割り当てた出力コマの数 */
  get emitted(): number {
    return this.next;
  }

  /**
   * 出力の時刻 from〜to 秒に見えている元のコマで埋める、出力コマの番号の範囲 [first, last) を返す。
   * すでに埋めたコマは返さない。
   */
  take(from: number, to: number): [number, number] {
    const eps = 1e-6;
    const first = Math.max(this.next, Math.ceil(from * this.frameRate - eps));
    const last = Math.ceil(to * this.frameRate - eps);
    if (last <= first) return [first, first];
    this.next = last;
    return [first, last];
  }

  /** 出力コマの番号から時刻（秒） */
  timeOf(index: number): number {
    return index / this.frameRate;
  }
}

export interface AudioSlice {
  /** 先に入れる無音のサンプル数（元の音が途切れていたとき） */
  silence: number;
  /** 元の音のかたまりの、何サンプル目から使うか */
  offset: number;
  /** 何サンプル使うか */
  count: number;
}

/**
 * 元の音のかたまり（chunkTime 秒から chunkFrames サンプル）のうち、どこを使うかを決める。
 * rangeStart は使いたい範囲の始まり（録画の中の秒）、written はこれまでに書いたサンプル数、
 * needed はこの範囲で書くべきサンプル数。音は途切れず、重ならずに並ぶ。
 */
export function audioSlice(
  chunkTime: number,
  chunkFrames: number,
  sampleRate: number,
  rangeStart: number,
  written: number,
  needed: number,
): AudioSlice {
  const remaining = Math.max(0, needed - written);
  const wantedTime = rangeStart + written / sampleRate;
  const rawOffset = Math.round((wantedTime - chunkTime) * sampleRate);
  const silence = Math.min(remaining, Math.max(0, -rawOffset));
  const offset = Math.min(chunkFrames, Math.max(0, rawOffset));
  const count = Math.max(0, Math.min(chunkFrames - offset, remaining - silence));
  return { silence, offset, count };
}

/** 長さ length 秒の範囲に必要なサンプル数 */
export function samplesFor(length: number, sampleRate: number): number {
  return Math.max(0, Math.round(length * sampleRate));
}
