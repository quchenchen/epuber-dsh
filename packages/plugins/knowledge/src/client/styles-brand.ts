import { brandCss } from 'epuberdsh-ui';

/**
 * Knowledge panel — brand layer.
 *
 * `knowledgeCss` already routes every surface through the shared aliases (the hardcoded
 * dark toast / badge / warning values were replaced at the source, not overridden here).
 * What is left is shape and hover:
 * - the knowledge-base card hovered to `label-tertiary`, i.e. a grey border, which reads
 *   as "disabled" rather than "clickable";
 * - card radii were 12px while every other card surface in the product is 14px.
 */
export const knowledgeBrandCss = `${brandCss}
@layer workdsh-business {
.wd-knowledge-kb-card{border-radius:var(--wd-radius-lg);box-shadow:var(--wd-shadow-card)}
.wd-knowledge-kb-card:hover{border-color:var(--wd-brand);background:var(--wd-surface);box-shadow:var(--wd-shadow-hover)}
.wd-knowledge-section{border-radius:var(--wd-radius-lg)}
.wd-knowledge-doc{border-radius:var(--wd-radius-md)}
.wd-knowledge-doc:hover{border-color:var(--wd-brand)}
}
`;
