import { brandCss } from 'epuberdsh-ui';

/**
 * Skills panel — brand layer.
 *
 * `brandCss` publishes the product palette and re-points the shared `--dsw-alias-*`
 * names inside `.wd-skills`; the rules below then set the composition that the alias
 * bridge alone cannot express: card surface, icon tile, chips, hover elevation.
 *
 * Injected last so equal-specificity rules here win over `styles.ts`. Keep colour
 * values as `--wd-*` tokens — a palette change belongs in epuberdsh-ui, not here.
 */
export const skillsBrandCss = `${brandCss}
@layer workdsh-business {
.wd-skills{padding:28px 28px 40px}

/* ---------- header ---------- */
.wd-skills .cap-header{margin-bottom:18px;gap:6px}
.wd-skills .cap-tab{height:32px;min-height:32px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--wd-text-secondary);font-size:13px}
.wd-skills .cap-tab:hover:not(:disabled){background:var(--wd-surface);color:var(--wd-text-primary)}
.wd-skills .cap-tab.active{background:var(--wd-brand-tint);color:var(--wd-brand);font-weight:600}
.wd-skills .cap-tab:disabled{color:var(--wd-text-tertiary)}

/* input shell: one neutral field, brand only on focus */
.wd-skills .search{border-radius:var(--wd-radius-md)}
.wd-skills .search input,.wd-skills input.search{border-radius:var(--wd-radius-md);background:var(--wd-surface);border-color:var(--wd-border)}
.wd-skills .search input:focus-visible,.wd-skills input.search:focus-visible{border-color:var(--wd-brand);outline:2px solid var(--wd-brand-tint);outline-offset:0}
.wd-skills .installed-count{border-radius:999px;color:var(--wd-text-secondary)}
.wd-skills .installed-count:hover:not(:disabled){border-color:var(--wd-brand);color:var(--wd-brand)}

/* the single filled button on the page */
.wd-skills .add-skill{background:var(--wd-brand);border-color:var(--wd-brand);border-radius:var(--wd-radius-md);color:var(--wd-text-on-brand);font-weight:600}
.wd-skills .add-skill:hover:not(:disabled){background:var(--wd-brand-pressed);border-color:var(--wd-brand-pressed);color:var(--wd-text-on-brand)}
.wd-skills .add-skill:focus-visible{outline:2px solid var(--wd-brand-tint);outline-offset:2px}

/* ---------- section head ---------- */
.wd-skills .section-head{margin-bottom:14px;border-bottom:0;padding-bottom:0}
.wd-skills h1{font-size:24px;line-height:32px;font-weight:700;letter-spacing:-.01em}
.wd-skills .market-count{background:var(--wd-brand-tint);color:var(--wd-brand);font-weight:600}

/* ---------- category chips ---------- */
.wd-skills .category-tabs{gap:8px;margin-bottom:18px}
.wd-skills .category-tabs button{height:32px;min-height:32px;padding:0 14px;border:1px solid var(--wd-border);border-radius:var(--wd-radius-sm);background:var(--wd-surface);color:var(--wd-text-secondary);font-size:13px}
.wd-skills .category-tabs button:hover:not(:disabled){border-color:var(--wd-border-strong);background:var(--wd-surface);color:var(--wd-text-primary)}
.wd-skills .category-tabs button.active{border-color:var(--wd-brand);background:var(--wd-brand);color:var(--wd-text-on-brand);font-weight:600}

/* ---------- grid + cards ---------- */
.wd-skills .grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,316px),1fr));gap:18px}
.wd-skills .card{min-height:0;padding:18px;border:1px solid var(--wd-border);border-radius:var(--wd-radius-lg);background:var(--wd-surface);box-shadow:var(--wd-shadow-card);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.wd-skills .card:hover{border-color:var(--wd-brand);background:var(--wd-surface);box-shadow:var(--wd-shadow-hover);transform:translateY(-1px)}
.wd-skills .card.disabled{opacity:.56}
.wd-skills .card.invalid{border-color:var(--wd-domain-risk)}

/* catalog cards stay dashed + flat: "not installed yet" must read differently */
.wd-skills .market-card{border-style:dashed;border-color:var(--wd-border-strong);background:var(--wd-surface-sunken);box-shadow:none}
.wd-skills .market-card:hover{border-style:solid;border-color:var(--wd-brand);background:var(--wd-surface);box-shadow:var(--wd-shadow-hover)}

.wd-skills .card-top{gap:12px}
.wd-skills .card-open{gap:12px}
/* the tile is the only place a domain hue may fill an area */
.wd-skills .skill-mark,.wd-skills .skill-icon{width:44px;height:44px;border-radius:12px}
.wd-skills .skill-icon{border:1px solid var(--wd-border);background:var(--wd-surface)}
.wd-skills .skill-mark{background:var(--wd-brand-tint);color:var(--wd-brand);font-size:17px;font-weight:700}
.wd-skills .card-title{gap:2px}
.wd-skills .card-title strong{font-size:15px;line-height:21px;font-weight:600}
.wd-skills .card p{margin-top:10px;height:40px;font-size:13px;line-height:20px;color:var(--wd-text-secondary)}
.wd-skills .diagnostic{margin-top:10px}

/* switch is a state, not an action: neutral track until on */
.wd-skills .switch{background:var(--wd-brand)}
.wd-skills .switch[aria-checked="false"]{background:var(--wd-border-strong)}
.wd-skills .switch::after{box-shadow:0 1px 2px rgba(16,24,40,.18)}

/* ---------- dialogs ---------- */
.wd-skills .skill-mark.large{font-size:22px}
.skill-detail-dialog .detail-body,.skill-detail-dialog .command,.trash-dialog .trash-list>div,.confirm-dialog .dependency-clear{background:var(--wd-surface-sunken);border-color:var(--wd-border)}
}

/* Outside the layer on purpose: the shared \`modalCss\` shell is injected unlayered,
   and unlayered declarations outrank every cascade layer, so a layered override of
   \`.wd-dialog\` would silently lose no matter how specific it is. */
.wd-skills .wd-dialog{border-radius:16px;box-shadow:var(--wd-shadow-dialog)}
`;
