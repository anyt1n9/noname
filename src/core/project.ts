// 作品（プロジェクト）のデータ。元の録画は書き換えず、
// 「どの録画の、どこからどこまでを、どの順に使うか」だけを持つ。
import type { ImagePlace } from '../data/images';
import type { ArrowDirection, ShapeKind, ShapeThickness } from '../data/shapes';
import type { DenoiseStrength } from '../data/voice';
import type { Chapter } from './chapters';
import type { NoiseProfile } from './denoise';
import type { ThumbnailSetting } from './thumbnail';
import type { SoundId } from '../data/sfx';
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from '../data/subtitle-style';

/** 読み込んだ録画の情報 */
export interface SourceInfo {
  id: string;
  /** ファイル名 */
  name: string;
  /** ファイルの大きさ（バイト）。録画を探し直すときの照合に使う */
  size: number;
  /** ファイルの更新日時（ミリ秒） */
  lastModified: number;
  /** 録画の始まりと終わりの時刻（秒）。始まりは 0 とは限らない */
  startTime: number;
  endTime: number;
  /** 表示上の幅と高さ */
  width: number;
  height: number;
  /** 1秒あたりのコマ数 */
  frameRate: number;
  /** 映像の形式（avc、vp9 など）。分からなければ null */
  videoCodec: string | null;
  /** 録画に入っている音の数 */
  audioTrackCount: number;
}

/** タイムラインに並ぶ、録画のひとかたまり。start〜end は録画の中の時刻（秒） */
export interface Clip {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  /** 速さ（2 なら2倍の速さ。ないときは 1）。タイムラインの長さは (end - start) / speed */
  speed?: number;
}

export function clipSpeed(clip: Clip): number {
  return clip.speed ?? 1;
}

/** 録画に入っている音それぞれの役割 */
export type TrackRole = 'voice' | 'other' | 'off';

/** 録画ごとの音の設定 */
export interface SourceAudio {
  /** 音ごとの役割（録画に入っている順）。「あなたの声」「ゲームの音など」「使わない」 */
  roles: TrackRole[];
  /** 声の大きさ（1 でそのまま） */
  voiceGain: number;
  /** ゲームの音などの大きさ（1 でそのまま） */
  otherGain: number;
  /** 音が複数ある録画で、使う人が役割を確かめたか */
  confirmed: boolean;
  /** 声の雑音を減らす設定（v0.7）。雑音の音色は、録画の静かな部分から調べたもの */
  denoise?: { strength: DenoiseStrength; profile: NoiseProfile } | null;
}

/**
 * 字幕。録画の中の時刻で持つので、「間」を切ったり並べ替えたりしても映像とずれない。
 * text の改行（\n）で2行にする。
 */
export interface Subtitle {
  id: string;
  sourceId: string;
  start: number;
  end: number;
  text: string;
}

/** 録画の中の時刻で表した範囲 */
export interface SourceRange {
  sourceId: string;
  start: number;
  end: number;
}

/**
 * 作品に入れた画像や曲。中身（ファイルそのもの）は作品のデータとは別に、
 * ブラウザの中の保存場所と作品ファイルに入れる。id は中身から作った手がかり（同じファイルなら同じ id）。
 */
export interface Asset {
  id: string;
  kind: 'image' | 'music';
  name: string;
  /** ファイルの形式（image/png など） */
  type: string;
  size: number;
  /** 画像の幅と高さ（曲は 0） */
  width: number;
  height: number;
  /** 曲の長さ（秒。画像は 0） */
  duration: number;
}

/** 映像に重ねる画像 */
export interface ImageOverlay {
  id: string;
  assetId: string;
  /** 出す時間（録画の中の時刻）。かたまりをまたぐときは複数になる */
  ranges: SourceRange[];
  /** 置き方（右上・中央など）。ドラッグで動かしたら 'free' */
  place: ImagePlace;
  /** 画像の真ん中の位置（画面の幅・高さに対する割合） */
  x: number;
  y: number;
  /** 画像の幅（画面の幅に対する割合） */
  w: number;
}

/** 矢印・四角い枠・丸 */
export interface ShapeOverlay {
  id: string;
  kind: ShapeKind;
  ranges: SourceRange[];
  /** 図形を囲む四角の真ん中と大きさ（x・w は画面の幅、y・h は画面の高さに対する割合） */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  thickness: ShapeThickness;
  /** 矢印の向き（矢印のときだけ使う） */
  direction: ArrowDirection;
}

/** 画面の一部を拡大する。x・y は見せる範囲の真ん中、w は幅（画面に対する割合。高さも同じ割合） */
export interface ZoomEffect {
  id: string;
  ranges: SourceRange[];
  x: number;
  y: number;
  w: number;
}

/** 効果音。録画の中の時刻に置くので、カットしても映像とずれない */
export interface SoundEffect {
  id: string;
  sound: SoundId;
  sourceId: string;
  time: number;
}

/** BGM の設定 */
export interface BgmSetting {
  /** 入っている曲の ID、または自分で用意した曲（Asset の id） */
  track: { kind: 'builtin'; id: string } | { kind: 'asset'; assetId: string };
  /** 大きさ（1 でそのまま） */
  volume: number;
  /** しゃべっている間は小さくするか */
  duck: boolean;
}

/** 公開の準備（v0.8〜）：タイトル・概要欄・チャプター */
export interface PublishInfo {
  title: string;
  description: string;
  chapters: Chapter[];
}

export interface Project {
  /** 作品名。書き出すファイル名にも使う */
  name: string;
  sources: SourceInfo[];
  /** タイムラインに並ぶ順 */
  clips: Clip[];
  /** 録画の ID → 音の設定 */
  audio: Record<string, SourceAudio>;
  /** 字幕（録画ごと・時刻の順） */
  subtitles: Subtitle[];
  subtitleStyle: SubtitleStyle;
  /** 録画の ID → 文字起こしを済ませた範囲（録画の中の時刻）。続きから文字起こしするために使う */
  transcribed: Record<string, [number, number][]>;
  /** 画像・曲（中身は別に保存する） */
  assets: Asset[];
  /** 映像に重ねる画像（後ろのものほど手前） */
  images: ImageOverlay[];
  /** 矢印・枠（画像より手前に描く） */
  shapes: ShapeOverlay[];
  /** 画面の一部を拡大する */
  zooms: ZoomEffect[];
  effects: SoundEffect[];
  /** 効果音の大きさ（1 でそのまま） */
  effectsVolume: number;
  bgm: BgmSetting | null;
  /** 前のつなぎ目でフェード（暗くなって切り替わる）するかたまりの ID。最初のかたまりなら、動画の始まりのフェード */
  joinFades: string[];
  /** 動画の終わりをフェードで暗くするか */
  endFade: boolean;
  publish: PublishInfo;
  /** サムネイル（v0.9）。まだ作っていなければ null */
  thumbnail: ThumbnailSetting | null;
  /** 見本の録画で練習している作品か（v1.0）。手順ごとに練習の案内を出す */
  practice: boolean;
  /** 次に使う番号（ID を作るため） */
  nextId: number;
}

export function emptyProject(): Project {
  return {
    name: '',
    sources: [],
    clips: [],
    audio: {},
    subtitles: [],
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    transcribed: {},
    assets: [],
    images: [],
    shapes: [],
    zooms: [],
    effects: [],
    effectsVolume: 1,
    bgm: null,
    joinFades: [],
    endFade: false,
    publish: { title: '', description: '', chapters: [] },
    thumbnail: null,
    practice: false,
    nextId: 1,
  };
}

/** 音の設定の初期値。1つ目の音を「あなたの声」にし、ほかは使わない（v0.1 と同じ動き） */
export function defaultAudio(trackCount: number): SourceAudio {
  const roles: TrackRole[] = Array.from({ length: trackCount }, (_, i) => (i === 0 ? 'voice' : 'off'));
  return { roles, voiceGain: 1, otherGain: 1, confirmed: trackCount <= 1 };
}

export function sourceAudio(project: Project, sourceId: string): SourceAudio {
  const audio = project.audio[sourceId];
  if (audio) return audio;
  return defaultAudio(findSource(project, sourceId)?.audioTrackCount ?? 0);
}

export function setSourceAudio(project: Project, sourceId: string, audio: SourceAudio): Project {
  return { ...project, audio: { ...project.audio, [sourceId]: audio } };
}

/** 書き出しや再生で鳴らす音（番号と大きさ） */
export function activeTracks(audio: SourceAudio): { index: number; gain: number }[] {
  const result: { index: number; gain: number }[] = [];
  audio.roles.forEach((role, index) => {
    if (role === 'voice') result.push({ index, gain: audio.voiceGain });
    else if (role === 'other') result.push({ index, gain: audio.otherGain });
  });
  return result;
}

/** 声の音の番号。声がなければ、鳴らしている音を使う */
export function voiceTracks(audio: SourceAudio): number[] {
  const voice = audio.roles.flatMap((role, i) => (role === 'voice' ? [i] : []));
  if (voice.length > 0) return voice;
  return audio.roles.flatMap((role, i) => (role === 'other' ? [i] : []));
}

export function findSource(project: Project, sourceId: string): SourceInfo | undefined {
  return project.sources.find((s) => s.id === sourceId);
}

/** 録画を足す。タイムラインの最後に、録画の全体を並べる */
export function addSources(project: Project, sources: Omit<SourceInfo, 'id'>[]): Project {
  let nextId = project.nextId;
  const added: SourceInfo[] = [];
  const clips: Clip[] = [];
  const audio = { ...project.audio };
  for (const s of sources) {
    const source: SourceInfo = { ...s, id: `s${nextId++}` };
    added.push(source);
    clips.push({ id: `c${nextId++}`, sourceId: source.id, start: source.startTime, end: source.endTime });
    audio[source.id] = defaultAudio(source.audioTrackCount);
  }
  const name = project.name || (added[0] ? baseName(added[0].name) : '');
  return {
    ...project,
    name,
    sources: [...project.sources, ...added],
    clips: [...project.clips, ...clips],
    audio,
    nextId,
  };
}

/** 録画の情報を差し替える（別の場所にあった録画を見つけ直したときなど） */
export function updateSource(project: Project, sourceId: string, info: Partial<Omit<SourceInfo, 'id'>>): Project {
  return {
    ...project,
    sources: project.sources.map((s) => (s.id === sourceId ? { ...s, ...info } : s)),
  };
}

/** 画像・曲を作品に入れる（同じものがあれば入れない） */
export function addAsset(project: Project, asset: Asset): Project {
  if (project.assets.some((a) => a.id === asset.id)) return project;
  return { ...project, assets: [...project.assets, asset] };
}

/** 使われていない画像・曲を作品から外す */
export function dropUnusedAssets(project: Project): Project {
  const used = usedAssetIds(project);
  if (project.assets.every((a) => used.has(a.id))) return project;
  return { ...project, assets: project.assets.filter((a) => used.has(a.id)) };
}

export function usedAssetIds(project: Project): Set<string> {
  const used = new Set(project.images.map((i) => i.assetId));
  if (project.bgm?.track.kind === 'asset') used.add(project.bgm.track.assetId);
  return used;
}

export function findAsset(project: Project, id: string): Asset | undefined {
  return project.assets.find((a) => a.id === id);
}

/** タイムラインで使われている録画だけ（使われていない録画は探し直さなくてよい） */
export function usedSources(project: Project): SourceInfo[] {
  const used = new Set(project.clips.map((c) => c.sourceId));
  return project.sources.filter((s) => used.has(s.id));
}

/** 拡張子を除いたファイル名 */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
