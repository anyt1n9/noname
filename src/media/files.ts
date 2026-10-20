// ファイルを選ぶ・保存する・開く許可をもらう
import { PROJECT_FILE_EXTENSION } from '../core/project-file';

/** 選んだ録画。handle は、次に開いたときに同じファイルを開き直すために覚えておく */
export interface PickedFile {
  file: File;
  handle: FileSystemFileHandle | null;
}

const RECORDING_TYPES: FilePickerAcceptType[] = [
  {
    description: '録画（MP4・MOV・MKV・WebM）',
    accept: { 'video/*': ['.mp4', '.m4v', '.mov', '.mkv', '.webm'] },
  },
];

const RECORDING_EXTENSIONS = /\.(mp4|m4v|mov|mkv|webm)$/i;

/** 選ぶ画面を閉じただけのとき */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export async function pickRecordings(): Promise<PickedFile[]> {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: RECORDING_TYPES, id: 'recordings' });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (e) {
      if (isAbort(e)) return [];
      throw e;
    }
  }
  // ファイルを開く機能がないブラウザ向け（次に開いたときは録画を選び直す必要がある）
  const files = await pickWithInput('video/*,.mkv', true);
  return files.map((file) => ({ file, handle: null }));
}

/** 画面に落とされたファイル */
export async function droppedFiles(dt: DataTransfer): Promise<PickedFile[]> {
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const picked: PickedFile[] = [];
  for (const item of items) {
    const handle = (await item.getAsFileSystemHandle?.()) ?? null;
    if (handle && handle.kind === 'file') {
      const fileHandle = handle as FileSystemFileHandle;
      picked.push({ file: await fileHandle.getFile(), handle: fileHandle });
    } else {
      const file = item.getAsFile();
      if (file) picked.push({ file, handle: null });
    }
  }
  return picked;
}

/** 画面に落とされたものが作品ファイルか */
export function isProjectFileName(name: string): boolean {
  return name.toLowerCase().endsWith(PROJECT_FILE_EXTENSION);
}

export function isRecordingFileName(name: string): boolean {
  return RECORDING_EXTENSIONS.test(name);
}

/** 読む許可があるか確かめる。ask が true なら、なければ許可を求める（ボタンを押したときだけ使える） */
export async function ensureReadPermission(handle: FileSystemFileHandle, ask: boolean): Promise<boolean> {
  const query = await handle.queryPermission?.({ mode: 'read' });
  if (query === undefined || query === 'granted') return true;
  if (!ask) return false;
  return (await handle.requestPermission?.({ mode: 'read' })) === 'granted';
}

/** 書き出し先を選ぶ。選ばなかったら null */
export async function pickExportTarget(suggestedName: string): Promise<FileSystemFileHandle | null> {
  if (!window.showSaveFilePicker) return null;
  try {
    return await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'MP4 動画', accept: { 'video/mp4': ['.mp4'] } }],
      id: 'export',
    });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

export interface TextFileKind {
  description: string;
  mime: string;
  extension: string;
  id: string;
}

export const PROJECT_FILE_KIND: TextFileKind = {
  description: 'テロッパの作品ファイル',
  mime: 'application/json',
  extension: PROJECT_FILE_EXTENSION,
  id: 'project',
};

export const SRT_FILE_KIND: TextFileKind = {
  description: '字幕ファイル（.srt）',
  mime: 'text/plain',
  extension: '.srt',
  id: 'srt',
};

/** 文字のファイル（作品ファイル・字幕ファイル）を保存する。保存したら true */
export async function saveTextFile(suggestedName: string, text: string, kind: TextFileKind = PROJECT_FILE_KIND): Promise<boolean> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: kind.description, accept: { [kind.mime]: [kind.extension] } }],
        id: kind.id,
      });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return true;
    } catch (e) {
      if (isAbort(e)) return false;
      throw e;
    }
  }
  // 保存の機能がないブラウザでは、ダウンロードとして保存する
  const url = URL.createObjectURL(new Blob([text], { type: kind.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** 文字のファイル（作品ファイル・字幕ファイル）を選んで読む。選ばなかったら null */
export async function openTextFile(kind: TextFileKind = PROJECT_FILE_KIND): Promise<File | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: kind.description, accept: { [kind.mime]: [kind.extension] } }],
        id: kind.id,
      });
      return handle.getFile();
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  const [file] = await pickWithInput(kind.extension, false);
  return file ?? null;
}

function pickWithInput(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}
