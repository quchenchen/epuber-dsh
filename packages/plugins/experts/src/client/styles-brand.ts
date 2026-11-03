import { brandCss } from 'epuberdsh-ui';

/**
 * Experts panel — brand layer.
 *
 * Two real defects in `expertsCss`, not taste:
 * 1. `.wd-experts .card:hover` sets `border-color` and `background` to the exact same
 *    values as the resting card, so the hover state was a no-op — the same dead rule
 *    that was removed from the skills panel.
 * 2. Card radius was 17px, off the 8/10/14 scale used everywhere else.
 *
 * The active filter tab was a grey hover wash; it now uses the brand tint so the
 * selected category is visible at a glance (still not a second blue button).
 */
export const expertsBrandCss = `${brandCss}
@layer epuberdsh-business {
.wd-experts .card{border-radius:var(--wd-radius-lg);background:var(--wd-surface);box-shadow:var(--wd-shadow-card)}
.wd-experts .card:hover{border-color:var(--wd-brand);background:var(--wd-surface);box-shadow:var(--wd-shadow-hover)}
.wd-experts .filter-tabs button.active{background:var(--wd-brand-tint);color:var(--wd-brand);font-weight:600}
}
`;
