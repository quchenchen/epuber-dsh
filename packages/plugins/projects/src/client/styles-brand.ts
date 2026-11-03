import { brandCss } from 'epuberdsh-ui';

/**
 * Projects panel — brand layer.
 *
 * Only the stray accents are replaced: the panel had its own blue (`#2563eb`), its own
 * dark success/error bands (`#1e3528` / `#3b2020`) and link colours (`#8eb5f5`), which
 * would sit next to the new palette as a second, slightly-off brand.
 *
 * `--p-bg` / `--p-line` / `--p-surface` / `--p-strong` / `--p-muted` / `--p-hover` are referenced 60+
 * times by `projectsCss` but were never declared in this package, so every one of those
 * declarations was invalid-at-computed-value: borders disappeared, text fell back to inheritance.
 * They are mapped here instead of in `projectsCss` so the fallbacks stay inside the brand layer.
 */
export const projectsBrandCss = `${brandCss}
@layer workdsh-business {
.wd-projects{--p-bg:var(--wd-bg-app,#f4f6fa);--p-surface:var(--wd-surface,#fff);--p-line:var(--wd-border,#e9edf5);--p-strong:var(--wd-text-primary,#101828);--p-muted:var(--wd-text-tertiary,#98a2b3);--p-hover:var(--wd-brand-soft,#f2f6ff);--p-text:var(--wd-text-primary,#101828)}
.wd-projects .wd-p-primary{background:var(--wd-brand);border-color:var(--wd-brand);color:var(--wd-text-on-brand);box-shadow:none}
.wd-projects .wd-p-primary:hover:not(:disabled){background:var(--wd-brand-pressed);border-color:var(--wd-brand-pressed);color:var(--wd-text-on-brand)}
.wd-projects .wd-p-error{background:color-mix(in srgb,var(--wd-domain-risk) 8%,var(--wd-surface));color:var(--wd-domain-risk)}
.wd-projects .wd-p-notice{background:color-mix(in srgb,var(--wd-domain-parse) 10%,var(--wd-surface));color:color-mix(in srgb,var(--wd-domain-parse) 82%,var(--wd-text-primary))}
.wd-projects .wd-p-counter.over{color:var(--wd-domain-risk)}
.wd-projects .wd-p-capability-bound .wd-p-upgrade{color:var(--wd-brand)}
.wd-projects .wd-p-capability-bound .wd-p-remove{color:var(--wd-text-tertiary)}
.wd-projects .wd-p-picker-toolbar input:focus{border-color:var(--wd-brand)}
.wd-projects .wd-p-card{border-radius:var(--wd-radius-lg);box-shadow:var(--wd-shadow-card)}
.wd-projects .wd-p-card:hover{border-color:var(--wd-brand);box-shadow:var(--wd-shadow-hover)}
.wd-projects .wd-p-card-icon{border-radius:12px;background:var(--wd-brand-tint);color:var(--wd-brand)}
}
`;
