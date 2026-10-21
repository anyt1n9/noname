// 効果音（v0.5）。録画の中の時刻に置くので、カットしても映像とずれない
import type { SoundId } from '../data/sfx';
import type { Project, SoundEffect } from './project';
import { soundSeconds } from './sfx';
import { locate, sourceRangeOnTimeline } from './timeline';

/** 完成した動画の時刻 t に効果音を置く。置いた効果音の ID も返す */
export function addEffect(project: Project, t: number, sound: SoundId): { project: Project; id: string | null } {
  const loc = locate(project, t);
  if (!loc) return { project, id: null };
  const id = `e${project.nextId}`;
  const effect: SoundEffect = { id, sound, sourceId: loc.clip.sourceId, time: loc.sourceTime };
  return { project: { ...project, effects: [...project.effects, effect], nextId: project.nextId + 1 }, id };
}

export function removeEffect(project: Project, id: string): Project {
  if (!project.effects.some((e) => e.id === id)) return project;
  return { ...project, effects: project.effects.filter((e) => e.id !== id) };
}

/** 完成した動画の中で鳴る効果音（時刻の順）。カットで消えた位置の効果音は鳴らさない */
export function effectsOnTimeline(project: Project): { id: string; sound: SoundId; time: number }[] {
  const out: { id: string; sound: SoundId; time: number }[] = [];
  for (const e of project.effects) {
    // 置いた時刻が残っているかたまり（同じ録画の同じ時刻が2回使われていれば2回鳴る）
    for (const [from] of sourceRangeOnTimeline(project, { sourceId: e.sourceId, start: e.time, end: e.time + 1e-4 })) {
      out.push({ id: e.id, sound: e.sound, time: from });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** タイムラインの段に出す長さ（音の長さ） */
export function effectLength(sound: SoundId): number {
  return soundSeconds(sound);
}
