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

export interface Project {
  /** 作品名。書き出すファイル名にも使う */
  name: string;
  sources: SourceInfo[];
  /** タイムラインに並ぶ順 */
  clips: Clip[];
  /** 次に使う番号（ID を作るため） */
  nextId: number;
}

export function emptyProject(): Project {
  return { name: '', sources: [], clips: [], nextId: 1 };
}

export function findSource(project: Project, sourceId: string): SourceInfo | undefined {
  return project.sources.find((s) => s.id === sourceId);
}

/** 録画を足す。タイムラインの最後に、録画の全体を並べる */
export function addSources(project: Project, sources: Omit<SourceInfo, 'id'>[]): Project {
  let nextId = project.nextId;
  const added: SourceInfo[] = [];
  const clips: Clip[] = [];
  for (const s of sources) {
    const source: SourceInfo = { ...s, id: `s${nextId++}` };
    added.push(source);
    clips.push({ id: `c${nextId++}`, sourceId: source.id, start: source.startTime, end: source.endTime });
  }
  const name = project.name || (added[0] ? baseName(added[0].name) : '');
  return {
    ...project,
    name,
    sources: [...project.sources, ...added],
    clips: [...project.clips, ...clips],
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
