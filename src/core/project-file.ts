// 作品ファイル（.teroppa）の書き出しと読み込み
import type { Clip, Project, SourceInfo } from './project';

export const PROJECT_FILE_FORMAT = 'teroppa-project';
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = '.teroppa';

interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: number;
  savedAt: string;
  project: Project;
}

/** 作品を文字にする。savedAt は保存した日時（ISO 形式） */
export function serializeProject(project: Project, savedAt: string): string {
  const file: ProjectFile = { format: PROJECT_FILE_FORMAT, version: PROJECT_FILE_VERSION, savedAt, project };
  return JSON.stringify(file, null, 1);
}

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string };

/** 作品ファイルを読む。おかしなところがあれば、その理由を返す */
export function parseProject(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'テロッパの作品ファイルではないようです。' };
  }
  if (!isObject(data) || data.format !== PROJECT_FILE_FORMAT) {
    return { ok: false, error: 'テロッパの作品ファイルではないようです。' };
  }
  if (typeof data.version !== 'number' || data.version > PROJECT_FILE_VERSION) {
    return { ok: false, error: '新しい版のテロッパで保存されたファイルです。テロッパを新しくしてから開いてください。' };
  }
  const project = readProject(data.project);
  if (!project) return { ok: false, error: '作品ファイルが壊れているようです。' };
  return { ok: true, project };
}

/** 保存しておいた作品（自動保存など）を確かめながら読む。おかしければ null */
export function readProject(value: unknown): Project | null {
  if (!isObject(value)) return null;
  if (typeof value.name !== 'string' || !Array.isArray(value.sources) || !Array.isArray(value.clips)) return null;
  if (!isCount(value.nextId)) return null;
  const sources: SourceInfo[] = [];
  for (const s of value.sources) {
    const source = readSource(s);
    if (!source) return null;
    sources.push(source);
  }
  const ids = new Set(sources.map((s) => s.id));
  const clips: Clip[] = [];
  for (const c of value.clips) {
    if (!isObject(c) || typeof c.id !== 'string' || typeof c.sourceId !== 'string') return null;
    if (!ids.has(c.sourceId) || !isTime(c.start) || !isTime(c.end) || c.end <= c.start) return null;
    clips.push({ id: c.id, sourceId: c.sourceId, start: c.start, end: c.end });
  }
  return { name: value.name, sources, clips, nextId: value.nextId };
}

function readSource(s: unknown): SourceInfo | null {
  if (!isObject(s)) return null;
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return null;
  if (!isTime(s.size) || !isTime(s.lastModified) || !isTime(s.startTime) || !isTime(s.endTime)) return null;
  if (s.endTime <= s.startTime) return null;
  if (!isTime(s.width) || !isTime(s.height) || !isTime(s.frameRate) || !isCount(s.audioTrackCount)) return null;
  if (s.videoCodec !== null && typeof s.videoCodec !== 'string') return null;
  return {
    id: s.id,
    name: s.name,
    size: s.size,
    lastModified: s.lastModified,
    startTime: s.startTime,
    endTime: s.endTime,
    width: s.width,
    height: s.height,
    frameRate: s.frameRate,
    videoCodec: s.videoCodec,
    audioTrackCount: s.audioTrackCount,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
