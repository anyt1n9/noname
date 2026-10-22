// キーの一覧・お知らせ・ファイルを落とすときの表示
import { useEffect } from 'preact/hooks';
import { KEY_HELP } from '../data/keys';
import { MODEL_HOST } from '../data/models';
import { APP_VERSION } from '../version';

export function KeysDialog({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div class="overlay" onClick={onClose}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="キーの一覧" onClick={(e) => e.stopPropagation()}>
        <h2>キーの一覧</h2>
        <table class="keys-table">
          <tbody>
            {KEY_HELP.map((k) => (
              <tr key={k.keys}>
                <td>{k.keys}</td>
                <td>{k.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="actions">
          <button class="btn primary" onClick={onClose} autoFocus>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

export function AboutDialog({ onClose, onPractice, onPrivacy }: { onClose(): void; onPractice(): void; onPrivacy(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div class="overlay" onClick={onClose}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label="このソフトについて" onClick={(e) => e.stopPropagation()}>
        <h2>テロッパ（仮）{APP_VERSION} について</h2>
        <div class="section-title">録画と個人情報</div>
        <ul class="steps-list about-list">
          <li>録画・字幕・編集内容は、このパソコンの中だけで使います。インターネットには送りません。</li>
          <li>使われ方の記録（アクセス解析）は取りません。</li>
          <li>自動保存は、このブラウザの中に「編集内容」「録画の場所」と、作品に入れた画像・曲を残します。録画そのものはコピーしません。</li>
        </ul>
        <div class="section-title">インターネットとのやりとり</div>
        <ul class="steps-list about-list">
          <li>テロッパを開くとき：テロッパを置いているサイト（GitHub Pages）から、テロッパのファイルを読み込みます。接続元の情報（IP アドレス）が GitHub に伝わります。</li>
          <li>
            自動字幕を初めて使うとき（了承したときだけ）：AI の部品を配布元の Hugging Face（{MODEL_HOST}）からダウンロードします。大きさを調べるための問い合わせもします。接続元の情報（IP アドレス）が配布元に伝わります。
          </li>
          <li>
            「AIに聞く」：あなたが選んだ AI のサイト（ChatGPT・Claude・Gemini・Microsoft Copilot）を新しいタブで開きます。テロッパからは何も送りません。質問文を貼り付けて送ると、そのサイトの会社に送られます。
          </li>
          <li>
            パソコンの中の AI（Chrome に入っている AI）を初めて使うとき（了承したときだけ）：Chrome が AI の部品を Google からダウンロードします。字幕などの文章は送りません。
          </li>
        </ul>
        <div class="section-title">使うときの注意</div>
        <ul class="steps-list about-list">
          <li>他人の音楽・映像・画像を勝手に使うと、著作権の侵害になります。</li>
          <li>ゲーム実況では、ゲーム会社ごとの「動画を出してよいか」のルール（ガイドライン）を確かめてください。</li>
          <li>自動字幕や AI のお手伝いの答えは、間違えることがあります。確かめてから使ってください。</li>
          <li>自分で用意した画像や曲は、自分で作ったものか、動画に使ってよい条件（ライセンス）を確かめたものだけを使ってください。</li>
        </ul>
        <div class="section-title">入っている BGM・効果音・見本の録画</div>
        <p class="about-text">
          テロッパに入っている BGM（5曲）・効果音（6種類）・見本の録画・テンプレートの見た目は、テロッパの中でプログラムで作っている自作のものです。ほかの人の曲や音は使っていません。CC0（パブリック・ドメイン）なので、作った動画やサムネイルに、クレジットなしで自由に使えます。
        </p>
        <div class="section-title">ライセンス</div>
        <p class="about-text">テロッパのソースコードは MIT ライセンスです。だれでも自由に使ったり、改造したりできます。</p>
        <div class="section-title">使っている部品</div>
        <p class="about-text">
          動画の読み書き：Mediabunny（MPL-2.0）／画面：Preact（MIT）／自動字幕：Transformers.js（Apache-2.0）・ONNX Runtime（MIT）ほか／字幕の文字：Noto Sans JP（OFL）
          <br />
          <a href="./THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener">
            ライセンス表記を見る
          </a>
        </p>
        <div class="actions">
          <button class="btn primary" onClick={onClose} autoFocus>
            閉じる
          </button>
          <button class="btn" onClick={onPrivacy}>
            外部に送る情報の一覧
          </button>
          <button class="btn" onClick={onPractice}>
            見本の録画で練習する
          </button>
        </div>
      </div>
    </div>
  );
}

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export function Toast({ notice, onClose }: { notice: Notice; onClose(): void }) {
  useEffect(() => {
    if (notice.kind !== 'info') return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <div class={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <div class="text">{notice.text}</div>
      <button class="btn small" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}

export function BusyOverlay({ text }: { text: string }) {
  return (
    <div class="overlay">
      <div class="dialog busy" role="status">
        <div class="spinner" />
        <div>{text}</div>
      </div>
    </div>
  );
}

export function DropOverlay() {
  return <div class="drop-overlay">ここに落とすと読み込みます</div>;
}
