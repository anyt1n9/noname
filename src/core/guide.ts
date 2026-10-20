// 「いまやること」の案内文を決める
import type { StepId } from '../data/steps';
import type { Project } from './project';
import { formatLength } from './time';
import { totalDuration } from './timeline';

export interface GuideMessage {
  title: string;
  detail: string;
}

export interface GuideContext {
  step: StepId;
  /** なぞった範囲があるか */
  hasSelection: boolean;
  /** 開けない録画（場所が分からない・許可がない）があるか */
  missingSources: number;
}

export function guideMessage(project: Project, ctx: GuideContext): GuideMessage {
  if (ctx.missingSources > 0) {
    return {
      title: '録画を開き直してください',
      detail: `${ctx.missingSources}本の録画を開けません。下のボタンから録画を選び直すと、続きから作業できます。`,
    };
  }
  if (ctx.step === 'export') {
    return {
      title: '動画を書き出しましょう',
      detail: '画質を選んで「書き出す」を押すと、完成した動画を MP4 ファイルとして保存します。',
    };
  }
  if (project.clips.length === 0) {
    return {
      title: 'まずは録画を入れましょう',
      detail: '「録画を選ぶ」を押すか、録画のファイルをこの画面に落としてください。何本でも入れられます。',
    };
  }
  if (ctx.hasSelection) {
    return {
      title: 'なぞった範囲を消しますか？',
      detail: '「消す」を押すと、その部分が動画から消えます。まちがえても「元に戻す」で戻せます。',
    };
  }
  return {
    title: 'いらない部分を消しましょう',
    detail: `いまの長さは${formatLength(totalDuration(project))}です。タイムラインで消したい範囲をなぞると消せます。消すところがなければ、そのまま書き出しへ進めます。`,
  };
}
