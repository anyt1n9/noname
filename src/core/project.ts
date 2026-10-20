// 作品（プロジェクト）のデータ。元の録画は書き換えず、
// 「どの録画の、どこからどこまでを、どの順に使うか」だけを持つ。

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
}

export interface Project {
  /** 作品名。書き出すファイル名にも使う */
  name: string;
  sources: SourceInfo[];
  /** タイムラインに並ぶ順 */
  clips: Clip[];
  /** 録画の ID → 音の設定 */
  audio: Record<string, SourceAudio>;
  /** 次に使う番号（ID を作るため） */
  nextId: number;
}

export function emptyProject(): Project {
  return { name: '', sources: [], clips: [], audio: {}, nextId: 1 };
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
