// 音が割れないように、大きすぎるところだけをなめらかに小さくする（v0.7）。
// 少し先（LOOKAHEAD 秒）を見て、大きい音が来る前から少しずつ小さくし、過ぎたらゆっくり戻す。
// 書き出しで、0.5秒ずつのかたまりを1つ遅らせて処理する（次のかたまりの始めを先読みに使う）。
import { LIMIT_CEILING_DB } from '../data/voice';

const LOOKAHEAD = 0.005;
const RELEASE = 0.12;

export class Limiter {
  private readonly ceiling: number;
  private readonly look: number;
  private readonly release: number;
  /** 前のかたまりの最後の、先読みの最小値（ならすのに使う） */
  private prevMins: Float64Array;
  private prevGain = 1;

  constructor(sampleRate: number, ceilingDb = LIMIT_CEILING_DB) {
    this.ceiling = Math.pow(10, ceilingDb / 20);
    this.look = Math.max(1, Math.round(LOOKAHEAD * sampleRate));
    this.release = 1 - Math.exp(-1 / (RELEASE * sampleRate));
    this.prevMins = new Float64Array(this.look).fill(1);
  }

  /** current を処理する（書きかえる）。next は次のかたまり（最後なら null） */
  process(current: Float32Array[], next: Float32Array[] | null): void {
    const n = current[0]?.length ?? 0;
    if (n === 0) return;
    const L = this.look;
    // 先読みの分まで含めて、サンプルごとに必要な倍率
    const total = n + L;
    const need = new Float64Array(total);
    for (let i = 0; i < total; i++) {
      let peak = 0;
      for (let c = 0; c < current.length; c++) {
        const v = i < n ? current[c][i] : (next?.[c]?.[i - n] ?? 0);
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      need[i] = peak > this.ceiling ? this.ceiling / peak : 1;
    }
    // 先の L サンプルの中で一番小さい倍率（並びを使って速く求める）
    const mins = new Float64Array(n);
    const deque = new Int32Array(total);
    let head = 0;
    let tail = 0;
    for (let i = total - 1; i >= 0; i--) {
      while (tail > head && need[deque[tail - 1]] >= need[i]) tail--;
      deque[tail++] = i;
      while (deque[head] > i + L) head++;
      if (i < n) mins[i] = need[deque[head]];
    }
    // 直前の L 個の平均でならし、戻るときはゆっくり戻す
    let sum = 0;
    for (let k = 0; k < L; k++) sum += this.prevMins[k];
    const history = this.prevMins;
    let pos = 0;
    let gain = this.prevGain;
    for (let i = 0; i < n; i++) {
      sum += mins[i] - history[pos];
      history[pos] = mins[i];
      pos = (pos + 1) % L;
      const target = sum / L;
      gain = target < gain ? target : gain + (target - gain) * this.release;
      for (let c = 0; c < current.length; c++) current[c][i] *= gain;
    }
    // 次のかたまりのために、並びを古い順に戻しておく
    const ordered = new Float64Array(L);
    for (let k = 0; k < L; k++) ordered[k] = history[(pos + k) % L];
    this.prevMins = ordered;
    this.prevGain = gain;
  }
}
