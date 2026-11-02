/**
 * The web shell renders the document title from a product title that the
 * upstream layout package hardcodes ("DeepSeek Harness"). It re-applies that
 * value whenever the active session or panel changes, so a one-shot write is
 * not enough: watch the title node and rewrite the product segment in place.
 *
 * Session titles are kept — only the product segment is replaced, so a title
 * such as "季度选题会 — DeepSeek Harness" becomes "季度选题会 — AI融媒中心".
 */
const PRODUCT_TITLE = 'AI融媒中心';
const UPSTREAM_TITLE = 'DeepSeek Harness';

export function syncProductTitle(): () => void {
  if (typeof document === 'undefined') return () => {};

  const rewrite = () => {
    const current = document.title;
    if (current.includes(UPSTREAM_TITLE)) {
      document.title = current.split(UPSTREAM_TITLE).join(PRODUCT_TITLE);
      return;
    }
    if (current.trim() === '') document.title = PRODUCT_TITLE;
  };

  rewrite();

  const title = document.querySelector('title');
  if (!title) return () => {};

  const observer = new MutationObserver(rewrite);
  observer.observe(title, { childList: true, characterData: true, subtree: true });
  return () => { observer.disconnect(); };
}
