import { brandCss } from 'epuberdsh-ui';

/**
 * Connectors panel — brand layer.
 *
 * Same contract as the skills panel: `brandCss` first, then only the composition the
 * alias bridge cannot express. Everything that had a hardcoded accent (tile gradient,
 * teal switch, status dots, code colour) now reads from `--wd-*`, so the connectors
 * screen and the skills screen cannot drift apart.
 */
export const connectorsBrandCss = `${brandCss}
@layer workdsh-business {
.wd-connectors .connector-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,316px),1fr));gap:18px}
.wd-connectors .connector-card{min-height:0;padding:18px;border:1px solid var(--wd-border);border-radius:var(--wd-radius-lg);background:var(--wd-surface);box-shadow:var(--wd-shadow-card);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.wd-connectors .connector-card:hover{border-color:var(--wd-brand);background:var(--wd-surface);box-shadow:var(--wd-shadow-hover);transform:translateY(-1px)}
.wd-connectors .card-top{gap:12px}
.wd-connectors .card-open{gap:12px}
/* tile: neutral brand tint, not a one-off teal gradient */
.wd-connectors .connector-mark{width:44px;height:44px;border:0;border-radius:12px;background:var(--wd-brand-tint);color:var(--wd-brand);font-size:17px;font-weight:700}
.wd-connectors .card-title strong{font-size:15px;line-height:21px}
.wd-connectors .card-body{height:40px;margin-top:10px;font-size:13px;line-height:20px;color:var(--wd-text-secondary)}
.wd-connectors .card-body.problem{color:var(--wd-domain-risk)}
.wd-connectors code{color:var(--wd-brand)}
.wd-connectors .error,.connector-config-dialog .error,.connector-detail-dialog .error{color:var(--wd-domain-risk)}

/* switch is a state: neutral track until on, brand when on */
.wd-connectors .switch,.connector-detail-dialog .switch{background:var(--wd-border-strong)}
.wd-connectors .switch[aria-checked="true"],.connector-detail-dialog .switch[aria-checked="true"]{background:var(--wd-brand)}
.wd-connectors .switch::after,.connector-detail-dialog .switch::after{box-shadow:0 1px 2px rgba(16,24,40,.18)}

/* status dots reuse the domain hues instead of three ad-hoc greens/reds/ambers */
.wd-connectors .status-dot.ready,.connector-detail-dialog .status-dot.ready{background:var(--wd-domain-parse);box-shadow:0 0 0 3px color-mix(in srgb,var(--wd-domain-parse) 14%,transparent)}
.wd-connectors .status-dot.offline,.connector-detail-dialog .status-dot.offline{background:var(--wd-domain-risk)}
.wd-connectors .status-dot.discovering,.connector-detail-dialog .status-dot.discovering{background:var(--wd-domain-knowledge)}
}
`;
