/**
 * EpuberDSH product palette.
 *
 * One source of truth for surface colour across business panels. Panels keep
 * writing `var(--dsw-alias-*)` as before — this layer bridges those shared names
 * onto the product palette *inside a product surface only*, so the Host chrome
 * (titlebar, sidebar, conversation) keeps its own theme untouched.
 *
 * Adding a panel: put `wd-theme` on its root element, or extend `productSurface`
 * with its root selector. Never redeclare these hexes in a panel stylesheet —
 * a palette change must stay a one-line change here.
 */

export type DomainTone = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly tint: string;
};

/**
 * Nine domain hues. Order is deliberate: understanding and governance are the
 * blue/violet family, production is green/teal/indigo, review is orange/red,
 * platform is cyan. Colour carries meaning, so a skill's tint tells you which
 * business line it belongs to before you read its name.
 */
export const domainPalette: readonly DomainTone[] = [
  { key: 'understand', label: '内容理解', color: '#2f6bff', tint: '#ebf1ff' },
  { key: 'govern', label: '资源治理', color: '#7a5af8', tint: '#f2eeff' },
  { key: 'parse', label: '任务解析', color: '#12b76a', tint: '#e6f9f0' },
  { key: 'plan', label: '素材策划', color: '#14b8a6', tint: '#e4f8f6' },
  { key: 'create', label: '内容创作', color: '#6366f1', tint: '#edeefe' },
  { key: 'audit', label: '内容审核', color: '#f97316', tint: '#fff1e8' },
  { key: 'risk', label: '内容风控', color: '#f04438', tint: '#feeceb' },
  { key: 'knowledge', label: '知识服务', color: '#f5a524', tint: '#fff4e0' },
  { key: 'platform', label: '平台支撑', color: '#0ba5ec', tint: '#e5f5fe' },
];

/**
 * Stable per-name hue. Same name always lands on the same tone across reloads,
 * so users learn "violet means governance" instead of seeing colours shuffle.
 */
export function domainTone(seed: string): DomainTone {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 0x5f5e100;
  return domainPalette[hash % domainPalette.length] ?? domainPalette[0]!;
}

const domainCss = domainPalette
  .map(tone => `  --wd-domain-${tone.key}:${tone.color};\n  --wd-domain-${tone.key}-tint:${tone.tint};`)
  .join('\n');

/**
 * Root selectors that opt into the product palette — one per mounted panel root.
 * `.wd-theme` is the escape hatch for a new surface; adding it here is the only
 * wiring a panel needs, because the bridge below re-points the shared aliases.
 */
export const productSurface = [
  '.wd-theme',
  '.wd-skills',
  '.wd-experts',
  '.wd-connectors',
  '.wd-projects',
  '.wd-library',
  '.wd-knowledge',
  '.wd-quality',
  '.wd-workbenches',
].join(',');

export const brandCss = `
${productSurface}{
  /* surfaces */
  --wd-bg-app:#f4f6fa;
  --wd-surface:#ffffff;
  --wd-surface-sunken:#fafbfd;
  --wd-border:#e9edf5;
  --wd-border-strong:#dde3ee;
  /* text: three levels only — hierarchy comes from weight and size, not new greys */
  --wd-text-primary:#101828;
  --wd-text-secondary:#5b6577;
  --wd-text-tertiary:#98a2b3;
  --wd-text-on-brand:#ffffff;
  /* Status inks: the domain hues are too light for small text on their own tint.
     These three are the readable counterparts, verified against the matching soft fill. */
  --wd-ink-success:#0a7b46;
  --wd-ink-warn:#b45309;
  --wd-ink-danger:#b42318;
  /* brand: one high-saturation accent, reserved for the primary action and selection */
  --wd-brand:#2f6bff;
  --wd-brand-pressed:#1e52d9;
  --wd-brand-tint:#e3ebff;
  --wd-brand-soft:#f2f6ff;
  /* shape and elevation */
  --wd-radius-sm:8px;
  --wd-radius-md:10px;
  --wd-radius-lg:14px;
  --wd-shadow-card:0 1px 2px rgba(16,24,40,.04),0 6px 16px -6px rgba(16,24,40,.08);
  --wd-shadow-hover:0 2px 6px -1px rgba(47,107,255,.16),0 14px 30px -12px rgba(16,24,40,.16);
  --wd-shadow-dialog:0 18px 48px -12px rgba(16,24,40,.28);
  --wd-mask:rgba(16,24,40,.42);
  /* domain hues */
${domainCss}
  /* bridge — panels keep using the shared alias names */
  --dsw-alias-bg-base:var(--wd-bg-app);
  --dsw-alias-bg-layer-1:var(--wd-surface);
  --dsw-alias-bg-layer-2:var(--wd-surface);
  --dsw-alias-bg-layer-3:var(--wd-brand-tint);
  --dsw-alias-bg-mask-2:var(--wd-mask);
  --dsw-alias-border-l1:var(--wd-border-strong);
  --dsw-alias-border-l2:var(--wd-border);
  --dsw-alias-label-primary:var(--wd-text-primary);
  --dsw-alias-label-secondary:var(--wd-text-secondary);
  --dsw-alias-label-tertiary:var(--wd-text-tertiary);
  --dsw-alias-label-dimmed:var(--wd-text-tertiary);
  --dsw-alias-label-primary-inverted:var(--wd-text-on-brand);
  --dsw-alias-brand-primary:var(--wd-brand);
  --dsw-alias-brand-text:var(--wd-brand);
  --dsw-alias-button-primary-fill:var(--wd-brand);
  --dsw-alias-interactive-bg-hover:var(--wd-brand-soft);
  --dsw-alias-state-success-primary:var(--wd-domain-parse);
  --dsw-alias-state-warn-primary:var(--wd-domain-knowledge);
  --dsw-alias-state-error-primary:var(--wd-domain-risk);
  /* Less-used names. Every one of these still appears in a panel, and an unmapped alias
     silently falls back to the Host theme — i.e. a second, slightly-off brand. Mapped by
     semantics, not by frequency; fill-tsp-secondary (1 use, unclear meaning) is the only
     name left on the Host value on purpose. */
  --dsw-alias-text-primary:var(--wd-text-primary);
  --dsw-alias-label-caption:var(--wd-text-tertiary);
  --dsw-alias-label-primary-foreground:var(--wd-text-on-brand);
  --dsw-alias-border-primary:var(--wd-border-strong);
  --dsw-alias-border-l3:var(--wd-border-strong);
  --dsw-alias-border-l4:var(--wd-border-strong);
  --dsw-alias-bg-skeleton:var(--wd-border);
  --dsw-alias-business-primary:var(--wd-brand);
  --dsw-alias-state-business-primary:var(--wd-brand);
  --dsw-alias-interactive-bg-hover-solid:var(--wd-brand-soft);
  --dsw-alias-button-tool-bar-fill:var(--wd-surface);
  --dsw-alias-button-tool-bar-hover:var(--wd-brand-soft);
  --dsw-alias-state-success-tertiary:var(--wd-domain-parse-tint);
  --dsw-alias-state-warn-tertiary:var(--wd-domain-knowledge-tint);
  --dsw-alias-state-error-secondary:var(--wd-domain-risk-tint);
  --dsw-alias-state-danger-primary:var(--wd-domain-risk);
  /* Panels paint the app background themselves: the surrounding content area belongs
     to the Host, so without this a panel would sit on whatever the Host painted. */
  background:var(--wd-bg-app);
}
`;
