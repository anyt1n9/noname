// 作品ファイル（.teroppa）の書き出しと読み込み
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_POSITIONS,
  SUBTITLE_SIZES,
  type SubtitleStyle,
} from '../data/subtitle-style';
import { IMAGE_PLACES, type ImagePlace } from '../data/images';
import { DEFAULT_BGM_VOLUME, musicTrack } from '../data/music';
import { isSoundId } from '../data/sfx';
import { DENOISE_STRENGTHS, type DenoiseStrength } from '../data/voice';
import { DENOISE_FRAME } from './denoise';
import { ARROW_DIRECTIONS, isShapeKind, SHAPE_COLORS, SHAPE_THICKNESS, type ArrowDirection, type ShapeThickness } from '../data/shapes';
import {
  defaultAudio,
  type Asset,
  type BgmSetting,
  type Clip,
  type ImageOverlay,
  type Project,
  type PublishInfo,
  type ShapeOverlay,
  type SoundEffect,
  type SourceAudio,
  type SourceInfo,
  type SourceRange,
  type Subtitle,
  type TrackRole,
  type ZoomEffect,
} from './project';

export const PROJECT_FILE_FORMAT = 'teroppa-project';
/** 版の番号。新しい項目を足したら上げる（古い版のファイルも読めるようにしておく） */
export const PROJECT_FILE_VERSION = 7;
export const PROJECT_FILE_EXTENSION = '.teroppa';

/** 画像・曲の中身（Asset の id → base64 の文字） */
export type AssetData = Record<string, string>;

interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: number;
  savedAt: string;
  project: Project;
  /** 画像・曲の中身。作品ファイルだけで、別のパソコンでも画像や曲を使えるようにする */
  assetData: AssetData;
}

/** 作品を文字にする。savedAt は保存した日時（ISO 形式） */
export function serializeProject(project: Project, savedAt: string, assetData: AssetData = {}): string {
  const file: ProjectFile = { format: PROJECT_FILE_FORMAT, version: PROJECT_FILE_VERSION, savedAt, project, assetData };
  return JSON.stringify(file, null, 1);
}

export type ParseResult = { ok: true; project: Project; assetData: AssetData } | { ok: false; error: string };

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
  const assetData: AssetData = {};
  if (isObject(data.assetData)) {
    for (const asset of project.assets) {
      const v = data.assetData[asset.id];
      if (typeof v === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(v)) assetData[asset.id] = v;
    }
  }
  return { ok: true, project, assetData };
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
    const clip: Clip = { id: c.id, sourceId: c.sourceId, start: c.start, end: c.end };
    if (typeof c.speed === 'number' && c.speed !== 1 && c.speed >= 0.25 && c.speed <= 8) clip.speed = c.speed;
    clips.push(clip);
  }
  const audio: Record<string, SourceAudio> = {};
  const rawAudio = isObject(value.audio) ? value.audio : {};
  for (const source of sources) {
    audio[source.id] = readAudio(rawAudio[source.id], source.audioTrackCount);
  }
  const subtitles: Subtitle[] = [];
  if (Array.isArray(value.subtitles)) {
    for (const t of value.subtitles) {
      // おかしな字幕は読み飛ばす（作品全体は開けるようにする）
      if (!isObject(t) || typeof t.id !== 'string' || typeof t.sourceId !== 'string' || typeof t.text !== 'string') continue;
      if (!ids.has(t.sourceId) || !isTime(t.start) || !isTime(t.end) || t.end <= t.start) continue;
      subtitles.push({ id: t.id, sourceId: t.sourceId, start: t.start, end: t.end, text: t.text });
    }
  }
  const transcribed: Record<string, [number, number][]> = {};
  if (isObject(value.transcribed)) {
    for (const [id, ranges] of Object.entries(value.transcribed)) {
      if (!ids.has(id) || !Array.isArray(ranges)) continue;
      transcribed[id] = ranges.filter((r): r is [number, number] => Array.isArray(r) && isTime(r[0]) && isTime(r[1]) && r[1] > r[0]);
    }
  }
  const assets: Asset[] = [];
  if (Array.isArray(value.assets)) {
    for (const a of value.assets) {
      const asset = readAsset(a);
      if (asset && !assets.some((x) => x.id === asset.id)) assets.push(asset);
    }
  }
  const assetIds = new Set(assets.map((a) => a.id));
  const images: ImageOverlay[] = [];
  if (Array.isArray(value.images)) {
    for (const i of value.images) {
      const image = readImage(i, ids, assetIds);
      if (image) images.push(image);
    }
  }
  const shapes: ShapeOverlay[] = [];
  if (Array.isArray(value.shapes)) {
    for (const g of value.shapes) {
      const shape = readShape(g, ids);
      if (shape) shapes.push(shape);
    }
  }
  const zooms: ZoomEffect[] = [];
  if (Array.isArray(value.zooms)) {
    for (const z of value.zooms) {
      if (!isObject(z) || typeof z.id !== 'string') continue;
      const ranges = readRanges(z.ranges, ids);
      if (ranges.length === 0 || !isTime(z.x) || !isTime(z.y) || !isTime(z.w) || z.w <= 0 || z.w > 1 || z.x > 1 || z.y > 1) continue;
      zooms.push({ id: z.id, ranges, x: z.x, y: z.y, w: z.w });
    }
  }
  const effects: SoundEffect[] = [];
  if (Array.isArray(value.effects)) {
    for (const e of value.effects) {
      if (!isObject(e) || typeof e.id !== 'string' || !isSoundId(e.sound)) continue;
      if (typeof e.sourceId !== 'string' || !ids.has(e.sourceId) || !isTime(e.time)) continue;
      effects.push({ id: e.id, sound: e.sound, sourceId: e.sourceId, time: e.time });
    }
  }
  const clipIds = new Set(clips.map((c) => c.id));
  const joinFades = Array.isArray(value.joinFades)
    ? value.joinFades.filter((id): id is string => typeof id === 'string' && clipIds.has(id))
    : [];
  return {
    name: value.name,
    sources,
    clips,
    audio,
    subtitles,
    subtitleStyle: readSubtitleStyle(value.subtitleStyle),
    transcribed,
    assets,
    images,
    shapes,
    zooms,
    effects,
    effectsVolume: isTime(value.effectsVolume) && value.effectsVolume <= 2 ? value.effectsVolume : 1,
    bgm: readBgm(value.bgm, assets),
    joinFades: [...new Set(joinFades)],
    endFade: value.endFade === true,
    publish: readPublish(value.publish),
    nextId: value.nextId,
  };
}

function readPublish(value: unknown): PublishInfo {
  if (!isObject(value)) return { title: '', description: '', chapters: [] };
  const chapters = Array.isArray(value.chapters)
    ? value.chapters.flatMap((c) => (isObject(c) && isTime(c.time) && typeof c.title === 'string' ? [{ time: c.time, title: c.title }] : []))
    : [];
  return {
    title: typeof value.title === 'string' ? value.title : '',
    description: typeof value.description === 'string' ? value.description : '',
    chapters,
  };
}

function readAsset(a: unknown): Asset | null {
  if (!isObject(a) || typeof a.id !== 'string' || !/^[0-9a-f]{16,64}$/.test(a.id)) return null;
  if (a.kind !== 'image' && a.kind !== 'music') return null;
  if (typeof a.name !== 'string' || typeof a.type !== 'string') return null;
  if (!isTime(a.size) || !isTime(a.width) || !isTime(a.height) || !isTime(a.duration)) return null;
  return { id: a.id, kind: a.kind, name: a.name, type: a.type, size: a.size, width: a.width, height: a.height, duration: a.duration };
}

const PLACES: ImagePlace[] = [...IMAGE_PLACES.map((p) => p.value), 'free'];

function readRanges(value: unknown, sourceIds: Set<string>): SourceRange[] {
  if (!Array.isArray(value)) return [];
  const ranges: SourceRange[] = [];
  for (const r of value) {
    if (!isObject(r) || typeof r.sourceId !== 'string' || !sourceIds.has(r.sourceId)) continue;
    if (!isTime(r.start) || !isTime(r.end) || r.end <= r.start) continue;
    ranges.push({ sourceId: r.sourceId, start: r.start, end: r.end });
  }
  return ranges;
}

function readShape(g: unknown, sourceIds: Set<string>): ShapeOverlay | null {
  if (!isObject(g) || typeof g.id !== 'string' || !isShapeKind(g.kind)) return null;
  const ranges = readRanges(g.ranges, sourceIds);
  if (ranges.length === 0) return null;
  const unit = (v: unknown): v is number => isTime(v) && v <= 1;
  if (!unit(g.x) || !unit(g.y) || !unit(g.w) || !unit(g.h) || g.w === 0 || g.h === 0) return null;
  const color = typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : SHAPE_COLORS[0].value;
  const thickness = SHAPE_THICKNESS.find((t) => t.value === g.thickness)?.value ?? ('normal' as ShapeThickness);
  const direction = ARROW_DIRECTIONS.find((d) => d.value === g.direction)?.value ?? ('down-left' as ArrowDirection);
  return { id: g.id, kind: g.kind, ranges, x: g.x, y: g.y, w: g.w, h: g.h, color, thickness, direction };
}

function readImage(i: unknown, sourceIds: Set<string>, assetIds: Set<string>): ImageOverlay | null {
  if (!isObject(i) || typeof i.id !== 'string' || typeof i.assetId !== 'string' || !assetIds.has(i.assetId)) return null;
  if (!PLACES.includes(i.place as ImagePlace)) return null;
  const ranges = readRanges(i.ranges, sourceIds);
  if (ranges.length === 0) return null;
  const unit = (v: unknown, max: number) => isTime(v) && v <= max;
  if (!unit(i.x, 1) || !unit(i.y, 1) || !unit(i.w, 1) || i.w === 0) return null;
  return { id: i.id, assetId: i.assetId, ranges, place: i.place as ImagePlace, x: i.x as number, y: i.y as number, w: i.w as number };
}

function readBgm(value: unknown, assets: Asset[]): BgmSetting | null {
  if (!isObject(value) || !isObject(value.track)) return null;
  const track = value.track;
  let result: BgmSetting['track'];
  if (track.kind === 'builtin' && typeof track.id === 'string' && musicTrack(track.id)) {
    result = { kind: 'builtin', id: track.id };
  } else if (track.kind === 'asset' && typeof track.assetId === 'string' && assets.some((a) => a.id === track.assetId && a.kind === 'music')) {
    result = { kind: 'asset', assetId: track.assetId };
  } else {
    return null;
  }
  const volume = isTime(value.volume) && value.volume <= 2 ? value.volume : DEFAULT_BGM_VOLUME;
  return { track: result, volume, duck: value.duck !== false };
}

function readSubtitleStyle(value: unknown): SubtitleStyle {
  if (!isObject(value)) return DEFAULT_SUBTITLE_STYLE;
  const color = typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : DEFAULT_SUBTITLE_STYLE.color;
  const size = SUBTITLE_SIZES.find((s) => s.value === value.size)?.value ?? DEFAULT_SUBTITLE_STYLE.size;
  const position = SUBTITLE_POSITIONS.find((p) => p.value === value.position)?.value ?? DEFAULT_SUBTITLE_STYLE.position;
  return { color, size, position };
}

const ROLES: TrackRole[] = ['voice', 'other', 'off'];

/** 音の設定を読む。ない・おかしいときは初期値（v0.1 で保存した作品など） */
function readAudio(value: unknown, trackCount: number): SourceAudio {
  const fallback = defaultAudio(trackCount);
  if (!isObject(value) || !Array.isArray(value.roles) || value.roles.length !== trackCount) return fallback;
  if (!value.roles.every((r) => ROLES.includes(r as TrackRole))) return fallback;
  const gain = (v: unknown) => (isTime(v) && v <= 4 ? v : 1);
  const audio: SourceAudio = {
    roles: value.roles as TrackRole[],
    voiceGain: gain(value.voiceGain),
    otherGain: gain(value.otherGain),
    confirmed: value.confirmed === true,
  };
  const d = value.denoise;
  if (isObject(d) && DENOISE_STRENGTHS.some((x) => x.value === d.strength) && isObject(d.profile)) {
    const m = d.profile.magnitudes;
    if (isTime(d.profile.sampleRate) && Array.isArray(m) && m.length === DENOISE_FRAME / 2 + 1 && m.every((v) => isTime(v))) {
      audio.denoise = { strength: d.strength as DenoiseStrength, profile: { sampleRate: d.profile.sampleRate, magnitudes: m as number[] } };
    }
  }
  return audio;
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
