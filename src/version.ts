// 版の番号（package.json の version から作る）
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** 画面に出す短い版の番号（例：v0.2、候補の版なら v1.0-rc.1） */
export const APP_VERSION_SHORT = shortVersion(APP_VERSION);

export function shortVersion(version: string): string {
  const [core, pre] = version.split('-');
  return `v${core.split('.').slice(0, 2).join('.')}${pre ? `-${pre}` : ''}`;
}
