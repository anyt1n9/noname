// 外部に送る情報の一覧（v1.0）
import { useEffect } from 'preact/hooks';
import { EXTERNAL_TRANSMISSIONS, NOT_SENT } from '../data/external';

export function PrivacyDialog({ onClose }: { onClose(): void }) {
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
      <div class="dialog wide" role="dialog" aria-modal="true" aria-label="外部に送る情報の一覧" onClick={(e) => e.stopPropagation()}>
        <h2>外部に送る情報の一覧</h2>
        <p class="hint-text">テロッパを使うときに、インターネットの向こう（テロッパの外）に情報が送られる場面の一覧です。</p>
        <ul class="steps-list about-list">
          {NOT_SENT.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div class="external-list">
          {EXTERNAL_TRANSMISSIONS.map((x) => (
            <section key={x.when} class="external-item">
              <h3>{x.when}</h3>
              <dl class="facts">
                <dt>送り先</dt>
                <dd>{x.to}</dd>
                <dt>送る情報</dt>
                <dd>{x.what}</dd>
                <dt>使う目的</dt>
                <dd>{x.purpose}</dd>
                <dt>止め方・選び方</dt>
                <dd>{x.control}</dd>
              </dl>
            </section>
          ))}
        </div>
        <div class="actions">
          <button class="btn primary" onClick={onClose} autoFocus>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
