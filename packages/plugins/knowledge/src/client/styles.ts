import { controlsCss, modalCss } from 'epuberdsh-ui';

/**
 * The knowledge panel reuses the shared control styles and the Harness theme
 * variables, so it follows light/dark appearance without owning a design system.
 */
export const knowledgeCss = `${modalCss}
${controlsCss}

.wd-knowledge{display:grid;grid-template-columns:300px minmax(0,1fr);height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/1.5 "PingFang SC","Microsoft YaHei",sans-serif}
.wd-knowledge *{box-sizing:border-box}
/* Plain buttons inherit the panel font/colour; native controls (data-wd-control) keep their own contrast. */
.wd-knowledge :where(button:not([data-wd-control]), input, select, textarea){font:inherit;color:inherit}
.wd-knowledge-sidebar{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.wd-knowledge-sidebar>header{display:flex;align-items:center;gap:10px;height:70px;padding:0 18px}
.wd-knowledge-sidebar h1{margin:0;font-size:24px}
.wd-knowledge-nav-toggle{display:none}
.wd-knowledge-nav{display:grid;gap:3px;padding:0 12px 14px}
.wd-knowledge-nav button{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border:0;border-radius:8px;background:transparent;font-size:15px;text-align:left;cursor:pointer}
.wd-knowledge-nav button:hover,.wd-knowledge-nav button.active{background:var(--dsw-alias-interactive-bg-hover)}
.wd-knowledge-section-title{display:flex;align-items:center;justify-content:space-between;padding:8px 18px 6px;color:var(--dsw-alias-label-tertiary);font-size:13px}
.wd-knowledge-section-title button{width:28px;height:28px;border:0;border-radius:6px;background:transparent;font-size:20px;cursor:pointer}
.wd-knowledge-section-title button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wd-knowledge-section-title button:disabled{opacity:.45;cursor:not-allowed}
.wd-knowledge-filter{padding:0 14px 8px}
.wd-knowledge-filter .wd-form-input{width:100%}
.wd-knowledge-kbs{flex:1;min-height:0;overflow:auto;padding:0 8px 16px}
.wd-knowledge-kb{display:flex;align-items:center;gap:8px;width:100%;padding:10px 10px;border:0;border-radius:8px;background:transparent;text-align:left;cursor:pointer}
.wd-knowledge-kb:hover,.wd-knowledge-kb.active{background:var(--dsw-alias-interactive-bg-hover)}
.wd-knowledge-kb-glyph{flex:0 0 24px;height:24px;display:grid;place-items:center;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:13px}
.wd-knowledge-kb-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-knowledge-kb-count{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-sidebar footer{padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:12px;display:grid;gap:2px;min-width:0}
.wd-knowledge-conn-meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.wd-knowledge-conn-meta.action{border:0;padding:0;background:transparent;font:inherit;font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:left;cursor:pointer}
.wd-knowledge-conn-action{color:var(--dsw-alias-label-secondary);text-decoration:underline;text-underline-offset:2px}
.wd-knowledge-conn-meta.action:hover .wd-knowledge-conn-action{color:var(--dsw-alias-label-primary)}
.wd-knowledge-content{min-width:0;min-height:0;overflow:auto;position:relative;background:var(--dsw-alias-bg-base)}
.wd-knowledge-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;height:64px;padding:0 26px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);backdrop-filter:blur(12px)}
.wd-knowledge-header-left{display:flex;align-items:center;gap:10px;min-width:0}
.wd-knowledge-header-left span{color:var(--dsw-alias-label-tertiary)}
.wd-knowledge-header-left strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-knowledge-body{padding:26px 30px 60px}
.wd-knowledge-state{margin:40px auto;max-width:620px;padding:30px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-tertiary);text-align:center}
.wd-knowledge-toast{position:fixed;top:76px;right:24px;z-index:15;max-width:460px;padding:11px 16px;border-radius:8px;background:#21382c;color:#a9e5c3;box-shadow:0 8px 30px var(--dsw-alias-bg-mask-2)}
.wd-knowledge-toast.error{background:#452424;color:#ffb0b0}
.wd-knowledge-kb-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.wd-knowledge-kb-card{display:flex;flex-direction:column;gap:8px;min-height:132px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;text-align:left}
.wd-knowledge-kb-card:hover{border-color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover)}
.wd-knowledge-kb-card h3{margin:0;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-knowledge-kb-card p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.wd-knowledge-kb-meta{display:flex;align-items:center;gap:10px;margin-top:auto;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
/* Document titles are file names and can be far longer than the panel: the
   title block must shrink (min-width:0) or the actions beside it get pushed
   out of view, which silently removes the only "back" affordance. */
.wd-knowledge-toolbar>div:first-child{min-width:0;flex:1 1 auto}
.wd-knowledge-toolbar h2{margin:0;font-size:20px;overflow-wrap:anywhere}
.wd-knowledge-toolbar small{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.wd-knowledge-pager{display:flex;align-items:center;gap:10px;margin:16px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px}
.wd-knowledge-list{display:grid;gap:8px}
.wd-knowledge-doc{display:flex;align-items:center;gap:12px;width:100%;padding:13px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);text-align:left;cursor:pointer}
.wd-knowledge-doc:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-knowledge-doc-main{flex:1;min-width:0;display:grid;gap:3px}
.wd-knowledge-doc-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.wd-knowledge-doc-main small{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-badge{flex:0 0 auto;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid transparent}
.wd-knowledge-badge.completed{background:#1d3527;color:#9fdcb5;border-color:#2b5239}
.wd-knowledge-badge.processing,.wd-knowledge-badge.pending,.wd-knowledge-badge.deleting{background:#3a3218;color:#e6c87a;border-color:#5c4c22}
.wd-knowledge-badge.failed{background:#432323;color:#ffb0b0;border-color:#673333}
.wd-knowledge-badge.unknown{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
.wd-knowledge-doc-detail{display:grid;gap:22px}
.wd-knowledge-meta{display:flex;flex-wrap:wrap;gap:8px 18px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-warning{padding:11px 14px;border:1px solid #76532b;border-radius:8px;background:#2d2519;color:#e6bd77;font-size:13px}
.wd-knowledge-section{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}
.wd-knowledge-section>header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.wd-knowledge-section>header strong{font-size:14px}
.wd-knowledge-section>header small{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-preview{margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;font:13px/1.75 "PingFang SC","Microsoft YaHei",sans-serif;max-height:420px;overflow:auto}
.wd-knowledge-chunks{display:grid;gap:0}
.wd-knowledge-chunk{padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.wd-knowledge-chunk:last-child{border-bottom:0}
.wd-knowledge-chunk b{display:block;margin-bottom:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:500}
.wd-knowledge-chunk p{margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.7 "PingFang SC","Microsoft YaHei",sans-serif;max-height:260px;overflow:auto}
.wd-knowledge-search-form{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:10px;margin-bottom:8px}
.wd-knowledge-search-mode{display:flex;gap:8px;margin-bottom:20px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-hits{display:grid;gap:12px}
.wd-knowledge-hit{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.wd-knowledge-hit-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}
.wd-knowledge-hit-head strong{font-size:14px;font-weight:600;word-break:break-all}
.wd-knowledge-score{flex:0 0 auto;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
.wd-knowledge-hit p{margin:0 0 10px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-primary)}
.wd-knowledge-hit footer{display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-wiki-body{margin:12px 0 0;padding:12px;max-height:420px;overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-family:inherit;font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}
.wd-knowledge-hit footer button{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;text-decoration:underline}
.wd-knowledge-form{display:grid;gap:16px;max-width:620px}
.wd-knowledge-form label{display:grid;gap:7px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.wd-knowledge-form input{height:40px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);outline:none}
.wd-knowledge-form select{height:40px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.wd-knowledge-form small{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-knowledge-form-actions{display:flex;gap:10px;align-items:center}
.wd-knowledge-toolbar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:0 0 auto}
.wd-knowledge-hint{padding:10px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:13px}
@media(max-width:760px){.wd-knowledge{grid-template-columns:1fr}.wd-knowledge-sidebar{display:none}.wd-knowledge-body{padding:18px}.wd-knowledge-search-form{grid-template-columns:1fr}.wd-knowledge-nav-toggle{display:block}}

`;
