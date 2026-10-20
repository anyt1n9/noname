// 版の番号（package.json の version から作る）
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** 画面に出す短い版の番号（例：v0.2） */
export const APP_VERSION_SHORT = `v${APP_VERSION.split('.').slice(0, 2).join('.')}`;
