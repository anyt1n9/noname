// 録画の中の時刻（ranges）で出す時間を持つもの（画像・矢印や枠・拡大）に共通の計算
import type { Project, SourceRange } from './project';
import { locate, sourceRangesOnTimeline } from './timeline';

export interface Ranged {
  id: string;
  ranges: SourceRange[];
}

/** 完成した動画の時刻 t に出ているもの（並びの順） */
export function rangedAt<T extends Ranged>(project: Project, list: T[], t: number): T[] {
  if (list.length === 0) return [];
  const loc = locate(project, t);
  if (!loc) return [];
  const { sourceId } = loc.clip;
  const st = loc.sourceTime;
  return list.filter((item) => item.ranges.some((r) => r.sourceId === sourceId && r.start <= st && st < r.end));
}

/** タイムラインに見えている部分（見えている部分ごと・時刻の順） */
export function rangedOnTimeline<T extends Ranged>(project: Project, list: T[]): { item: T; key: string; from: number; to: number }[] {
  const out: { item: T; key: string; from: number; to: number }[] = [];
  for (const item of list) {
    sourceRangesOnTimeline(project, item.ranges).forEach(([from, to], i) => {
      if (to - from >= 0.05) out.push({ item, key: `${item.id}#${i}`, from, to });
    });
  }
  return out.sort((a, b) => a.from - b.from);
}
