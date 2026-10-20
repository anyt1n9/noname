// 時間の表示と計算

/** 再生位置の表示用（例：1:02:03、2:03）。fraction を付けると 0.1 秒まで出す */
export function formatClock(seconds: number, fraction = false): string {
  const safe = Math.max(0, seconds);
  const whole = fraction ? Math.floor(safe * 10) / 10 : Math.floor(safe);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const sec = fraction ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

/** 文章の中で使う長さの表示（例：1時間2分3秒、3分12秒、12秒） */
export function formatLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}時間${m}分${s}秒`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

/** ファイルの大きさの表示（例：1.2GB、350MB） */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)}MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))}KB`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
