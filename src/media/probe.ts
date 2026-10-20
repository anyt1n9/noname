// 録画ファイルを調べる（長さ・大きさ・コマ数・音の数）
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { normalizeFrameRate } from '../core/export-plan';
import type { SourceInfo } from '../core/project';

export type ProbeResult = { ok: true; info: Omit<SourceInfo, 'id'> } | { ok: false; reason: string };

const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264',
  hevc: 'HEVC（H.265）',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
};

export function codecLabel(codec: string | null): string {
  if (!codec) return '不明な形式';
  return CODEC_NAMES[codec] ?? codec;
}

export function openInput(file: Blob): Input {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

export async function probeFile(file: File): Promise<ProbeResult> {
  const input = openInput(file);
  try {
    if (!(await input.canRead())) {
      return { ok: false, reason: 'この形式のファイルは読み込めません。MP4・MOV・MKV・WebM の録画を選んでください。' };
    }
    const video = await input.getPrimaryVideoTrack();
    if (!video) {
      return { ok: false, reason: '映像が入っていないファイルです。録画のファイルを選んでください。' };
    }
    const codec = await video.getCodec();
    if (!(await video.canDecode())) {
      const hint =
        codec === 'hevc'
          ? 'iPhone の場合は「設定 → カメラ → フォーマット」を「互換性優先」にして撮ると読み込めます。OBS の場合は録画の形式を H.264 にしてください。'
          : '別の形式で録画し直すか、新しい Chrome か Edge を使ってください。';
      return { ok: false, reason: `このパソコンのブラウザでは、${codecLabel(codec)} の録画を読めません。${hint}` };
    }
    const audioTracks = await input.getAudioTracks();
    const startTime = Math.max(0, await input.getFirstTimestamp());
    const endTime = await input.computeDuration();
    if (!(endTime > startTime)) {
      return { ok: false, reason: '録画の長さが分かりませんでした。ファイルが壊れているかもしれません。' };
    }
    let frameRate = 30;
    try {
      const metrics = await video.computeFrameRateMetrics();
      frameRate = normalizeFrameRate(metrics.bestGuessFrameRate);
    } catch {
      // コマ数が分からないときは 30 とする
    }
    return {
      ok: true,
      info: {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        startTime,
        endTime,
        width: await video.getDisplayWidth(),
        height: await video.getDisplayHeight(),
        frameRate,
        videoCodec: codec,
        audioTrackCount: audioTracks.length,
      },
    };
  } catch (e) {
    return { ok: false, reason: `録画を読み込めませんでした（${errorText(e)}）。` };
  } finally {
    input.dispose();
  }
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
